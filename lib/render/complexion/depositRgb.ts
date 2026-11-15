type RgbColor = { r: number; g: number; b: number };
type Point = { x: number; y: number };

export type DepositFieldLayer = {
  centerX: number;
  centerY: number;
  radiusX: number;
  negativeRadiusX?: number;
  positiveRadiusX?: number;
  radiusY: number;
  lowerRadiusY?: number;
  rotation?: number;
  strength: number;
  radiusScale?: number;
  path?: Path2D | null;
  clipToPath?: boolean;
  clipPolygon?: { x: number; y: number }[];
  clipFeatherPx?: number;
  fillRule?: CanvasFillRule;
  responseFloor?: number;
  responseInfluence?: number;
  fieldLine?: Point[];
  falloff?: "gaussian" | "linear" | "smooth" | "constant";
  falloffPower?: number;
};

export type LuminizerGlowOptions = {
  glowStrength?: number;
  tintStrength?: number;
  highlightResponse?: number;
  maxLumaLift?: number;
  coreLayer?: DepositFieldLayer;
  coreMaxLumaLift?: number;
  corePearlColor?: string;
  corePearlStrength?: number;
  skinIntegration?: number;
};

const clampRange = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clamp01 = (value: number) => clampRange(value, 0, 1);

const clampByte = (value: number) => clampRange(Math.round(value), 0, 255);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const parseHexColor = (hex: string): RgbColor => {
  const clean = hex.replace("#", "");
  const normalized =
    clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean;

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const getDirectionalBasis = (rotation = 0) => {
  const axisDir = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const liftDir = { x: -axisDir.y, y: axisDir.x };
  return { axisDir, liftDir };
};

const getLayerExtents = (layer: DepositFieldLayer) => {
  const radiusX = Math.max(
    1,
    layer.radiusX,
    layer.negativeRadiusX ?? 0,
    layer.positiveRadiusX ?? 0
  );
  const radiusY = Math.max(1, layer.radiusY);
  const lowerRadiusY = Math.max(radiusY, layer.lowerRadiusY ?? radiusY);
  const maxRadiusY = Math.max(radiusY, lowerRadiusY);
  const radiusScale = layer.radiusScale ?? 2;
  const { axisDir, liftDir } = getDirectionalBasis(layer.rotation);

  return {
    minX:
      layer.centerX -
      (Math.abs(axisDir.x) * radiusX + Math.abs(liftDir.x) * maxRadiusY) * radiusScale,
    minY:
      layer.centerY -
      (Math.abs(axisDir.y) * radiusX + Math.abs(liftDir.y) * maxRadiusY) * radiusScale,
    maxX:
      layer.centerX +
      (Math.abs(axisDir.x) * radiusX + Math.abs(liftDir.x) * maxRadiusY) * radiusScale,
    maxY:
      layer.centerY +
      (Math.abs(axisDir.y) * radiusX + Math.abs(liftDir.y) * maxRadiusY) * radiusScale,
  };
};

const getLayersBounds = (ctx: CanvasRenderingContext2D, layers: DepositFieldLayer[]) => {
  if (!layers.length) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  layers.forEach((layer) => {
    const bounds = getLayerExtents(layer);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  });

  const boxMinX = Math.max(0, Math.floor(minX));
  const boxMinY = Math.max(0, Math.floor(minY));
  const boxMaxX = Math.min(ctx.canvas.width, Math.ceil(maxX));
  const boxMaxY = Math.min(ctx.canvas.height, Math.ceil(maxY));
  const boxWidth = Math.max(0, boxMaxX - boxMinX);
  const boxHeight = Math.max(0, boxMaxY - boxMinY);

  if (!boxWidth || !boxHeight) return null;
  return { boxMinX, boxMinY, boxWidth, boxHeight };
};

const getLayerFieldWeight = (
  layer: DepositFieldLayer,
  canvasX: number,
  canvasY: number
) => {
  if (layer.falloff === "constant") {
    return 1;
  }

  if (layer.fieldLine && layer.fieldLine.length >= 2) {
    const radiusY = Math.max(1, layer.radiusY);
    const closest = getClosestPointOnPolyline(layer.fieldLine, canvasX, canvasY);
    const startFade = smoothstep(0.02, 0.16, closest.progress);
    const endFade = smoothstep(0.02, 0.16, 1 - closest.progress);
    return (
      Math.exp(-(closest.distance * closest.distance) / (radiusY * radiusY)) *
      startFade *
      endFade
    );
  }

  const baseRadiusX = Math.max(1, layer.radiusX);
  const baseRadiusY = Math.max(1, layer.radiusY);
  const lowerRadiusY = Math.max(baseRadiusY, layer.lowerRadiusY ?? baseRadiusY);
  const radiusY = canvasY >= layer.centerY ? lowerRadiusY : baseRadiusY;
  const { axisDir, liftDir } = getDirectionalBasis(layer.rotation);
  const dx = canvasX - layer.centerX;
  const dy = canvasY - layer.centerY;
  const axisDistance = dx * axisDir.x + dy * axisDir.y;
  const liftDistance = dx * liftDir.x + dy * liftDir.y;
  const radiusX = Math.max(
    1,
    axisDistance < 0
      ? layer.negativeRadiusX ?? baseRadiusX
      : layer.positiveRadiusX ?? baseRadiusX
  );

  const normalizedDistance = Math.sqrt(
    (axisDistance * axisDistance) / (radiusX * radiusX) +
      (liftDistance * liftDistance) / (radiusY * radiusY)
  );

  const radiusScale = Math.max(1, layer.radiusScale ?? 2);
  let fieldWeight: number;

  if (layer.falloff === "linear") {
    fieldWeight = clamp01(1 - normalizedDistance / radiusScale);
  } else if (layer.falloff === "smooth") {
    fieldWeight = 1 - smoothstep(0, radiusScale, normalizedDistance);
  } else {
    fieldWeight = Math.exp(-(normalizedDistance * normalizedDistance));
  }

  return Math.pow(fieldWeight, Math.max(0.1, layer.falloffPower ?? 1));
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / Math.max(1e-5, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const distancePointToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) => {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 1e-5) return Math.hypot(px - ax, py - ay);

  const t = clamp01((apx * abx + apy * aby) / abLenSq);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return Math.hypot(px - closestX, py - closestY);
};

const getPolylineLength = (points: Point[]) =>
  points.reduce(
    (length, point, index) =>
      index === 0
        ? 0
        : length + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y),
    0
  );

const getClosestPointOnPolyline = (points: Point[], x: number, y: number) => {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let traversed = 0;
  const totalLength = Math.max(1, getPolylineLength(points));

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength <= 1e-5) continue;

    const t = clamp01(
      ((x - start.x) * dx + (y - start.y) * dy) / (segmentLength * segmentLength)
    );
    const closestX = start.x + dx * t;
    const closestY = start.y + dy * t;
    const distance = Math.hypot(x - closestX, y - closestY);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgress = (traversed + segmentLength * t) / totalLength;
    }

    traversed += segmentLength;
  }

  return { distance: bestDistance, progress: clamp01(bestProgress) };
};

const distanceToPolygonEdge = (
  x: number,
  y: number,
  polygon: { x: number; y: number }[]
) => {
  if (polygon.length < 2) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    best = Math.min(
      best,
      distancePointToSegment(x, y, start.x, start.y, end.x, end.y)
    );
  }
  return best;
};

// Snapshot local luminance before any makeup pixels are written. The summed
// area table lets the live renderer sample each neighborhood in constant time.
const buildLumaIntegral = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowLuma = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      rowLuma +=
        (0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]) / 255;
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowLuma;
    }
  }

  return integral;
};

const renderDepositLayers = (
  ctx: CanvasRenderingContext2D,
  targetColor: string,
  layers: DepositFieldLayer[],
  resolvePixel: (
    source: RgbColor,
    target: RgbColor,
    weight: number,
    canvasX: number,
    canvasY: number,
    localLuma: number
  ) => RgbColor,
  localLumaRadius = 0
) => {
  const bounds = getLayersBounds(ctx, layers);
  if (!bounds) return;
  const { boxMinX, boxMinY, boxWidth, boxHeight } = bounds;

  const target = parseHexColor(targetColor);
  const imageData = ctx.getImageData(boxMinX, boxMinY, boxWidth, boxHeight);
  const { data } = imageData;
  const lumaIntegral = localLumaRadius > 0
    ? buildLumaIntegral(data, boxWidth, boxHeight)
    : null;
  const lumaStride = boxWidth + 1;

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = boxMinX + x + 0.5;
      const canvasY = boxMinY + y + 0.5;
      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const response = Math.sqrt(luma);

      let totalWeight = 0;

      for (const layer of layers) {
        let edgeFeatherWeight = 1;
        if (
          layer.clipToPath &&
          layer.path &&
          !ctx.isPointInPath(
            layer.path,
            canvasX,
            canvasY,
            layer.fillRule ?? "nonzero"
          )
        ) {
          continue;
        }

        if (
          layer.clipToPath &&
          layer.path &&
          layer.clipPolygon &&
          layer.clipPolygon.length >= 3 &&
          (layer.clipFeatherPx ?? 0) > 0
        ) {
          const featherPx = Math.max(1, layer.clipFeatherPx ?? 0);
          const edgeDistance = distanceToPolygonEdge(
            canvasX,
            canvasY,
            layer.clipPolygon
          );
          const normalizedDistance = clamp01(edgeDistance / featherPx);
          edgeFeatherWeight =
            normalizedDistance *
            normalizedDistance *
            (3 - 2 * normalizedDistance);
          if (edgeFeatherWeight <= 1e-4) continue;
        }

        const fieldWeight = getLayerFieldWeight(layer, canvasX, canvasY);
        const effectiveResponseRaw = Math.max(response, clamp01(layer.responseFloor ?? 0));
        const effectiveResponse = lerp(
          1,
          effectiveResponseRaw,
          clamp01(layer.responseInfluence ?? 1)
        );

        totalWeight +=
          fieldWeight *
          layer.strength *
          effectiveResponse *
          edgeFeatherWeight;
      }

      if (totalWeight <= 1e-5) continue;

      const weight = clamp01(totalWeight);
      let localLuma = luma;
      if (lumaIntegral) {
        const x0 = Math.max(0, x - localLumaRadius);
        const y0 = Math.max(0, y - localLumaRadius);
        const x1 = Math.min(boxWidth, x + localLumaRadius + 1);
        const y1 = Math.min(boxHeight, y + localLumaRadius + 1);
        localLuma = (
          lumaIntegral[y1 * lumaStride + x1] -
          lumaIntegral[y0 * lumaStride + x1] -
          lumaIntegral[y1 * lumaStride + x0] +
          lumaIntegral[y0 * lumaStride + x0]
        ) / ((x1 - x0) * (y1 - y0));
      }
      const next = resolvePixel({ r, g, b }, target, weight, canvasX, canvasY, localLuma);
      data[pixelIndex] = clampByte(next.r);
      data[pixelIndex + 1] = clampByte(next.g);
      data[pixelIndex + 2] = clampByte(next.b);
    }
  }

  ctx.putImageData(imageData, boxMinX, boxMinY);
};

export function renderDepositRgbLayers(
  ctx: CanvasRenderingContext2D,
  targetColor: string,
  layers: DepositFieldLayer[]
) {
  renderDepositLayers(ctx, targetColor, layers, (source, target, weight) => ({
    r: lerp(source.r, target.r, weight),
    g: lerp(source.g, target.g, weight),
    b: lerp(source.b, target.b, weight),
  }));
}

export function renderLuminizerGlowLayers(
  ctx: CanvasRenderingContext2D,
  targetColor: string,
  layers: DepositFieldLayer[],
  options: LuminizerGlowOptions = {}
) {
  const glowStrength = clampRange(options.glowStrength ?? 0.72, 0, 1);
  const tintStrength = clampRange(options.tintStrength ?? 0.92, 0, 1);
  const highlightResponse = clampRange(options.highlightResponse ?? 0.95, 0, 1);
  const baseMaxLumaLift = clampRange(options.maxLumaLift ?? 0.055, 0, 0.15) * 255;
  const coreMaxLumaLift = clampRange(
    options.coreMaxLumaLift ?? baseMaxLumaLift / 255,
    baseMaxLumaLift / 255,
    0.15
  ) * 255;
  const targetRgb = parseHexColor(targetColor);
  const targetLuma =
    0.299 * targetRgb.r + 0.587 * targetRgb.g + 0.114 * targetRgb.b;
  const pearlRgb = options.corePearlColor
    ? parseHexColor(options.corePearlColor)
    : targetRgb;
  const pearlStrength = options.corePearlColor
    ? clamp01(options.corePearlStrength ?? 0)
    : 0;
  const skinIntegration = clamp01(options.skinIntegration ?? 0);
  const localLumaRadius = skinIntegration > 0 && options.coreLayer
    ? Math.round(clampRange(
        Math.min(options.coreLayer.radiusX, options.coreLayer.radiusY) * 0.22,
        2,
        10
      ))
    : 0;

  renderDepositLayers(ctx, targetColor, layers, (source, target, weight, canvasX, canvasY, localLuma) => {
    const luma = (0.299 * source.r + 0.587 * source.g + 0.114 * source.b) / 255;
    const coreWeight = options.coreLayer && options.coreLayer.strength > 0
      ? clamp01(getLayerFieldWeight(options.coreLayer, canvasX, canvasY))
      : 0;
    // Relative light leaves more skin visible in small shadows, independent
    // of the cheek's overall brightness. Limit the response to the stable peak.
    const relativeLight = (luma - localLuma) / Math.max(0.12, localLuma);
    const skinResponse = lerp(
      1,
      // Reflect mainly from locally lit skin, leaving pores and small shadows
      // visible. Apply this to the veil too, not just the central ellipse.
      lerp(0.12, 1, smoothstep(-0.025, 0.06, relativeLight)),
      skinIntegration
    );
    const lightResponse = smoothstep(0.18, 0.76, luma);
    const highlightGuard = lerp(1, 0.82, smoothstep(0.86, 1, luma));
    const response = lerp(
      1,
      lightResponse * highlightGuard,
      highlightResponse
    );
    const pigmentResponse = lerp(0.42, 1, smoothstep(0.12, 0.68, luma));
    const tintWeight = clamp01(weight * tintStrength * pigmentResponse);
    const glowWeight = clamp01(weight * glowStrength * response * skinResponse);

    // Keep the soft champagne veil; the core can carry a neutral pearl tint.
    const champagneTint = {
      r: lerp(source.r, source.r + (target.r - targetLuma), tintWeight),
      g: lerp(source.g, source.g + (target.g - targetLuma), tintWeight),
      b: lerp(source.b, source.b + (target.b - targetLuma), tintWeight),
    };
    const pearlMix = coreWeight * pearlStrength;
    // Pearl belongs to the reflected light, not to an opaque neutral pigment.
    // Keep the skin's chroma underneath the champagne tint.
    const pigmented = champagneTint;
    const reflectionColor = {
      r: lerp(target.r, pearlRgb.r, pearlMix),
      g: lerp(target.g, pearlRgb.g, pearlMix),
      b: lerp(target.b, pearlRgb.b, pearlMix),
    };
    const screen = {
      r: 255 - ((255 - pigmented.r) * (255 - reflectionColor.r)) / 255,
      g: 255 - ((255 - pigmented.g) * (255 - reflectionColor.g)) / 255,
      b: 255 - ((255 - pigmented.b) * (255 - reflectionColor.b)) / 255,
    };
    const lit = {
      r: lerp(pigmented.r, screen.r, glowWeight),
      g: lerp(pigmented.g, screen.g, glowWeight),
      b: lerp(pigmented.b, screen.b, glowWeight),
    };
    const pigmentedLuma =
      0.299 * pigmented.r + 0.587 * pigmented.g + 0.114 * pigmented.b;
    const litLuma = 0.299 * lit.r + 0.587 * lit.g + 0.114 * lit.b;
    const lumaLift = Math.max(0, litLuma - pigmentedLuma);
    // Follow the existing core field so extra light fades out before the veil.
    const maxLumaLift = lerp(baseMaxLumaLift, coreMaxLumaLift, coreWeight) * skinResponse;
    // Approach the light budget smoothly instead of clipping the center to a
    // uniform plateau. Small variations in the source remain visible even
    // where the old hard cap would have flattened the whole cheek highlight.
    const softLift = maxLumaLift > 0
      ? maxLumaLift * -Math.expm1(-lumaLift / maxLumaLift)
      : 0;
    const liftScale = lumaLift > 0 ? softLift / lumaLift : 1;

    return {
      r: lerp(pigmented.r, lit.r, liftScale),
      g: lerp(pigmented.g, lit.g, liftScale),
      b: lerp(pigmented.b, lit.b, liftScale),
    };
  }, localLumaRadius);
}
