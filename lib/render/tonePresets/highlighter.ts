import { ProductToneData, RegionDefinition } from "@/lib/utils";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };

const normalizeRegionPolygons = (region: RegionDefinition): number[][] => {
  if (Array.isArray(region[0])) return region as number[][];
  return [region as number[]];
};

type AreaStyle = {
  baseOpacity: number;
  liftOpacity: number;
  sweepOpacity: number;
  spotOpacity: number;
  baseBlur: number;
  liftBlur: number;
  sweepBlur: number;
  spotBlur: number;
  liftRadiusX: number;
  liftRadiusY: number;
  shiftX: number;
  shiftY: number;
};

const AREA_STYLES: Record<string, AreaStyle> = {
  upper_cheeks: {
    baseOpacity: 0.88,
    liftOpacity: 0.9,
    sweepOpacity: 0.55,
    spotOpacity: 0.75,
    baseBlur: 8,
    liftBlur: 7,
    sweepBlur: 5,
    spotBlur: 4,
    liftRadiusX: 1.45,
    liftRadiusY: 1.2,
    shiftX: 0.14,
    shiftY: 0.22,
  },
  nose_tip: {
    baseOpacity: 0.58,
    liftOpacity: 0.65,
    sweepOpacity: 0.12,
    spotOpacity: 0.72,
    baseBlur: 5,
    liftBlur: 5,
    sweepBlur: 4,
    spotBlur: 3,
    liftRadiusX: 1.1,
    liftRadiusY: 1.1,
    shiftX: 0,
    shiftY: 0.1,
  },
  eyelids: {
    baseOpacity: 0.55,
    liftOpacity: 0.5,
    sweepOpacity: 0,
    spotOpacity: 0.35,
    baseBlur: 4,
    liftBlur: 4,
    sweepBlur: 3,
    spotBlur: 2,
    liftRadiusX: 1.2,
    liftRadiusY: 1.1,
    shiftX: 0.08,
    shiftY: 0.1,
  },
  cupid_bow: {
    baseOpacity: 0.52,
    liftOpacity: 0.55,
    sweepOpacity: 0.1,
    spotOpacity: 0.5,
    baseBlur: 4,
    liftBlur: 4,
    sweepBlur: 3,
    spotBlur: 2,
    liftRadiusX: 1.15,
    liftRadiusY: 1.05,
    shiftX: 0,
    shiftY: 0.05,
  },
};

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

  indices.forEach((idx, pointIdx) => {
    const l = landmarks[idx];
    if (!l) return;
    const p = { x: l.x * width, y: l.y * height };
    points.push(p);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    if (pointIdx === 0) path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
  });

  if (points.length >= 3) path.closePath();
  return { path, points, minX, minY, maxX, maxY };
};

export function renderHighlighter(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const baseOpacity = Math.max(0.2, Math.min(0.8, productData.opacity || 0.4));
  const pearlCore = hexToRgba("#fff8ef", baseOpacity * 0.95);
  const pearlMid = hexToRgba("#fff1e1", baseOpacity * 0.65);
  const toneBase = hexToRgba(productData.color, baseOpacity * 0.75);
  const toneMid = hexToRgba(productData.color, baseOpacity * 0.42);

  // Luminizer should lift high points, but never look like eye makeup.
  const highlightAreas = ["upper_cheeks", "nose_tip", "cupid_bow"];
  highlightAreas.forEach((area) => {
    const region = productData.regions[area];
    if (!region) return;

    const polygons = normalizeRegionPolygons(region);
    const style = AREA_STYLES[area] || AREA_STYLES.upper_cheeks;

    polygons.forEach((indices) => {
      const built = buildAreaPath(indices, landmarks, width, height);
      const { path, points, minX, minY, maxX, maxY } = built;
      if (points.length < 3) return;

      const areaWidth = Math.max(1, maxX - minX);
      const areaHeight = Math.max(1, maxY - minY);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const liftX = centerX + areaWidth * style.shiftX;
      const liftY = centerY - areaHeight * style.shiftY;

      // 1) Base illuminated veil inside the exact face region
      const baseGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.max(areaWidth, areaHeight) * 1.1
      );
      baseGrad.addColorStop(0, toneBase);
      baseGrad.addColorStop(0.55, toneMid);
      baseGrad.addColorStop(1, "transparent");

      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = style.baseOpacity;
      ctx.filter = `blur(${style.baseBlur}px)`;
      ctx.fillStyle = baseGrad;
      ctx.fillRect(
        minX - areaWidth,
        minY - areaHeight,
        areaWidth * 3,
        areaHeight * 3
      );
      ctx.restore();

      // 2) Pearl lift that gives "volume" on cheekbone/high points
      const liftGrad = ctx.createRadialGradient(
        liftX,
        liftY,
        0,
        liftX,
        liftY,
        Math.max(areaWidth * style.liftRadiusX, areaHeight * style.liftRadiusY)
      );
      liftGrad.addColorStop(0, pearlCore);
      liftGrad.addColorStop(0.45, pearlMid);
      liftGrad.addColorStop(1, "transparent");

      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = style.liftOpacity;
      ctx.filter = `blur(${style.liftBlur}px)`;
      ctx.fillStyle = liftGrad;
      ctx.fillRect(
        minX - areaWidth,
        minY - areaHeight,
        areaWidth * 3,
        areaHeight * 3
      );
      ctx.restore();

      // 3) Specular sweep to avoid flat circular glow
      if (style.sweepOpacity > 0) {
        const sweepGrad = ctx.createLinearGradient(minX, centerY, maxX, centerY);
        sweepGrad.addColorStop(0, "transparent");
        sweepGrad.addColorStop(0.48, "rgba(255,255,255,0.18)");
        sweepGrad.addColorStop(0.62, "rgba(255,255,255,0.08)");
        sweepGrad.addColorStop(1, "transparent");

        ctx.save();
        ctx.clip(path);
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = style.sweepOpacity;
        ctx.filter = `blur(${style.sweepBlur}px)`;
        ctx.fillStyle = sweepGrad;
        ctx.fillRect(
          minX - areaWidth * 0.25,
          minY - areaHeight * 0.4,
          areaWidth * 1.5,
          areaHeight * 1.8
        );
        ctx.restore();
      }

      // 4) Tight wet spot for bright "ethereal" sparkle
      const spotGrad = ctx.createRadialGradient(
        liftX,
        liftY,
        0,
        liftX,
        liftY,
        Math.max(areaWidth, areaHeight) * 0.38
      );
      spotGrad.addColorStop(0, "rgba(255,255,255,0.24)");
      spotGrad.addColorStop(1, "transparent");

      ctx.save();
      ctx.clip(path);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = style.spotOpacity;
      ctx.filter = `blur(${style.spotBlur}px)`;
      ctx.fillStyle = spotGrad;
      ctx.fillRect(
        minX - areaWidth * 0.5,
        minY - areaHeight * 0.7,
        areaWidth * 2,
        areaHeight * 2
      );
      ctx.restore();
    });
  });
}
