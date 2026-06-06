import { ProductToneData, RegionDefinition } from "@/lib/utils";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };

type BuiltArea = {
  path: Path2D;
  points: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  areaWidth: number;
  areaHeight: number;
};

type SoftPathMask = {
  bounds: BuiltArea;
  featherPx: number;
};

type BronzerDiffuseMasks = {
  core: SoftPathMask;
  body: SoftPathMask;
  outer: SoftPathMask;
  lift: SoftPathMask;
};

type GradientSource = CanvasGradient | ((targetCtx: CanvasRenderingContext2D) => CanvasGradient);

const CHEEKBONE_MIRROR_MAP: Record<number, number> = {
  234: 454,
  93: 323,
  132: 361,
  58: 288,
  172: 397,
  136: 365,
};

const TEMPLE_MIRROR_MAP: Record<number, number> = {
  400: 176,
  379: 149,
  365: 136,
  397: 172,
  288: 58,
  361: 132,
};

const BRONZER_CHEEK_BAND = {
  left: {
    upper: [143, 111, 117, 118, 119, 120],
    lower: [123, 50, 101, 36],
    outerBridge: [116],
  },
  right: {
    upper: [372, 340, 346, 347, 348, 349],
    lower: [352, 280, 330, 266],
    outerBridge: [345],
  },
} as const;

const BRONZER_TEMPLE_AREAS = {
  left: [34, 127, 139, 156, 143, 116],
  right: [264, 356, 368, 383, 372, 345],
} as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixPoint = (a: Point, b: Point, t: number): Point => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});
const landmarkToCanvasPoint = (landmark: Landmark, width: number, height: number): Point => ({
  x: landmark.x * width,
  y: landmark.y * height,
});

const normalizeRegionPolygons = (region?: RegionDefinition | null): number[][] => {
  if (!region) return [];
  if (Array.isArray(region[0])) return region as number[][];
  return [region as number[]];
};

const parseHexColor = (hex: string) => {
  const clean = hex.replace("#", "");
  const normalized =
    clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean;

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
};

const mixHexColors = (base: string, target: string, t: number) => {
  const from = parseHexColor(base);
  const to = parseHexColor(target);
  const amount = clamp01(t);
  const toChannel = (value: number) => value.toString(16).padStart(2, "0");

  return `#${toChannel(Math.round(lerp(from.r, to.r, amount)))}${toChannel(
    Math.round(lerp(from.g, to.g, amount))
  )}${toChannel(Math.round(lerp(from.b, to.b, amount)))}`;
};

const buildAreaPath = (
  indices: number[],
  landmarks: Landmark[],
  width: number,
  height: number
): BuiltArea | null => {
  const points: Point[] = [];
  const path = new Path2D();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;

  indices.forEach((index) => {
    const landmark = landmarks[index];
    if (!landmark) return;

    const point = { x: landmark.x * width, y: landmark.y * height };
    points.push(point);
    sumX += point.x;
    sumY += point.y;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);

    if (points.length === 1) path.moveTo(point.x, point.y);
    else path.lineTo(point.x, point.y);
  });

  if (points.length < 3) return null;
  path.closePath();

  return {
    path,
    points,
    minX,
    minY,
    maxX,
    maxY,
    centerX: sumX / points.length,
    centerY: sumY / points.length,
    areaWidth: Math.max(1, maxX - minX),
    areaHeight: Math.max(1, maxY - minY),
  };
};

const buildAreaFromPoints = (points: Point[]): BuiltArea | null => {
  if (points.length < 3) return null;

  const path = new Path2D();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;

  points.forEach((point, idx) => {
    sumX += point.x;
    sumY += point.y;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);

    if (idx === 0) path.moveTo(point.x, point.y);
    else path.lineTo(point.x, point.y);
  });

  path.closePath();

  return {
    path,
    points,
    minX,
    minY,
    maxX,
    maxY,
    centerX: sumX / points.length,
    centerY: sumY / points.length,
    areaWidth: Math.max(1, maxX - minX),
    areaHeight: Math.max(1, maxY - minY),
  };
};

const transformBuiltArea = (
  built: BuiltArea,
  transformPoint: (point: Point) => Point
): BuiltArea | null => buildAreaFromPoints(built.points.map(transformPoint));

const buildLinePoints = (
  indices: readonly number[],
  landmarks: Landmark[],
  width: number,
  height: number
) =>
  indices
    .map((index) => landmarks[index])
    .filter(Boolean)
    .map((landmark) => ({ x: landmark.x * width, y: landmark.y * height }));

const getDistance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const samplePointOnLine = (points: Point[], t: number): Point | null => {
  if (points.length < 2) return null;

  const clampedT = clamp01(t);
  let totalLength = 0;
  const segments: { start: Point; end: Point; length: number }[] = [];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= 0) continue;
    segments.push({ start, end, length });
    totalLength += length;
  }

  if (totalLength <= 0) return points[0];

  let target = totalLength * clampedT;
  for (const segment of segments) {
    if (target <= segment.length) {
      const ratio = segment.length === 0 ? 0 : target / segment.length;
      return {
        x: lerp(segment.start.x, segment.end.x, ratio),
        y: lerp(segment.start.y, segment.end.y, ratio),
      };
    }
    target -= segment.length;
  }

  return points[points.length - 1];
};

const orientLineToMatch = (reference: Point[], candidate: Point[]) => {
  if (reference.length < 2 || candidate.length < 2) return candidate;

  const sameDirection =
    getDistance(reference[0], candidate[0]) +
    getDistance(reference[reference.length - 1], candidate[candidate.length - 1]);
  const reverseDirection =
    getDistance(reference[0], candidate[candidate.length - 1]) +
    getDistance(reference[reference.length - 1], candidate[0]);

  return reverseDirection < sameDirection ? candidate.slice().reverse() : candidate;
};

const buildBronzerSweepPath = (
  upperIndices: readonly number[],
  lowerIndices: readonly number[],
  outerBridgeIndices: readonly number[],
  landmarks: Landmark[],
  width: number,
  height: number,
  faceCenterX: number
) => {
  const upper = buildLinePoints(upperIndices, landmarks, width, height);
  const lower = buildLinePoints(lowerIndices, landmarks, width, height);
  const outerBridge = buildLinePoints(outerBridgeIndices, landmarks, width, height);
  if (upper.length < 2 || lower.length < 2) return null;

  const alignedLower = orientLineToMatch(upper, lower);
  const lowerScale = 1.18;
  const expandedLower: Point[] = [];
  const lowerSamples = Math.max(upper.length, alignedLower.length, 7);

  for (let i = 0; i < lowerSamples; i += 1) {
    const t = lowerSamples === 1 ? 0 : i / (lowerSamples - 1);
    const upperPoint = samplePointOnLine(upper, t);
    const lowerPoint = samplePointOnLine(alignedLower, t);
    if (!upperPoint || !lowerPoint) continue;

    expandedLower.push({
      x: upperPoint.x + (lowerPoint.x - upperPoint.x) * lowerScale,
      y: upperPoint.y + (lowerPoint.y - upperPoint.y) * lowerScale,
    });
  }

  const upperOuterIndex =
    outerBridge.length &&
    getDistance(outerBridge[0], upper[0]) > getDistance(outerBridge[0], upper[upper.length - 1])
      ? upper.length - 1
      : 0;
  const lowerOuterIndex =
    upperOuterIndex === 0 ? 0 : Math.max(0, expandedLower.length - 1);
  const upperOuter = upper[upperOuterIndex];
  const lowerOuter = expandedLower[lowerOuterIndex] || alignedLower[lowerOuterIndex];
  const expandedOuterBridge = outerBridge.map((point) => {
    const anchor = {
      x: (upperOuter.x + lowerOuter.x) / 2,
      y: (upperOuter.y + lowerOuter.y) / 2,
    };

    return {
      x: anchor.x + (point.x - anchor.x) * 1.12,
      y: anchor.y + (point.y - anchor.y) * 1.12,
    };
  });

  const built = buildAreaFromPoints([
    ...upper,
    ...expandedLower.slice().reverse(),
    ...expandedOuterBridge,
  ]);
  if (!built) return null;

  const side = built.centerX < faceCenterX ? -1 : 1;

  return (
    transformBuiltArea(built, (point) => ({
      x: point.x + (point.x - built.centerX) * 0.12 + side * built.areaWidth * 0.01,
      y: built.centerY + (point.y - built.centerY) * 0.88 - built.areaHeight * 0.08,
    })) ?? built
  );
};

const buildTempleArea = (
  indices: readonly number[],
  landmarks: Landmark[],
  width: number,
  height: number,
  faceCenterX: number
) => {
  const templeLandmark = landmarks[indices[0]];
  const forehead = landmarks[10];
  if (!templeLandmark || !forehead) {
    return buildAreaPath([...indices], landmarks, width, height);
  }

  const side = templeLandmark.x * width < faceCenterX ? -1 : 1;
  const upperInner = landmarks[side < 0 ? 109 : 338];
  const innerBridge = landmarks[side < 0 ? 108 : 337];
  const upperOuter = landmarks[side < 0 ? 67 : 297];
  const lowerOuter = landmarks[side < 0 ? 103 : 332];
  const hairlineOuter = landmarks[side < 0 ? 54 : 284];
  if (!upperInner || !innerBridge || !upperOuter || !lowerOuter || !hairlineOuter) {
    return buildAreaPath([...indices], landmarks, width, height);
  }

  const foreheadPoint = landmarkToCanvasPoint(forehead, width, height);
  const upperInnerPoint = landmarkToCanvasPoint(upperInner, width, height);
  const innerBridgePoint = landmarkToCanvasPoint(innerBridge, width, height);
  const upperOuterPoint = landmarkToCanvasPoint(upperOuter, width, height);
  const lowerOuterPoint = landmarkToCanvasPoint(lowerOuter, width, height);
  const hairlineOuterPoint = landmarkToCanvasPoint(hairlineOuter, width, height);
  const verticalSpan = Math.max(lowerOuterPoint.y - foreheadPoint.y, 14);
  const lift = verticalSpan * 0.42;
  const outerPull = side * Math.max(verticalSpan * 0.08, 4);

  const points = [
    {
      ...mixPoint(upperInnerPoint, foreheadPoint, 0.26),
      x: lerp(upperInnerPoint.x, foreheadPoint.x, 0.22) - side * verticalSpan * 0.02,
      y: lerp(innerBridgePoint.y, foreheadPoint.y, 0.46) + verticalSpan * 0.08,
    },
    {
      ...mixPoint(upperInnerPoint, foreheadPoint, 0.58),
      x: lerp(upperInnerPoint.x, foreheadPoint.x, 0.56),
      y: lerp(upperInnerPoint.y, foreheadPoint.y, 0.64) - lift * 0.08,
    },
    {
      ...mixPoint(upperOuterPoint, foreheadPoint, 0.34),
      x: lerp(upperOuterPoint.x, foreheadPoint.x, 0.3) + outerPull * 0.12,
      y: lerp(upperOuterPoint.y, foreheadPoint.y, 0.46) - lift * 0.16,
    },
    {
      ...mixPoint(hairlineOuterPoint, foreheadPoint, 0.14),
      x: lerp(hairlineOuterPoint.x, foreheadPoint.x, 0.1) + outerPull,
      y: lerp(hairlineOuterPoint.y, foreheadPoint.y, 0.14) - lift * 0.28,
    },
    {
      ...mixPoint(hairlineOuterPoint, upperOuterPoint, 0.48),
      x: lerp(hairlineOuterPoint.x, upperOuterPoint.x, 0.42) + outerPull * 0.56,
      y: lerp(hairlineOuterPoint.y, upperOuterPoint.y, 0.56) - lift * 0.06,
    },
    {
      ...mixPoint(lowerOuterPoint, upperOuterPoint, 0.76),
      x: lerp(lowerOuterPoint.x, upperOuterPoint.x, 0.68) + outerPull * 0.16,
      y: lerp(lowerOuterPoint.y, upperOuterPoint.y, 0.74) + verticalSpan * 0.04,
    },
    {
      ...mixPoint(innerBridgePoint, upperOuterPoint, 0.34),
      y: lerp(innerBridgePoint.y, foreheadPoint.y, 0.42) + verticalSpan * 0.1,
    },
  ];

  const built = buildAreaFromPoints(points);
  if (!built) return null;

  return (
    transformBuiltArea(built, (point) => ({
      x:
        point.x +
        side * (built.areaWidth * 0.34 + Math.max(verticalSpan * 0.08, 6)) +
        (point.x - built.centerX) * 0.06,
      y: point.y - built.areaHeight * 0.03,
    })) ?? built
  );
};

const buildNoseContourAreas = (built: BuiltArea) => {
  const centerX = built.centerX;
  const topY = built.minY - built.areaHeight * 0.9;
  const midY = built.centerY;
  const bottomY = built.maxY + built.areaHeight * 0.35;
  const sideOffset = Math.max(built.areaWidth * 1.05, 8);
  const stripWidth = Math.max(built.areaWidth * 0.72, 5);

  const left = buildAreaFromPoints([
    { x: centerX - sideOffset - stripWidth * 0.55, y: topY },
    { x: centerX - sideOffset + stripWidth * 0.05, y: topY + built.areaHeight * 0.32 },
    { x: centerX - sideOffset + stripWidth * 0.18, y: midY - built.areaHeight * 0.14 },
    { x: centerX - sideOffset - stripWidth * 0.02, y: bottomY },
    { x: centerX - sideOffset - stripWidth * 0.52, y: bottomY + built.areaHeight * 0.18 },
    { x: centerX - sideOffset - stripWidth * 0.86, y: midY + built.areaHeight * 0.08 },
  ]);

  const right = buildAreaFromPoints([
    { x: centerX + sideOffset + stripWidth * 0.55, y: topY },
    { x: centerX + sideOffset - stripWidth * 0.05, y: topY + built.areaHeight * 0.32 },
    { x: centerX + sideOffset - stripWidth * 0.18, y: midY - built.areaHeight * 0.14 },
    { x: centerX + sideOffset + stripWidth * 0.02, y: bottomY },
    { x: centerX + sideOffset + stripWidth * 0.52, y: bottomY + built.areaHeight * 0.18 },
    { x: centerX + sideOffset + stripWidth * 0.86, y: midY + built.areaHeight * 0.08 },
  ]);

  return [left, right].filter(Boolean) as BuiltArea[];
};

const buildEyelidBandArea = (built: BuiltArea) => {
  const upperArc = built.points.map((point) => ({
    x: built.centerX + (point.x - built.centerX) * 0.94,
    y: point.y - built.areaHeight * 1.5,
  }));
  const lowerArc = built.points
    .slice()
    .reverse()
    .map((point) => ({
      x: built.centerX + (point.x - built.centerX) * 1.02,
      y: point.y - built.areaHeight * 0.64,
    }));

  return buildAreaFromPoints([...upperArc, ...lowerArc]) ?? built;
};

const resolveGradient = (
  gradient: GradientSource,
  targetCtx: CanvasRenderingContext2D
) => (typeof gradient === "function" ? gradient(targetCtx) : gradient);

const renderWithSoftPathMask = (
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  composite: GlobalCompositeOperation,
  contentBounds: { minX: number; minY: number; maxX: number; maxY: number },
  mask: SoftPathMask,
  drawContent: (layerCtx: CanvasRenderingContext2D) => void,
  fillRule: CanvasFillRule = "nonzero"
) => {
  const pad = Math.ceil(Math.max(8, mask.featherPx * 3));
  const minX = Math.floor(Math.min(contentBounds.minX, mask.bounds.minX) - pad);
  const minY = Math.floor(Math.min(contentBounds.minY, mask.bounds.minY) - pad);
  const maxX = Math.ceil(Math.max(contentBounds.maxX, mask.bounds.maxX) + pad);
  const maxY = Math.ceil(Math.max(contentBounds.maxY, mask.bounds.maxY) + pad);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = width;
  layerCanvas.height = height;
  const layerCtx = layerCanvas.getContext("2d");
  if (!layerCtx) return;

  layerCtx.save();
  layerCtx.translate(-minX, -minY);
  drawContent(layerCtx);
  layerCtx.restore();

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) return;

  maskCtx.save();
  maskCtx.translate(-minX, -minY);
  maskCtx.filter = `blur(${mask.featherPx}px)`;
  maskCtx.fillStyle = "rgba(255,255,255,1)";
  maskCtx.fill(path, fillRule);
  maskCtx.restore();

  layerCtx.save();
  layerCtx.globalCompositeOperation = "destination-in";
  layerCtx.drawImage(maskCanvas, 0, 0);
  layerCtx.restore();

  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.drawImage(layerCanvas, minX, minY);
  ctx.restore();
};

const renderPathFill = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  color: string,
  opacity: number,
  composite: GlobalCompositeOperation,
  blur: number,
  hexToRgba: (hex: string, opacity: number) => string,
  mask: SoftPathMask,
  path: Path2D = built.path,
  fillRule: CanvasFillRule = "nonzero"
) => {
  const blurPad = blur + 2;
  renderWithSoftPathMask(
    ctx,
    path,
    composite,
    {
      minX: built.minX - blurPad,
      minY: built.minY - blurPad,
      maxX: built.maxX + blurPad,
      maxY: built.maxY + blurPad,
    },
    mask,
    (layerCtx) => {
      layerCtx.filter = `blur(${blur}px)`;
      layerCtx.fillStyle = hexToRgba(color, clamp01(opacity));
      layerCtx.fill(path, fillRule);
    },
    fillRule
  );
};

const renderEllipseLayer = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  color: string,
  opacity: number,
  composite: GlobalCompositeOperation,
  blur: number,
  ellipse: { x: number; y: number; rx: number; ry: number; rotation: number },
  hexToRgba: (hex: string, opacity: number) => string,
  mask: SoftPathMask,
  path: Path2D = built.path,
  fillRule: CanvasFillRule = "nonzero"
) => {
  const blurPad = blur + 2;
  renderWithSoftPathMask(
    ctx,
    path,
    composite,
    {
      minX: ellipse.x - ellipse.rx - blurPad,
      minY: ellipse.y - ellipse.ry - blurPad,
      maxX: ellipse.x + ellipse.rx + blurPad,
      maxY: ellipse.y + ellipse.ry + blurPad,
    },
    mask,
    (layerCtx) => {
      layerCtx.filter = `blur(${blur}px)`;
      layerCtx.fillStyle = hexToRgba(color, clamp01(opacity));
      layerCtx.beginPath();
      layerCtx.ellipse(
        ellipse.x,
        ellipse.y,
        Math.max(1, ellipse.rx),
        Math.max(1, ellipse.ry),
        ellipse.rotation,
        0,
        Math.PI * 2
      );
      layerCtx.fill();
    },
    fillRule
  );
};

const renderGradientLayer = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  gradient: GradientSource,
  composite: GlobalCompositeOperation,
  blur: number,
  fillBox: { x: number; y: number; width: number; height: number },
  mask: SoftPathMask,
  path: Path2D = built.path,
  fillRule: CanvasFillRule = "nonzero"
) => {
  const blurPad = blur + 2;
  renderWithSoftPathMask(
    ctx,
    path,
    composite,
    {
      minX: fillBox.x - blurPad,
      minY: fillBox.y - blurPad,
      maxX: fillBox.x + fillBox.width + blurPad,
      maxY: fillBox.y + fillBox.height + blurPad,
    },
    mask,
    (layerCtx) => {
      layerCtx.filter = `blur(${blur}px)`;
      layerCtx.fillStyle = resolveGradient(gradient, layerCtx);
      layerCtx.fillRect(fillBox.x, fillBox.y, fillBox.width, fillBox.height);
    },
    fillRule
  );
};

const createSoftMask = (
  built: BuiltArea,
  featherScale: number,
  minPx: number,
  maxPx: number
): SoftPathMask => ({
  bounds: built,
  featherPx: Math.max(minPx, Math.min(maxPx, built.areaWidth * featherScale)),
});

const createBronzerDiffuseMasks = (
  built: BuiltArea,
  config?: {
    core?: [number, number, number];
    body?: [number, number, number];
    outer?: [number, number, number];
    lift?: [number, number, number];
  }
): BronzerDiffuseMasks => {
  const core = config?.core ?? [0.024, 4, 8];
  const body = config?.body ?? [0.048, 8, 16];
  const outer = config?.outer ?? [0.078, 14, 28];
  const lift = config?.lift ?? [0.06, 10, 22];

  return {
    core: createSoftMask(built, core[0], core[1], core[2]),
    body: createSoftMask(built, body[0], body[1], body[2]),
    outer: createSoftMask(built, outer[0], outer[1], outer[2]),
    lift: createSoftMask(built, lift[0], lift[1], lift[2]),
  };
};

const mirrorRegion = (indices: number[], map: Record<number, number>) => {
  const mirrored = indices.map((index) => map[index]);
  return mirrored.every(Boolean) ? mirrored : null;
};

const buildRegionVariants = (name: string, region: RegionDefinition): number[][] => {
  const polygons = normalizeRegionPolygons(region);
  if (!polygons.length) return [];

  const mirrorMap =
    name === "cheekbones"
      ? CHEEKBONE_MIRROR_MAP
      : name === "temples"
        ? TEMPLE_MIRROR_MAP
        : null;

  if (!mirrorMap || polygons.length !== 1) return polygons;

  const mirrored = mirrorRegion(polygons[0], mirrorMap);
  return mirrored ? [...polygons, mirrored] : polygons;
};

const renderCheekBronzer = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  faceCenterX: number,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const side = built.centerX < faceCenterX ? -1 : 1;
  const outerX = side < 0 ? built.minX : built.maxX;
  const innerX = side < 0 ? built.maxX : built.minX;
  const rotation = side < 0 ? 0.58 : -0.58;
  const isDebugTone = productColor === "#000000";
  const contourCore = isDebugTone ? productColor : mixHexColors(productColor, "#6f4939", 0.28);
  const warmBody = isDebugTone ? productColor : mixHexColors(productColor, "#b67458", 0.2);
  const warmVeil = isDebugTone ? productColor : mixHexColors(productColor, "#dda37d", 0.26);
  const warmLift = isDebugTone ? productColor : mixHexColors(productColor, "#f3c5a3", 0.14);
  const upperY = lerp(built.minY, built.maxY, 0.3);
  const bodyY = lerp(built.minY, built.maxY, 0.42);
  const veilY = lerp(built.minY, built.maxY, 0.38);
  const masks = createBronzerDiffuseMasks(built, {
    core: [0.03, 5, 11],
    body: [0.094, 16, 32],
    outer: [0.17, 30, 54],
    lift: [0.11, 16, 36],
  });

  if (isDebugTone) {
    renderPathFill(
      ctx,
      built,
      contourCore,
      baseOpacity * 0.94,
      "source-over",
      Math.max(2.5, built.areaWidth * 0.05),
      hexToRgba,
      masks.outer
    );
    return;
  }

  renderPathFill(
    ctx,
    built,
    warmVeil,
    baseOpacity * 0.24,
    "soft-light",
    Math.max(28, built.areaWidth * 0.14),
    hexToRgba,
    masks.outer
  );

  renderGradientLayer(
    ctx,
    built,
    (targetCtx) => {
      const veilGrad = targetCtx.createLinearGradient(
        lerp(innerX, outerX, 0.18),
        built.minY,
        lerp(innerX, outerX, 0.88),
        built.maxY
      );
      veilGrad.addColorStop(0, "transparent");
      veilGrad.addColorStop(0.18, hexToRgba(warmVeil, baseOpacity * 0.18));
      veilGrad.addColorStop(0.44, hexToRgba(warmBody, baseOpacity * 0.4));
      veilGrad.addColorStop(0.7, hexToRgba(warmBody, baseOpacity * 0.22));
      veilGrad.addColorStop(0.9, hexToRgba(warmVeil, baseOpacity * 0.08));
      veilGrad.addColorStop(1, "transparent");
      return veilGrad;
    },
    "soft-light",
    Math.max(30, built.areaWidth * 0.15),
    {
      x: built.minX - built.areaWidth * 0.34,
      y: built.minY - built.areaHeight * 0.42,
      width: built.areaWidth * 1.74,
      height: built.areaHeight * 2.08,
    },
    masks.outer
  );

  renderEllipseLayer(
    ctx,
    built,
    contourCore,
    baseOpacity * 0.28,
    "multiply",
    Math.max(18, built.areaWidth * 0.092),
    {
      x: lerp(innerX, outerX, 0.68),
      y: lerp(built.minY, built.maxY, 0.46),
      rx: built.areaWidth * 0.34,
      ry: built.areaHeight * 0.24,
      rotation,
    },
    hexToRgba,
    masks.body
  );

  renderEllipseLayer(
    ctx,
    built,
    warmBody,
    baseOpacity * 0.26,
    "multiply",
    Math.max(22, built.areaWidth * 0.11),
    {
      x: lerp(innerX, outerX, 0.58),
      y: lerp(built.minY, built.maxY, 0.5),
      rx: built.areaWidth * 0.48,
      ry: built.areaHeight * 0.34,
      rotation,
    },
    hexToRgba,
    masks.body
  );

  renderEllipseLayer(
    ctx,
    built,
    warmBody,
    baseOpacity * 0.56,
    "soft-light",
    Math.max(26, built.areaWidth * 0.13),
    {
      x: lerp(innerX, outerX, 0.54),
      y: lerp(veilY, built.maxY, 0.16),
      rx: built.areaWidth * 0.62,
      ry: built.areaHeight * 0.46,
      rotation,
    },
    hexToRgba,
    masks.outer
  );

  renderEllipseLayer(
    ctx,
    built,
    warmVeil,
    baseOpacity * 0.22,
    "soft-light",
    Math.max(36, built.areaWidth * 0.18),
    {
      x: lerp(innerX, outerX, 0.48),
      y: lerp(built.minY, built.maxY, 0.56),
      rx: built.areaWidth * 0.82,
      ry: built.areaHeight * 0.64,
      rotation,
    },
    hexToRgba,
    masks.outer
  );

  renderEllipseLayer(
    ctx,
    built,
    warmLift,
    baseOpacity * 0.06,
    "screen",
    Math.max(12, built.areaWidth * 0.072),
    {
      x: lerp(innerX, outerX, 0.44),
      y: upperY,
      rx: built.areaWidth * 0.3,
      ry: built.areaHeight * 0.16,
      rotation,
    },
    hexToRgba,
    masks.lift
  );
};

const renderTempleBronzer = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  faceCenterX: number,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const side = built.centerX < faceCenterX ? -1 : 1;
  const outerX = side < 0 ? built.minX : built.maxX;
  const innerX = side < 0 ? built.maxX : built.minX;
  const rotation = side < 0 ? 0.96 : -0.96;
  const isDebugTone = productColor === "#000000";
  const contourShade = isDebugTone ? productColor : mixHexColors(productColor, "#6a4334", 0.34);
  const warmBody = isDebugTone ? productColor : mixHexColors(productColor, "#b77c5d", 0.2);
  const warmHalo = isDebugTone ? productColor : mixHexColors(productColor, "#cf8d68", 0.24);
  const sunLift = isDebugTone ? productColor : mixHexColors(productColor, "#efc09e", 0.12);
  const upperY = lerp(built.minY, built.maxY, 0.24);
  const bodyY = lerp(built.minY, built.maxY, 0.36);
  const veilY = lerp(built.minY, built.maxY, 0.34);
  const masks = createBronzerDiffuseMasks(built, {
    core: [0.022, 4, 8],
    body: [0.076, 12, 24],
    outer: [0.122, 22, 40],
    lift: [0.086, 12, 28],
  });

  if (isDebugTone) {
    renderPathFill(
      ctx,
      built,
      contourShade,
      baseOpacity * 0.96,
      "source-over",
      Math.max(2.5, built.areaWidth * 0.06),
      hexToRgba,
      masks.outer
    );
    return;
  }

  renderPathFill(
    ctx,
    built,
    warmBody,
    baseOpacity * 0.28,
    "source-over",
    Math.max(14, built.areaWidth * 0.1),
    hexToRgba,
    masks.body
  );

  renderGradientLayer(
    ctx,
    built,
    (targetCtx) => {
      const templeGrad = targetCtx.createLinearGradient(
        lerp(innerX, outerX, 0.12),
        built.minY,
        lerp(innerX, outerX, 0.86),
        built.maxY
      );
      templeGrad.addColorStop(0, "transparent");
      templeGrad.addColorStop(0.24, hexToRgba(warmHalo, baseOpacity * 0.18));
      templeGrad.addColorStop(0.56, hexToRgba(warmBody, baseOpacity * 0.34));
      templeGrad.addColorStop(0.82, hexToRgba(warmHalo, baseOpacity * 0.14));
      templeGrad.addColorStop(1, "transparent");
      return templeGrad;
    },
    "soft-light",
    Math.max(22, built.areaWidth * 0.11),
    {
      x: built.minX - built.areaWidth * 0.34,
      y: built.minY - built.areaHeight * 0.38,
      width: built.areaWidth * 1.76,
      height: built.areaHeight * 1.9,
    },
    masks.outer
  );

  renderEllipseLayer(
    ctx,
    built,
    contourShade,
    baseOpacity * 0.48,
    "multiply",
    Math.max(12, built.areaWidth * 0.072),
    {
      x: lerp(innerX, outerX, 0.78),
      y: bodyY,
      rx: built.areaWidth * 0.22,
      ry: built.areaHeight * 0.2,
      rotation,
    },
    hexToRgba,
    masks.core
  );

  renderEllipseLayer(
    ctx,
    built,
    warmBody,
    baseOpacity * 0.34,
    "source-over",
    Math.max(18, built.areaWidth * 0.11),
    {
      x: lerp(innerX, outerX, 0.62),
      y: veilY,
      rx: built.areaWidth * 0.48,
      ry: built.areaHeight * 0.36,
      rotation,
    },
    hexToRgba,
    masks.body
  );

  renderEllipseLayer(
    ctx,
    built,
    warmHalo,
    baseOpacity * 0.16,
    "soft-light",
    Math.max(24, built.areaWidth * 0.118),
    {
      x: lerp(innerX, outerX, 0.58),
      y: veilY,
      rx: built.areaWidth * 0.64,
      ry: built.areaHeight * 0.48,
      rotation,
    },
    hexToRgba,
    masks.outer
  );

  renderEllipseLayer(
    ctx,
    built,
    sunLift,
    baseOpacity * 0.05,
    "screen",
    Math.max(12, built.areaWidth * 0.06),
    {
      x: lerp(innerX, outerX, 0.46),
      y: upperY,
      rx: built.areaWidth * 0.24,
      ry: built.areaHeight * 0.14,
      rotation,
    },
    hexToRgba,
    masks.lift
  );
};

const renderNoseBronzer = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const isDebugTone = productColor === "#000000";
  const contourShade = isDebugTone ? productColor : mixHexColors(productColor, "#8a614d", 0.22);
  const warmBody = isDebugTone ? productColor : mixHexColors(productColor, "#b77b5d", 0.18);
  const warmVeil = isDebugTone ? productColor : mixHexColors(productColor, "#d29b77", 0.12);
  const noseLift = isDebugTone ? productColor : mixHexColors(productColor, "#f2c7ac", 0.08);
  const contourAreas = buildNoseContourAreas(built);

  contourAreas.forEach((contourBuilt) => {
    const side = contourBuilt.centerX < built.centerX ? -1 : 1;
    const outerX = side < 0 ? contourBuilt.minX : contourBuilt.maxX;
    const innerX = side < 0 ? contourBuilt.maxX : contourBuilt.minX;
    const masks = createBronzerDiffuseMasks(contourBuilt, {
      core: [0.048, 3, 6],
      body: [0.12, 8, 16],
      outer: [0.22, 12, 24],
      lift: [0.15, 8, 16],
    });

    if (isDebugTone) {
      renderPathFill(
        ctx,
        contourBuilt,
        contourShade,
        baseOpacity * 0.92,
        "source-over",
        Math.max(2, contourBuilt.areaWidth * 0.08),
        hexToRgba,
        masks.outer
      );
      return;
    }

    renderPathFill(
      ctx,
      contourBuilt,
      warmBody,
      baseOpacity * 0.24,
      "source-over",
      Math.max(8, contourBuilt.areaWidth * 0.9),
      hexToRgba,
      masks.body
    );

    renderGradientLayer(
      ctx,
      contourBuilt,
      (targetCtx) => {
        const noseGrad = targetCtx.createLinearGradient(
          lerp(innerX, outerX, 0.16),
          contourBuilt.minY,
          lerp(innerX, outerX, 0.86),
          contourBuilt.maxY
        );
        noseGrad.addColorStop(0, "transparent");
        noseGrad.addColorStop(0.22, hexToRgba(warmVeil, baseOpacity * 0.14));
        noseGrad.addColorStop(0.58, hexToRgba(warmBody, baseOpacity * 0.24));
        noseGrad.addColorStop(0.86, hexToRgba(warmVeil, baseOpacity * 0.1));
        noseGrad.addColorStop(1, "transparent");
        return noseGrad;
      },
      "soft-light",
      Math.max(6, contourBuilt.areaWidth * 0.84),
      {
        x: contourBuilt.minX - contourBuilt.areaWidth * 0.44,
        y: contourBuilt.minY - contourBuilt.areaHeight * 0.3,
        width: contourBuilt.areaWidth * 1.9,
        height: contourBuilt.areaHeight * 1.72,
      },
      masks.outer
    );

    renderEllipseLayer(
      ctx,
      contourBuilt,
      contourShade,
      baseOpacity * 0.38,
      "multiply",
      Math.max(5.5, contourBuilt.areaWidth * 0.62),
      {
        x: lerp(innerX, outerX, 0.74),
        y: lerp(contourBuilt.minY, contourBuilt.maxY, 0.5),
        rx: contourBuilt.areaWidth * 0.2,
        ry: contourBuilt.areaHeight * 0.28,
        rotation: side < 0 ? 0.08 : -0.08,
      },
      hexToRgba,
      masks.core
    );

    renderEllipseLayer(
      ctx,
      contourBuilt,
      warmBody,
      baseOpacity * 0.28,
      "source-over",
      Math.max(8, contourBuilt.areaWidth * 0.84),
      {
        x: lerp(innerX, outerX, 0.62),
        y: lerp(contourBuilt.minY, contourBuilt.maxY, 0.48),
        rx: contourBuilt.areaWidth * 0.42,
        ry: contourBuilt.areaHeight * 0.46,
        rotation: side < 0 ? 0.08 : -0.08,
      },
      hexToRgba,
      masks.body
    );

    renderEllipseLayer(
      ctx,
      contourBuilt,
      noseLift,
      baseOpacity * 0.05,
      "screen",
      Math.max(5, contourBuilt.areaWidth * 0.48),
      {
        x: lerp(innerX, outerX, 0.44),
        y: lerp(contourBuilt.minY, contourBuilt.maxY, 0.28),
        rx: contourBuilt.areaWidth * 0.24,
        ry: contourBuilt.areaHeight * 0.22,
        rotation: side < 0 ? 0.04 : -0.04,
      },
      hexToRgba,
      masks.lift
    );
  });
};

const renderEyelidBronzer = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  faceCenterX: number,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const isDebugTone = productColor === "#000000";
  const lidWash = isDebugTone ? productColor : mixHexColors(productColor, "#cf9b79", 0.18);
  const lidDepth = isDebugTone ? productColor : mixHexColors(productColor, "#8d624d", 0.16);
  const lidLift = isDebugTone ? productColor : mixHexColors(productColor, "#f1cfb4", 0.08);
  const targetBuilt = buildEyelidBandArea(built);
  const side = targetBuilt.centerX < faceCenterX ? -1 : 1;
  const outerX = side < 0 ? targetBuilt.minX : targetBuilt.maxX;
  const innerX = side < 0 ? targetBuilt.maxX : targetBuilt.minX;
  const rotation = side < 0 ? 0.16 : -0.16;
  const masks = createBronzerDiffuseMasks(targetBuilt, {
    core: [0.04, 2, 5],
    body: [0.11, 6, 12],
    outer: [0.18, 10, 20],
    lift: [0.13, 6, 14],
  });

  if (isDebugTone) {
    renderPathFill(
      ctx,
      targetBuilt,
      lidDepth,
      baseOpacity * 0.94,
      "source-over",
      Math.max(1.4, targetBuilt.areaWidth * 0.04),
      hexToRgba,
      masks.outer
    );
    return;
  }

  renderPathFill(
    ctx,
    targetBuilt,
    lidWash,
    baseOpacity * 0.2,
    "source-over",
    Math.max(5.5, targetBuilt.areaWidth * 0.12),
    hexToRgba,
    masks.body
  );

  renderGradientLayer(
    ctx,
    targetBuilt,
    (targetCtx) => {
      const lidGrad = targetCtx.createLinearGradient(
        lerp(innerX, outerX, 0.16),
        targetBuilt.minY,
        lerp(innerX, outerX, 0.84),
        targetBuilt.maxY
      );
      lidGrad.addColorStop(0, "transparent");
      lidGrad.addColorStop(0.22, hexToRgba(lidWash, baseOpacity * 0.12));
      lidGrad.addColorStop(0.58, hexToRgba(lidWash, baseOpacity * 0.22));
      lidGrad.addColorStop(0.86, hexToRgba(lidWash, baseOpacity * 0.08));
      lidGrad.addColorStop(1, "transparent");
      return lidGrad;
    },
    "soft-light",
    Math.max(5.5, targetBuilt.areaWidth * 0.12),
    {
      x: targetBuilt.minX - targetBuilt.areaWidth * 0.28,
      y: targetBuilt.minY - targetBuilt.areaHeight * 0.34,
      width: targetBuilt.areaWidth * 1.58,
      height: targetBuilt.areaHeight * 1.86,
    },
    masks.outer
  );

  renderEllipseLayer(
    ctx,
    targetBuilt,
    lidDepth,
    baseOpacity * 0.26,
    "multiply",
    Math.max(3.8, targetBuilt.areaWidth * 0.08),
    {
      x: lerp(innerX, outerX, 0.58),
      y: lerp(targetBuilt.minY, targetBuilt.maxY, 0.52),
      rx: targetBuilt.areaWidth * 0.24,
      ry: targetBuilt.areaHeight * 0.16,
      rotation,
    },
    hexToRgba,
    masks.core
  );

  renderEllipseLayer(
    ctx,
    targetBuilt,
    lidWash,
    baseOpacity * 0.32,
    "source-over",
    Math.max(6, targetBuilt.areaWidth * 0.12),
    {
      x: lerp(innerX, outerX, 0.54),
      y: lerp(targetBuilt.minY, targetBuilt.maxY, 0.46),
      rx: targetBuilt.areaWidth * 0.44,
      ry: targetBuilt.areaHeight * 0.28,
      rotation,
    },
    hexToRgba,
    masks.body
  );

  renderEllipseLayer(
    ctx,
    targetBuilt,
    lidLift,
    baseOpacity * 0.04,
    "screen",
    Math.max(3, targetBuilt.areaWidth * 0.06),
    {
      x: lerp(innerX, outerX, 0.44),
      y: lerp(targetBuilt.minY, targetBuilt.maxY, 0.28),
      rx: targetBuilt.areaWidth * 0.2,
      ry: targetBuilt.areaHeight * 0.08,
      rotation,
    },
    hexToRgba,
    masks.lift
  );
};

const renderLipBronzer = (
  ctx: CanvasRenderingContext2D,
  outerBuilt: BuiltArea,
  innerBuilt: BuiltArea | null,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const combined = new Path2D();
  combined.addPath(outerBuilt.path);
  if (innerBuilt) combined.addPath(innerBuilt.path);

  const isDebugTone = productColor === "#000000";
  const lipBase = isDebugTone ? productColor : mixHexColors(productColor, "#7b4d3c", 0.22);
  const lipBody = isDebugTone ? productColor : mixHexColors(productColor, "#9c6a52", 0.16);
  const lipVeil = isDebugTone ? productColor : mixHexColors(productColor, "#b88466", 0.16);
  const lipLift = isDebugTone ? productColor : mixHexColors(productColor, "#e6bea0", 0.08);
  const masks = createBronzerDiffuseMasks(outerBuilt, {
    core: [0.028, 2, 5],
    body: [0.052, 4, 9],
    outer: [0.084, 6, 14],
    lift: [0.064, 4, 10],
  });

  renderPathFill(
    ctx,
    outerBuilt,
    lipBase,
    isDebugTone ? baseOpacity * 0.94 : baseOpacity * 0.28,
    isDebugTone ? "source-over" : "multiply",
    Math.max(2, outerBuilt.areaWidth * 0.028),
    hexToRgba,
    isDebugTone ? masks.outer : masks.core,
    combined,
    "evenodd"
  );

  if (isDebugTone) return;

  renderPathFill(
    ctx,
    outerBuilt,
    lipBody,
    baseOpacity * 0.12,
    "source-over",
    Math.max(3, outerBuilt.areaWidth * 0.038),
    hexToRgba,
    masks.body,
    combined,
    "evenodd"
  );

  renderGradientLayer(
    ctx,
    outerBuilt,
    (targetCtx) => {
      const lipGrad = targetCtx.createLinearGradient(
        outerBuilt.centerX,
        outerBuilt.minY,
        outerBuilt.centerX,
        outerBuilt.maxY
      );
      lipGrad.addColorStop(0, hexToRgba(lipLift, baseOpacity * 0.08));
      lipGrad.addColorStop(0.36, hexToRgba(lipVeil, baseOpacity * 0.16));
      lipGrad.addColorStop(0.72, hexToRgba(lipBody, baseOpacity * 0.12));
      lipGrad.addColorStop(1, "transparent");
      return lipGrad;
    },
    "soft-light",
    Math.max(3, outerBuilt.areaWidth * 0.042),
    {
      x: outerBuilt.minX - outerBuilt.areaWidth * 0.12,
      y: outerBuilt.minY - outerBuilt.areaHeight * 0.18,
      width: outerBuilt.areaWidth * 1.24,
      height: outerBuilt.areaHeight * 1.36,
    },
    masks.outer,
    combined,
    "evenodd"
  );

  renderEllipseLayer(
    ctx,
    outerBuilt,
    lipBody,
    baseOpacity * 0.16,
    "source-over",
    Math.max(3, outerBuilt.areaWidth * 0.04),
    {
      x: outerBuilt.centerX,
      y: lerp(outerBuilt.minY, outerBuilt.maxY, 0.56),
      rx: outerBuilt.areaWidth * 0.34,
      ry: outerBuilt.areaHeight * 0.26,
      rotation: 0,
    },
    hexToRgba,
    masks.body,
    combined,
    "evenodd"
  );

  renderEllipseLayer(
    ctx,
    outerBuilt,
    lipLift,
    baseOpacity * 0.04,
    "screen",
    Math.max(2.5, outerBuilt.areaWidth * 0.034),
    {
      x: outerBuilt.centerX,
      y: lerp(outerBuilt.minY, outerBuilt.maxY, 0.28),
      rx: outerBuilt.areaWidth * 0.22,
      ry: outerBuilt.areaHeight * 0.12,
      rotation: 0,
    },
    hexToRgba,
    masks.lift,
    combined,
    "evenodd"
  );
};

const renderGenericBronzerArea = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const areaColor =
    productColor === "#000000" ? productColor : mixHexColors(productColor, "#96664f", 0.18);
  const bodyColor =
    productColor === "#000000" ? productColor : mixHexColors(productColor, "#bf825f", 0.14);
  const liftColor =
    productColor === "#000000" ? productColor : mixHexColors(productColor, "#ebbe9b", 0.08);
  const masks = createBronzerDiffuseMasks(built, {
    core: [0.028, 4, 8],
    body: [0.056, 8, 14],
    outer: [0.086, 12, 22],
    lift: [0.068, 8, 18],
  });

  if (productColor === "#000000") {
    renderPathFill(
      ctx,
      built,
      areaColor,
      baseOpacity * 0.9,
      "source-over",
      Math.max(2.5, built.areaWidth * 0.05),
      hexToRgba,
      masks.outer
    );
    return;
  }

  renderPathFill(
    ctx,
    built,
    bodyColor,
    baseOpacity * 0.12,
    "source-over",
    Math.max(5, built.areaWidth * 0.056),
    hexToRgba,
    masks.body
  );

  renderPathFill(
    ctx,
    built,
    areaColor,
    baseOpacity * 0.18,
    "multiply",
    Math.max(4, built.areaWidth * 0.04),
    hexToRgba,
    masks.core
  );

  renderPathFill(
    ctx,
    built,
    bodyColor,
    baseOpacity * 0.14,
    "source-over",
    Math.max(6, built.areaWidth * 0.068),
    hexToRgba,
    masks.body
  );

  renderPathFill(
    ctx,
    built,
    bodyColor,
    baseOpacity * 0.1,
    "soft-light",
    Math.max(8, built.areaWidth * 0.096),
    hexToRgba,
    masks.outer
  );

  renderPathFill(
    ctx,
    built,
    liftColor,
    baseOpacity * 0.03,
    "screen",
    Math.max(6, built.areaWidth * 0.056),
    hexToRgba,
    masks.lift
  );
};

const expandCheekBronzerArea = (built: BuiltArea, faceCenterX: number) => {
  const side = built.centerX < faceCenterX ? -1 : 1;
  const rotation = side < 0 ? 0.44 : -0.44;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const centerX = built.centerX - side * built.areaWidth * 0.16;
  const centerY = built.centerY + built.areaHeight * 0.42;
  const rx = built.areaWidth * 0.82;
  const ry = built.areaHeight * 1.12;
  const points: Point[] = [];

  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2;
    const yWeight = Math.sin(angle);
    const localX = Math.cos(angle) * rx * (yWeight > 0 ? 1.04 : 0.9);
    const localY = yWeight * ry * (yWeight > 0 ? 1.2 : 0.82);

    points.push({
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    });
  }

  return buildAreaFromPoints(points) ?? built;
};

const expandTempleBronzerArea = (built: BuiltArea, faceCenterX: number) => {
  const inwardDirection = built.centerX < faceCenterX ? 1 : -1;
  const inwardShift = built.areaWidth * 0.12;
  const lift = built.areaHeight * 0.04;

  return (
    transformBuiltArea(built, (point) => ({
      x:
        point.x +
        inwardDirection * inwardShift +
        (point.x - built.centerX) * 0.14,
      y: point.y - lift + (point.y - built.centerY) * 0.16,
    })) ?? built
  );
};

export function renderBronzer(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const bronzerColor = productData.color;
  const baseOpacity = clamp01(productData.opacity * 1.52);
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  const faceCenterX =
    leftTemple && rightTemple
      ? ((leftTemple.x + rightTemple.x) * width) / 2
      : width / 2;

  if (productData.regions.cheekbones) {
    const bronzerCheekAreas = [
      buildBronzerSweepPath(
        BRONZER_CHEEK_BAND.left.upper,
        BRONZER_CHEEK_BAND.left.lower,
        BRONZER_CHEEK_BAND.left.outerBridge,
        landmarks,
        width,
        height,
        faceCenterX
      ),
      buildBronzerSweepPath(
        BRONZER_CHEEK_BAND.right.upper,
        BRONZER_CHEEK_BAND.right.lower,
        BRONZER_CHEEK_BAND.right.outerBridge,
        landmarks,
        width,
        height,
        faceCenterX
      ),
    ].filter(Boolean) as BuiltArea[];

    bronzerCheekAreas.forEach((built) => {
      const expandedBuilt = expandCheekBronzerArea(built, faceCenterX);
      renderCheekBronzer(
        ctx,
        expandedBuilt,
        faceCenterX,
        bronzerColor,
        baseOpacity,
        hexToRgba
      );
    });
  }

  if (productData.regions.temples) {
    const bronzerTempleAreas = [
      buildTempleArea(BRONZER_TEMPLE_AREAS.left, landmarks, width, height, faceCenterX),
      buildTempleArea(BRONZER_TEMPLE_AREAS.right, landmarks, width, height, faceCenterX),
    ].filter(Boolean) as BuiltArea[];

    bronzerTempleAreas.forEach((built) => {
      renderTempleBronzer(ctx, built, faceCenterX, bronzerColor, baseOpacity, hexToRgba);
    });
  }

  const lipOuter = normalizeRegionPolygons(productData.regions.lips_outer)[0];
  const lipInner = normalizeRegionPolygons(productData.regions.lips_inner)[0];
  const lipOuterBuilt = lipOuter ? buildAreaPath(lipOuter, landmarks, width, height) : null;
  const lipInnerBuilt = lipInner ? buildAreaPath(lipInner, landmarks, width, height) : null;
  if (lipOuterBuilt) {
    renderLipBronzer(
      ctx,
      lipOuterBuilt,
      lipInnerBuilt,
      bronzerColor,
      baseOpacity,
      hexToRgba
    );
  }

  Object.entries(productData.regions ?? {}).forEach(([name, region]) => {
    if (name === "cheekbones" || name === "temples" || name === "lips_outer" || name === "lips_inner") {
      return;
    }

    buildRegionVariants(name, region).forEach((indices) => {
      const built = buildAreaPath(indices, landmarks, width, height);
      if (!built) return;

      if (name === "nose_contour") {
        renderNoseBronzer(ctx, built, bronzerColor, baseOpacity, hexToRgba);
        return;
      }

      if (name === "eyelids") {
        renderEyelidBronzer(ctx, built, faceCenterX, bronzerColor, baseOpacity, hexToRgba);
        return;
      }

      renderGenericBronzerArea(ctx, built, bronzerColor, baseOpacity, hexToRgba);
    });
  });
}
