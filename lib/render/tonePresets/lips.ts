import { ProductToneData, RegionDefinition } from "@/lib/utils";
type Landmark = { x: number; y: number };
type Point = { x: number; y: number };
type LipLocalPoint = { u: number; v: number };
type LipFrame = {
  center: Point;
  axisX: number;
  axisY: number;
  normalX: number;
  normalY: number;
  halfWidth: number;
  height: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type LipGraceProfile = {
  toneColor?: string;
  coreOpacity: number;
  coreAlpha: number;
  featherOpacity: number;
  featherAlpha: number;
  satinAlpha: number;
  cornerShiftScale: number;
  coverageScaleX: number;
  coverageScaleY: number;
  shapeSmoothing: number;
};

const DEFAULT_LIP_GRACE_PROFILE: LipGraceProfile = {
  coreOpacity: 0.68,
  coreAlpha: 0.88,
  featherOpacity: 0.52,
  featherAlpha: 0.38,
  satinAlpha: 0.025,
  cornerShiftScale: 0.44,
  coverageScaleX: 1.002,
  coverageScaleY: 1.006,
  shapeSmoothing: 0.68,
};

const LIP_GRACE_PROFILES: Record<string, Partial<LipGraceProfile>> = {
  "Lip Grace Stick - Twilight Zone": {
    toneColor: "#b75a76",
    coreOpacity: 0.72,
    coreAlpha: 0.9,
    featherOpacity: 0.56,
    satinAlpha: 0.028,
  },
  "Lip Grace Stick - Mystique Girl": {
    coreOpacity: 0.58,
    coreAlpha: 0.78,
    featherOpacity: 0.46,
    featherAlpha: 0.32,
    satinAlpha: 0.09,
  },
};

const lipLocalShapeCache = new Map<string, LipLocalPoint[]>();

function getLipGraceProfile(productData: ProductToneData): LipGraceProfile {
  return {
    ...DEFAULT_LIP_GRACE_PROFILE,
    ...(LIP_GRACE_PROFILES[productData.display_name || ""] || {}),
  };
}

function shouldShowLipMaskDebug() {
  if (typeof window === "undefined") return false;
  const rawSearch = (window.location.search || "").toLowerCase();
  return (
    rawSearch.includes("lipdebug=1") ||
    rawSearch.includes("lipdebug=true") ||
    rawSearch.includes("debug=lip") ||
    rawSearch.includes("debug=true")
  );
}

const normalizeRegion = (region: RegionDefinition): number[] => {
  if (Array.isArray(region[0])) return (region as number[][])[0];
  return region as number[];
};

function toPoint(
  landmarks: Landmark[],
  index: number,
  width: number,
  height: number
) {
  const point = landmarks[index];
  if (!point || Number.isNaN(point.x) || Number.isNaN(point.y)) return null;
  return { x: point.x * width, y: point.y * height };
}

function buildClosedPath(points: Point[]) {
  const path = new Path2D();
  if (!points.length) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    path.lineTo(points[i].x, points[i].y);
  }
  path.closePath();
  return path;
}

function widenOuterCorners(outerPoints: Point[], openness: number, shiftScale: number) {
  if (outerPoints.length < 8) return outerPoints;
  const split = Math.floor(outerPoints.length / 2);
  const lipWidth = Math.max(1, Math.abs(outerPoints[split].x - outerPoints[0].x));
  const leftCorner = outerPoints[0];
  const rightCorner = outerPoints[split];
  const centerX = (leftCorner.x + rightCorner.x) * 0.5;
  const centerY = (leftCorner.y + rightCorner.y) * 0.5;
  const axisXRaw = rightCorner.x - leftCorner.x;
  const axisYRaw = rightCorner.y - leftCorner.y;
  const axisLen = Math.hypot(axisXRaw, axisYRaw) || 1;
  const axisX = axisXRaw / axisLen;
  const axisY = axisYRaw / axisLen;
  const closedMouthBias = 1 - clamp01(openness);
  const cornerShiftPx = lipWidth * (0.003 + closedMouthBias * 0.006) * shiftScale;
  const next = outerPoints.map((p) => ({ ...p }));

  const weights = new Map<number, number>();
  const setWeight = (index: number, weight: number) => {
    if (index < 0 || index >= outerPoints.length) return;
    const prev = weights.get(index) || 0;
    weights.set(index, Math.max(prev, weight));
  };

  setWeight(0, 1);
  setWeight(1, 0.56);
  setWeight(2, 0.24);
  setWeight(outerPoints.length - 1, 0.56);
  setWeight(outerPoints.length - 2, 0.24);
  setWeight(split, 1);
  setWeight(split - 1, 0.56);
  setWeight(split - 2, 0.24);
  setWeight(split + 1, 0.56);
  setWeight(split + 2, 0.24);

  for (const [index, weight] of weights.entries()) {
    const point = next[index];
    if (!point) continue;
    const side = (point.x - centerX) * axisX + (point.y - centerY) * axisY < 0 ? -1 : 1;
    point.x += axisX * side * cornerShiftPx * weight;
    point.y += axisY * side * cornerShiftPx * weight;
  }

  return next;
}

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

function getPointBounds(points: Point[]) {
  if (!points.length) return null;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  points.forEach((point) => {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });

  return { minY, maxY };
}

function buildLipFrame(points: Point[], fallbackHeight: number): LipFrame | null {
  if (points.length < 8) return null;

  const split = Math.floor(points.length / 2);
  const leftCorner = points[0];
  const rightCorner = points[split];
  if (!leftCorner || !rightCorner) return null;

  const axisXRaw = rightCorner.x - leftCorner.x;
  const axisYRaw = rightCorner.y - leftCorner.y;
  const width = Math.hypot(axisXRaw, axisYRaw);
  if (width < 1) return null;

  const bounds = getPointBounds(points);
  return {
    center: {
      x: (leftCorner.x + rightCorner.x) * 0.5,
      y: (leftCorner.y + rightCorner.y) * 0.5,
    },
    axisX: axisXRaw / width,
    axisY: axisYRaw / width,
    normalX: -axisYRaw / width,
    normalY: axisXRaw / width,
    halfWidth: Math.max(1, width * 0.5),
    height: Math.max(1, bounds ? bounds.maxY - bounds.minY : fallbackHeight),
  };
}

function toLipLocal(point: Point, frame: LipFrame): LipLocalPoint {
  const dx = point.x - frame.center.x;
  const dy = point.y - frame.center.y;

  return {
    u: (dx * frame.axisX + dy * frame.axisY) / frame.halfWidth,
    v: (dx * frame.normalX + dy * frame.normalY) / frame.height,
  };
}

function fromLipLocal(point: LipLocalPoint, frame: LipFrame): Point {
  return {
    x:
      frame.center.x +
      frame.axisX * point.u * frame.halfWidth +
      frame.normalX * point.v * frame.height,
    y:
      frame.center.y +
      frame.axisY * point.u * frame.halfWidth +
      frame.normalY * point.v * frame.height,
  };
}

function smoothLipShapePoints(
  key: string,
  points: Point[],
  frame: LipFrame | null,
  previousWeight: number,
  fixedIndices: number[]
) {
  if (!frame || points.length < 3) return points;

  const current = points.map((point) => toLipLocal(point, frame));
  const previous = lipLocalShapeCache.get(key);
  if (!previous || previous.length !== current.length) {
    lipLocalShapeCache.set(key, current);
    return points;
  }

  let maxDelta = 0;
  const averageDelta =
    current.reduce((sum, point, index) => {
      const prev = previous[index];
      const delta = Math.hypot(point.u - prev.u, point.v - prev.v);
      maxDelta = Math.max(maxDelta, delta);
      return sum + delta;
    }, 0) / current.length;

  if (averageDelta > 0.16 || maxDelta > 0.42) {
    lipLocalShapeCache.set(key, current);
    return points;
  }

  const currentWeight = 1 - clamp01(previousWeight);
  const smoothedLocal = current.map((point, index) => {
    const prev = previous[index];
    return {
      u: lerp(prev.u, point.u, currentWeight),
      v: lerp(prev.v, point.v, currentWeight),
    };
  });

  lipLocalShapeCache.set(key, smoothedLocal);
  const smoothed = smoothedLocal.map((point) => fromLipLocal(point, frame));
  fixedIndices.forEach((index) => {
    if (points[index]) smoothed[index] = points[index];
  });

  return smoothed;
}

function anchorInnerCornersToOuter(
  innerPoints: Point[],
  outerPoints: Point[],
  openness: number
) {
  if (innerPoints.length < 6 || outerPoints.length < 6) return innerPoints;
  const innerSplit = Math.floor(innerPoints.length / 2);
  const outerSplit = Math.floor(outerPoints.length / 2);
  const next = innerPoints.map((p) => ({ ...p }));
  const cornerWeight = 0.12 + clamp01(openness) * 0.08;
  const nearCornerWeight = 0.18 + clamp01(openness) * 0.12;
  const midCornerWeight = 0.16 + clamp01(openness) * 0.1;
  const farCornerWeight = 0.18 + clamp01(openness) * 0.12;
  const corners = [
    { inner: 0, outer: 0, weight: cornerWeight },
    { inner: innerSplit, outer: outerSplit, weight: cornerWeight },
    { inner: 1, outer: 1, weight: nearCornerWeight },
    {
      inner: Math.max(0, innerSplit - 1),
      outer: Math.max(0, outerSplit - 1),
      weight: midCornerWeight,
    },
    {
      inner: Math.min(innerPoints.length - 1, innerSplit + 1),
      outer: Math.min(outerPoints.length - 1, outerSplit + 1),
      weight: midCornerWeight,
    },
    { inner: innerPoints.length - 1, outer: outerPoints.length - 1, weight: farCornerWeight },
    { inner: 2, outer: 2, weight: 0.16 + clamp01(openness) * 0.1 },
    { inner: innerPoints.length - 2, outer: outerPoints.length - 2, weight: 0.16 + clamp01(openness) * 0.1 },
  ];

  for (const pair of corners) {
    const innerPoint = next[pair.inner];
    const outerPoint = outerPoints[pair.outer];
    if (!innerPoint || !outerPoint) continue;
    innerPoint.x += (outerPoint.x - innerPoint.x) * pair.weight;
    innerPoint.y += (outerPoint.y - innerPoint.y) * pair.weight;
  }

  return next;
}

export function renderLipGrace(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const outer = productData?.regions?.lips_outer
    ? normalizeRegion(productData.regions.lips_outer)
    : [];
  const inner = productData?.regions?.lips_inner
    ? normalizeRegion(productData.regions.lips_inner)
    : [];
  if (!outer.length) return;
  const profile = getLipGraceProfile(productData);
  const toneColor = profile.toneColor || productData.color;

  const outerPoints: Point[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const index of outer) {
    const point = toPoint(landmarks, index, width, height);
    if (!point) return;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    outerPoints.push(point);
  }

  const innerPoints: Point[] = [];
  for (const index of inner) {
    const point = toPoint(landmarks, index, width, height);
    if (!point) return;
    innerPoints.push(point);
  }

  const lipWidth = Math.max(1, maxX - minX);
  const lipHeight = Math.max(1, maxY - minY);
  const upper13 = toPoint(landmarks, 13, width, height);
  const lower14 = toPoint(landmarks, 14, width, height);
  const mouthGap = upper13 && lower14 ? Math.abs(lower14.y - upper13.y) : 0;
  const openness = clamp01(mouthGap / Math.max(1, lipHeight * 0.52));
  const widenedOuterPoints = widenOuterCorners(
    outerPoints,
    openness,
    profile.cornerShiftScale
  );
  const closedMouthBias = 1 - openness;
  const rawCoverageOuterPoints = scaleFromCenterXY(
    widenedOuterPoints,
    { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 },
    profile.coverageScaleX + closedMouthBias * 0.002,
    profile.coverageScaleY + closedMouthBias * 0.003
  );
  const outerSplit = Math.floor(rawCoverageOuterPoints.length / 2);
  const innerSplit = Math.floor(innerPoints.length / 2);
  const lipFrame = buildLipFrame(rawCoverageOuterPoints, lipHeight);
  const smoothingKey = `${productData.display_name || "lip-grace"}:${width}x${height}`;
  const coverageOuterPoints = smoothLipShapePoints(
    `${smoothingKey}:outer`,
    rawCoverageOuterPoints,
    lipFrame,
    profile.shapeSmoothing,
    [0, outerSplit]
  );
  const stabilizedInnerPoints = smoothLipShapePoints(
    `${smoothingKey}:inner`,
    innerPoints,
    lipFrame,
    Math.min(0.56, profile.shapeSmoothing),
    [0, innerSplit]
  );
  const shouldCutMouthCavity =
    innerPoints.length >= 3 && openness > 0.86 && mouthGap > lipHeight * 0.56;
  const renderMinX = Math.min(...coverageOuterPoints.map((p) => p.x));
  const renderMaxX = Math.max(...coverageOuterPoints.map((p) => p.x));
  const renderLipWidth = Math.max(1, renderMaxX - renderMinX);
  const featherPx = Math.max(1.35, Math.min(3.4, renderLipWidth * 0.028));

  const coreColor = hexToRgba(
    toneColor,
    Math.min(1, productData.opacity * profile.coreOpacity)
  );
  const featherFillColor = hexToRgba(
    toneColor,
    Math.min(1, productData.opacity * profile.featherOpacity)
  );

  const outerPath = buildClosedPath(coverageOuterPoints);
  const innerPath = shouldCutMouthCavity ? buildClosedPath(stabilizedInnerPoints) : null;
  const combined = new Path2D();
  combined.addPath(outerPath);
  if (innerPath) combined.addPath(innerPath);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = profile.coreAlpha;
  ctx.fillStyle = coreColor;
  ctx.fill(combined, "evenodd");
  ctx.restore();

  ctx.save();
  ctx.clip(combined, "evenodd");
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = profile.featherAlpha;
  ctx.filter = `blur(${featherPx * 1.05}px)`;
  ctx.fillStyle = featherFillColor;
  ctx.fill(combined, "evenodd");
  ctx.restore();

  if (profile.satinAlpha > 0) {
    const satin = ctx.createLinearGradient(
      (minX + maxX) * 0.5,
      minY,
      (minX + maxX) * 0.5,
      maxY
    );
    satin.addColorStop(0, "rgba(255, 236, 226, 0.9)");
    satin.addColorStop(0.32, "rgba(255, 226, 218, 0.34)");
    satin.addColorStop(0.68, "rgba(255, 226, 218, 0.18)");
    satin.addColorStop(1, "rgba(255, 226, 218, 0)");

    ctx.save();
    ctx.clip(combined, "evenodd");
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = profile.satinAlpha;
    ctx.filter = `blur(${Math.max(1.4, featherPx * 1.3)}px)`;
    ctx.fillStyle = satin;
    ctx.fillRect(
      renderMinX - renderLipWidth * 0.08,
      minY - lipHeight * 0.2,
      renderLipWidth * 1.16,
      lipHeight * 1.42
    );
    ctx.restore();
  }

  const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, 250);
  grad.addColorStop(0, "transparent");
  grad.addColorStop(1, "rgba(0,0,0,0.15)");
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = grad;
  ctx.fill(combined);
  ctx.restore();

  if (shouldShowLipMaskDebug()) {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(0, 255, 255, 0.95)";
    ctx.lineWidth = 1.4;
    ctx.stroke(outerPath);
    ctx.restore();
  }
}
