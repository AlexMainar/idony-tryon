import { ProductToneData, RegionDefinition } from "@/lib/utils";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };

type AreaStyle = {
  tintOpacity: number;
  pearlOpacity: number;
  sheenOpacity: number;
  sparkleOpacity: number;
  tintBlur: number;
  pearlBlur: number;
  sheenBlur: number;
  sparkleBlur: number;
  pearlRadiusX: number;
  pearlRadiusY: number;
  shiftX: number;
  shiftY: number;
};

const normalizeRegionPolygons = (region: RegionDefinition): number[][] => {
  if (Array.isArray(region[0])) return region as number[][];
  return [region as number[]];
};

// Product JSON currently defines one upper cheek polygon; mirror to keep symmetry.
const UPPER_CHEEK_MIRROR: Record<number, number> = {
  58: 288,
  93: 323,
  132: 361,
  172: 397,
  234: 454,
};

const AREA_STYLES: Record<string, AreaStyle> = {
  upper_cheeks: {
    tintOpacity: 0.38,
    pearlOpacity: 0.88,
    sheenOpacity: 0.72,
    sparkleOpacity: 0.62,
    tintBlur: 6,
    pearlBlur: 5,
    sheenBlur: 3.2,
    sparkleBlur: 2.2,
    pearlRadiusX: 1.35,
    pearlRadiusY: 1.08,
    shiftX: 0.08,
    shiftY: 0.19,
  },
  nose_tip: {
    tintOpacity: 0.16,
    pearlOpacity: 0.43,
    sheenOpacity: 0.18,
    sparkleOpacity: 0.32,
    tintBlur: 4,
    pearlBlur: 3.5,
    sheenBlur: 2.6,
    sparkleBlur: 2,
    pearlRadiusX: 1.02,
    pearlRadiusY: 1.02,
    shiftX: 0,
    shiftY: 0.05,
  },
  cupid_bow: {
    tintOpacity: 0.18,
    pearlOpacity: 0.52,
    sheenOpacity: 0.22,
    sparkleOpacity: 0.36,
    tintBlur: 3.5,
    pearlBlur: 3.2,
    sheenBlur: 2.3,
    sparkleBlur: 1.8,
    pearlRadiusX: 1.12,
    pearlRadiusY: 1.02,
    shiftX: 0,
    shiftY: 0.06,
  },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const buildAreaPath = (
  indices: number[],
  landmarks: Landmark[],
  width: number,
  height: number
) => {
  const points: Point[] = [];
  const path = new Path2D();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let added = 0;

  for (let i = 0; i < indices.length; i += 1) {
    const l = landmarks[indices[i]];
    if (!l) continue;
    const p = { x: l.x * width, y: l.y * height };
    points.push(p);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    if (added === 0) path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
    added += 1;
  }

  if (points.length < 3) return null;
  path.closePath();
  return { path, points, minX, minY, maxX, maxY };
};

const getPolygonsForArea = (area: string, region: RegionDefinition) => {
  const polygons = normalizeRegionPolygons(region);
  if (area !== "upper_cheeks") return polygons;
  if (polygons.length !== 1) return polygons;

  const mirrored = polygons[0].map((idx) => UPPER_CHEEK_MIRROR[idx] ?? -1);
  if (mirrored.some((idx) => idx < 0)) return polygons;
  return [polygons[0], mirrored];
};

const drawSpecularBlob = (
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  blur: number
) => {
  const spot = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
  spot.addColorStop(0, "rgba(255,250,244,0.95)");
  spot.addColorStop(0.42, "rgba(255,244,234,0.45)");
  spot.addColorStop(1, "transparent");

  ctx.save();
  ctx.clip(path);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = clamp01(alpha);
  ctx.filter = `blur(${Math.max(1, blur)}px)`;
  ctx.fillStyle = spot;
  ctx.fill(path);
  ctx.restore();
};

export function renderHighlighter(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const baseOpacity = clamp01(Math.max(0.2, Math.min(0.8, productData.opacity || 0.4)));

  // Keep tint subtle; luminizer should read as sheen first.
  const toneBase = hexToRgba(productData.color, baseOpacity * 0.42);
  const toneMid = hexToRgba(productData.color, baseOpacity * 0.24);
  const pearlCore = hexToRgba("#fff8ef", baseOpacity * 0.95);
  const pearlMid = hexToRgba("#ffe9d7", baseOpacity * 0.62);

  const highlightAreas = ["upper_cheeks", "nose_tip", "cupid_bow"];
  highlightAreas.forEach((area) => {
    const region = productData.regions[area];
    if (!region) return;

    const polygons = getPolygonsForArea(area, region);
    const style = AREA_STYLES[area] || AREA_STYLES.upper_cheeks;

    polygons.forEach((indices) => {
      const built = buildAreaPath(indices, landmarks, width, height);
      if (!built) return;

      const { path, minX, minY, maxX, maxY } = built;
      const areaWidth = Math.max(1, maxX - minX);
      const areaHeight = Math.max(1, maxY - minY);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const liftX = centerX + areaWidth * style.shiftX;
      const liftY = centerY - areaHeight * style.shiftY;

      // 1) Low tint veil to keep product tone, but not blush-like.
      const tintGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.max(areaWidth, areaHeight) * 1.12
      );
      tintGrad.addColorStop(0, toneBase);
      tintGrad.addColorStop(0.55, toneMid);
      tintGrad.addColorStop(1, "transparent");

      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = style.tintOpacity;
      ctx.filter = `blur(${style.tintBlur}px)`;
      ctx.fillStyle = tintGrad;
      ctx.fillRect(minX - areaWidth, minY - areaHeight, areaWidth * 3, areaHeight * 3);
      ctx.restore();

      // 2) Pearl lift for dewy skin sheen.
      const pearlGrad = ctx.createRadialGradient(
        liftX,
        liftY,
        0,
        liftX,
        liftY,
        Math.max(areaWidth * style.pearlRadiusX, areaHeight * style.pearlRadiusY)
      );
      pearlGrad.addColorStop(0, pearlCore);
      pearlGrad.addColorStop(0.48, pearlMid);
      pearlGrad.addColorStop(1, "transparent");

      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = style.pearlOpacity;
      ctx.filter = `blur(${style.pearlBlur}px)`;
      ctx.fillStyle = pearlGrad;
      ctx.fillRect(minX - areaWidth, minY - areaHeight, areaWidth * 3, areaHeight * 3);
      ctx.restore();

      // 3) Sheen sweep, biased to outer cheek so highlight has directionality.
      const outerBias = centerX < width * 0.5 ? 0.3 : 0.7;
      const sweepGrad = ctx.createLinearGradient(minX, centerY, maxX, centerY);
      sweepGrad.addColorStop(0, "transparent");
      sweepGrad.addColorStop(Math.max(0, outerBias - 0.16), "transparent");
      sweepGrad.addColorStop(outerBias, "rgba(255,249,241,0.28)");
      sweepGrad.addColorStop(Math.min(1, outerBias + 0.18), "rgba(255,241,230,0.08)");
      sweepGrad.addColorStop(1, "transparent");

      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = style.sheenOpacity;
      ctx.filter = `blur(${style.sheenBlur}px)`;
      ctx.fillStyle = sweepGrad;
      ctx.fillRect(
        minX - areaWidth * 0.2,
        minY - areaHeight * 0.5,
        areaWidth * 1.4,
        areaHeight * 2
      );
      ctx.restore();

      // 4) Micro-specular spots for the wet shine pop.
      const side = centerX < width * 0.5 ? -1 : 1;
      drawSpecularBlob(
        ctx,
        path,
        liftX + side * areaWidth * 0.12,
        liftY - areaHeight * 0.06,
        areaWidth * 0.2,
        style.sparkleOpacity,
        style.sparkleBlur
      );
      drawSpecularBlob(
        ctx,
        path,
        centerX + side * areaWidth * 0.02,
        centerY + areaHeight * 0.04,
        areaWidth * 0.15,
        style.sparkleOpacity * 0.72,
        style.sparkleBlur + 0.4
      );
    });
  });
}
