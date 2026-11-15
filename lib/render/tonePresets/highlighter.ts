import {
  type DepositFieldLayer,
  renderDepositRgbLayers,
  renderLuminizerGlowLayers,
} from "@/lib/render/complexion/depositRgb";
import {
  type ResolvedOpticalLayer,
  resolveOpticalDepositColor,
  resolveOpticalLayer,
} from "@/lib/render/complexion/productOpticalProfiles";
import type { ProductOpticalFieldDefinition, ProductToneData } from "@/lib/utils";

type Landmark = { x: number; y: number };
type CheekField = Required<Pick<ProductOpticalFieldDefinition,
  | "center_x_mix"
  | "center_y_mix"
  | "radius_x_scale"
  | "radius_y_scale"
  | "lower_radius_y_scale"
  | "radius_scale"
  | "rotation"
>>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function renderHighlighter(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  _hexToRgba: (hex: string, opacity: number) => string
) {
  const upperCheeks = productData.regions["upper_cheeks"];
  if (!upperCheeks) return;

  const polygons = (Array.isArray(upperCheeks[0]) ? upperCheeks : [upperCheeks]) as number[][];
  const rendering = productData.optical_profile?.rendering?.highlighter;
  const baseOpacity = clamp01(productData.opacity ?? 0.55);
  const opacityScale = Math.max(
    rendering?.opacity_scale_min ?? 0.72,
    Math.min(
      rendering?.opacity_scale_max ?? 1.25,
      baseOpacity / Math.max(0.001, rendering?.opacity_reference ?? 0.55)
    )
  );
  const depositColor = resolveOpticalDepositColor(productData);
  const veil = resolveOpticalLayer(productData, "cheek", "veil", {
    color: depositColor,
    strength: 0.28,
  });
  const body = resolveOpticalLayer(productData, "cheek", "body", {
    color: depositColor,
    strength: 0.18,
  });
  const pearl = resolveOpticalLayer(productData, "cheek", "pearl", {
    color: depositColor,
    strength: 0,
  });
  const isPearlescent = productData.optical_profile?.finish === "pearlescent_highlighter";
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  const faceCenterX = leftTemple && rightTemple
    ? ((leftTemple.x + rightTemple.x) * width) / 2
    : width / 2;

  for (const polygon of polygons) {
    const points = polygon
      .map(index => landmarks[index])
      .filter(Boolean)
      .map(point => ({ x: point.x * width, y: point.y * height }));
    if (points.length < 3) continue;

    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const areaWidth = Math.max(1, maxX - minX);
    const areaHeight = Math.max(1, maxY - minY);
    const isLeft = centerX < faceCenterX;
    const innerX = isLeft ? maxX : minX;
    const outerX = isLeft ? minX : maxX;
    // The catalog orders the cheek from the temple toward the inner ridge.
    // Work in that projected anatomical frame, rather than a screen-aligned
    // bounding box whose height grows when the head rolls.
    const outer = points[0];
    const inner = points[2];
    const ridgeLength = Math.hypot(inner.x - outer.x, inner.y - outer.y);
    if (ridgeLength < 1) continue;
    const axisX = (inner.x - outer.x) / ridgeLength;
    const axisY = (inner.y - outer.y) / ridgeLength;
    const normalSign = axisX >= 0 ? 1 : -1;
    const normalX = -axisY * normalSign;
    const normalY = axisX * normalSign;

    const buildLayer = (layer: ResolvedOpticalLayer, defaults: CheekField): DepositFieldLayer => {
      const field = { ...defaults, ...layer.field };
      if (isPearlescent) {
        const thickness = ridgeLength * (layer === body ? 0.13 : 0.22);
        const downwardOffset = ridgeLength * 0.09;
        return {
          centerX: lerp(inner.x, outer.x, field.center_x_mix) + normalX * downwardOffset,
          centerY: lerp(inner.y, outer.y, field.center_x_mix) + normalY * downwardOffset,
          radiusX: ridgeLength * (layer === body ? 0.30 : 0.45),
          radiusY: thickness,
          lowerRadiusY: thickness,
          rotation: Math.atan2(axisY, axisX),
          strength: layer.strength * opacityScale,
          radiusScale: 3,
          responseInfluence: 0,
        };
      }
      return {
        centerX: lerp(innerX, outerX, field.center_x_mix),
        centerY: lerp(minY, maxY, field.center_y_mix),
        radiusX: areaWidth * field.radius_x_scale,
        radiusY: areaHeight * field.radius_y_scale,
        lowerRadiusY: areaHeight * field.lower_radius_y_scale,
        rotation: isLeft ? field.rotation : -field.rotation,
        strength: layer.strength * opacityScale,
        radiusScale: field.radius_scale,
        responseFloor: layer.responseFloor,
        // The pearl resolver applies the light response once per pixel.
        responseInfluence: isPearlescent ? 0 : layer.responseInfluence,
      };
    };
    const veilLayer = buildLayer(veil, {
      center_x_mix: 0.56,
      center_y_mix: 0.42,
      radius_x_scale: 0.92,
      radius_y_scale: 0.58,
      lower_radius_y_scale: 0.72,
      radius_scale: 2,
      rotation: 0.54,
    });
    const bodyLayer = buildLayer(body, {
      center_x_mix: 0.58,
      center_y_mix: 0.48,
      radius_x_scale: 0.42,
      radius_y_scale: 0.28,
      lower_radius_y_scale: 0.34,
      radius_scale: 2,
      rotation: 0.54,
    });

    if (isPearlescent) {
      renderLuminizerGlowLayers(ctx, depositColor, [veilLayer, bodyLayer], {
        tintStrength: rendering?.tint_strength,
        glowStrength: rendering?.glow_strength,
        highlightResponse: rendering?.highlight_response,
        maxLumaLift: rendering?.max_luma_lift,
        coreLayer: bodyLayer,
        coreMaxLumaLift: rendering?.core_max_luma_lift,
        corePearlColor: pearl.color,
        corePearlStrength: pearl.strength,
        skinIntegration: rendering?.skin_integration,
      });
    } else if (veil.color === body.color) {
      renderDepositRgbLayers(ctx, veil.color, [veilLayer, bodyLayer]);
    } else {
      renderDepositRgbLayers(ctx, veil.color, [veilLayer]);
      renderDepositRgbLayers(ctx, body.color, [bodyLayer]);
    }
  }
}
