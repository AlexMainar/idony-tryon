import { ProductToneData, RegionDefinition } from "@/lib/utils";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };
type LipOilProfile = {
  toneColor?: string;
  baseAlpha: number;
  depositAlpha: number;
  blendAlpha: number;
  bodyScaleX: number;
  bodyScaleY: number;
};

const LIP_OIL_PROFILES: Record<string, LipOilProfile> = {
  "Lip Bloom Oil & Tint - Ruby Vice": {
    toneColor: "#d40a39",
    baseAlpha: 0.66,
    depositAlpha: 0.34,
    blendAlpha: 0.08,
    bodyScaleX: 1,
    bodyScaleY: 1,
  },
  "Lip Bloom Oil & Tint - Clover Club": {
    toneColor: "#af4b55",
    baseAlpha: 0.58,
    depositAlpha: 0.28,
    blendAlpha: 0.07,
    bodyScaleX: 1,
    bodyScaleY: 1,
  },
  "Lip Bloom Oil & Tint - Barbados": {
    toneColor: "#845557",
    baseAlpha: 0.6,
    depositAlpha: 0.3,
    blendAlpha: 0.065,
    bodyScaleX: 1,
    bodyScaleY: 1,
  },
};

const normalizeRegion = (region: RegionDefinition): number[] => {
  if (Array.isArray(region[0])) return (region as number[][])[0];
  return region as number[];
};

const toPoint = (
  landmarks: Landmark[],
  index: number,
  width: number,
  height: number
) => {
  const p = landmarks[index];
  if (!p || Number.isNaN(p.x) || Number.isNaN(p.y)) return null;
  return { x: p.x * width, y: p.y * height };
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
function shouldShowLipMaskDebug() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search || "");
  const lipDebug = (params.get("lipdebug") || "").toLowerCase();
  const debug = (params.get("debug") || "").toLowerCase();
  return (
    lipDebug === "1" ||
    lipDebug === "true" ||
    lipDebug === "raw" ||
    lipDebug === "image" ||
    debug === "lip" ||
    debug === "lipraw" ||
    debug === "lipimage" ||
    debug === "lipmask"
  );
}

const fillMaskedBounds = (
  ctx: CanvasRenderingContext2D,
  mask: Path2D,
  fillStyle: string | CanvasGradient | CanvasPattern,
  composite: GlobalCompositeOperation,
  alpha: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  blurPx = 0
) => {
  const pad = Math.max(2, blurPx * 3);
  ctx.save();
  ctx.clip(mask, "evenodd");
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = alpha;
  ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";
  ctx.fillStyle = fillStyle;
  ctx.fillRect(
    minX - pad,
    minY - pad,
    maxX - minX + pad * 2,
    maxY - minY + pad * 2
  );
  ctx.restore();
};

const buildClosedPath = (points: Point[]): Path2D => {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    path.lineTo(points[i].x, points[i].y);
  }
  path.closePath();
  return path;
};

const scaleFromCenterXY = (
  points: Point[],
  center: Point,
  scaleX: number,
  scaleY: number
): Point[] =>
  points.map((p) => ({
    x: center.x + (p.x - center.x) * scaleX,
    y: center.y + (p.y - center.y) * scaleY,
  }));

const expandLipCoverage = (
  points: Point[],
  center: Point
): Point[] => {
  return scaleFromCenterXY(
    points,
    center,
    1.004,
    1.008
  );
};

function getPointBounds(points: Point[]) {
  if (!points.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function buildLipSectionMask(
  outerPoints: Point[],
  innerPoints: Point[]
) {
  const mask = new Path2D();
  if (outerPoints.length >= 3) mask.addPath(buildClosedPath(outerPoints));
  if (innerPoints.length >= 3) mask.addPath(buildClosedPath(innerPoints));

  return mask;
}

export function renderLipOil(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string,
  _yawFade = 1,
) {
  if (!productData?.regions?.lips_outer || !productData?.regions?.lips_inner) return;

  const outer = normalizeRegion(productData.regions["lips_outer"]);
  const inner = normalizeRegion(productData.regions["lips_inner"]);
  const profile =
    LIP_OIL_PROFILES[productData.display_name || ""] || {
      baseAlpha: 0.58,
      depositAlpha: 0.28,
      blendAlpha: 0.07,
      bodyScaleX: 1,
      bodyScaleY: 1,
    };

  const toneHex = profile.toneColor || productData.color;

  const outerPoints: Point[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let idx = 0; idx < outer.length; idx += 1) {
    const i = outer[idx];
    const point = toPoint(landmarks, i, width, height);
    if (!point) return;
    const { x, y } = point;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    outerPoints.push({ x, y });
  }

  const innerPoints: Point[] = [];
  for (let idx = 0; idx < inner.length; idx += 1) {
    const i = inner[idx];
    const point = toPoint(landmarks, i, width, height);
    if (!point) return;
    const { x, y } = point;
    innerPoints.push({ x, y });
  }

  const boundsHeight = Math.max(1, maxY - minY);
  const outerSplit = Math.floor(outerPoints.length / 2);
  const outerQuarter = Math.floor(outerPoints.length / 4);
  const outerThreeQuarter = Math.min(
    outerPoints.length - 1,
    outerSplit + outerQuarter
  );
  const upper13 = toPoint(landmarks, 13, width, height);
  const lower14 = toPoint(landmarks, 14, width, height);
  if (!upper13 || !lower14) return;
  const leftCorner = outerPoints[0];
  const rightCorner = outerPoints[outerSplit];
  const lipCenterX =
    leftCorner && rightCorner ? (leftCorner.x + rightCorner.x) * 0.5 : (minX + maxX) / 2;
  const lipCenterY = (minY + maxY) * 0.5;
  const lipHeight = boundsHeight;
  const lipCenter = { x: lipCenterX, y: lipCenterY };
  const mouthGapPx = Math.abs(lower14.y - upper13.y);
  const openness = clamp01(mouthGapPx / Math.max(1, lipHeight * 0.52));
  const shouldCutMouthCavity =
    innerPoints.length >= 3 && openness > 0.86 && mouthGapPx > lipHeight * 0.56;
  const coverageOuterPoints = expandLipCoverage(outerPoints, lipCenter);
  const outerBounds = getPointBounds(coverageOuterPoints);
  if (!outerBounds) return;
  const renderMinX = outerBounds.minX;
  const renderMinY = outerBounds.minY;
  const renderMaxX = outerBounds.maxX;
  const renderMaxY = outerBounds.maxY;
  const renderLipWidth = Math.max(1, renderMaxX - renderMinX);

  const baseBlurRaw = Math.max(1.0, Math.min(2.0, renderLipWidth * 0.016));
  const blurDamping = 1 - openness * 0.34;
  const baseBlur = Math.max(0.55, baseBlurRaw * blurDamping * 0.82);

  const baseInnerMaskPoints = shouldCutMouthCavity ? innerPoints : [];
  const bodyOuterPoints = scaleFromCenterXY(
    coverageOuterPoints,
    lipCenter,
    profile.bodyScaleX,
    profile.bodyScaleY
  );
  const bodyInnerMaskPoints = shouldCutMouthCavity
    ? scaleFromCenterXY(innerPoints, lipCenter, profile.bodyScaleX, profile.bodyScaleY)
    : [];

  const lipColorMask = buildLipSectionMask(coverageOuterPoints, baseInnerMaskPoints);
  const lipBodyMask = buildLipSectionMask(bodyOuterPoints, bodyInnerMaskPoints);
  const toneBody = ctx.createLinearGradient(lipCenterX, renderMinY, lipCenterX, renderMaxY);
  toneBody.addColorStop(0, hexToRgba(toneHex, Math.min(1, productData.opacity * 1.08)));
  toneBody.addColorStop(0.34, hexToRgba(toneHex, Math.min(1, productData.opacity * 1.02)));
  toneBody.addColorStop(0.7, hexToRgba(toneHex, Math.min(1, productData.opacity * 0.96)));
  toneBody.addColorStop(1, hexToRgba(toneHex, Math.min(1, productData.opacity * 1.04)));

  fillMaskedBounds(
    ctx,
    lipColorMask,
    toneBody,
    "source-over",
    clamp01(profile.baseAlpha),
    renderMinX,
    renderMinY,
    renderMaxX,
    renderMaxY,
    Math.max(0.35, baseBlur * 0.55)
  );

  fillMaskedBounds(
    ctx,
    lipBodyMask,
    hexToRgba(toneHex, Math.min(1, productData.opacity * 1.22)),
    "multiply",
    clamp01(profile.depositAlpha),
    renderMinX,
    renderMinY,
    renderMaxX,
    renderMaxY,
    Math.max(0.3, baseBlur * 0.48)
  );

  fillMaskedBounds(
    ctx,
    lipColorMask,
    hexToRgba(toneHex, Math.min(1, productData.opacity * 1.06)),
    "soft-light",
    clamp01(profile.blendAlpha),
    renderMinX,
    renderMinY,
    renderMaxX,
    renderMaxY,
    Math.max(0.3, baseBlur * 0.5)
  );

  if (shouldShowLipMaskDebug()) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(0, 255, 255, 0.95)";
    ctx.lineWidth = 1.6;
    ctx.stroke(buildClosedPath(coverageOuterPoints));
    ctx.strokeStyle = "rgba(255, 190, 0, 0.95)";
    ctx.stroke(buildClosedPath(bodyOuterPoints));
    ctx.strokeStyle = "rgba(255, 80, 80, 0.95)";
    ctx.stroke(lipBodyMask);
    ctx.restore();
  }
}
