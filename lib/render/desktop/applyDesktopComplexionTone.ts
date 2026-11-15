import { ProductToneData, RegionDefinition } from "@/lib/utils";

import { renderBlush } from "@/lib/render/tonePresets/blush";
import { renderBronzer } from "@/lib/render/tonePresets/bronzer";
import { renderHighlighter } from "@/lib/render/tonePresets/highlighter";

import {
  DesktopComplexionToneKind,
  getDesktopToneKind,
  isDesktopComplexionToneKind,
} from "@/lib/render/desktop/toneKind";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };
type CheekDebugMode = "outline" | "fill" | "direct" | "deposit_rgb";

const CHEEK_DEBUG_BAND = {
  left: {
    upper: [143, 111, 117, 118, 119, 120],
    lower: [123, 50, 101, 36],
  },
  right: {
    upper: [372, 340, 346, 347, 348, 349],
    lower: [352, 280, 330, 266],
  },
} as const;

const CHEEK_REGION_MIRROR_MAP: Record<number, number> = {
  234: 454,
  93: 323,
  132: 361,
  58: 288,
  172: 397,
  136: 365,
};

const UPPER_CHEEK_MIRROR_MAP: Record<number, number> = {
  58: 288,
  93: 323,
  132: 361,
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const normalizeRegionPolygons = (region?: RegionDefinition | null): number[][] => {
  if (!region) return [];
  if (Array.isArray(region[0])) return region as number[][];
  return [region as number[]];
};

const mirrorRegion = (indices: number[], map: Record<number, number>) => {
  const mirrored = indices.map((index) => map[index]);
  return mirrored.every(Boolean) ? mirrored : null;
};

const getCheekDebugMode = (() => {
  let cachedSearch = "";
  let cachedMode: CheekDebugMode | null = null;

  return (): CheekDebugMode | null => {
    if (typeof window === "undefined") return null;
    const search = window.location.search || "";
    if (search === cachedSearch) return cachedMode;
    cachedSearch = search;
    const value = new URLSearchParams(search).get("cheekdebug")?.toLowerCase().trim();
    cachedMode =
      value === "outline" ||
      value === "fill" ||
      value === "direct" ||
      value === "deposit_rgb"
        ? value
        : null;
    return cachedMode;
  };
})();

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

const buildSmoothClosedPath = (points: Point[]) => {
  const path = new Path2D();
  if (!points.length) return path;
  if (points.length < 3) {
    points.forEach((point, index) => {
      if (index === 0) path.moveTo(point.x, point.y);
      else path.lineTo(point.x, point.y);
    });
    path.closePath();
    return path;
  }

  const midpoint = (a: Point, b: Point) => ({
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  });

  const startMid = midpoint(points[0], points[1]);
  path.moveTo(startMid.x, startMid.y);

  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const mid = midpoint(current, next);
    path.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
  }

  path.quadraticCurveTo(points[0].x, points[0].y, startMid.x, startMid.y);
  path.closePath();
  return path;
};

const buildRegionDebugPath = (
  indices: number[],
  landmarks: Landmark[],
  width: number,
  height: number
) => {
  const points = indices
    .map((index) => landmarks[index])
    .filter(Boolean)
    .map((landmark) => ({ x: landmark.x * width, y: landmark.y * height }));

  if (points.length < 3) return null;
  return buildSmoothClosedPath(points);
};

const getCheekDebugRegionPaths = (
  productData: ProductToneData,
  landmarks: Landmark[],
  width: number,
  height: number
) => {
  const cheeks = productData.regions?.cheeks;
  const cheekbones = productData.regions?.cheekbones;
  const upperCheeks = productData.regions?.upper_cheeks;

  let regionName: "cheeks" | "cheekbones" | "upper_cheeks" | null = null;
  let region: RegionDefinition | null | undefined = null;
  let mirrorMap: Record<number, number> | null = null;

  if (cheeks) {
    regionName = "cheeks";
    region = cheeks;
    mirrorMap = CHEEK_REGION_MIRROR_MAP;
  } else if (cheekbones) {
    regionName = "cheekbones";
    region = cheekbones;
    mirrorMap = CHEEK_REGION_MIRROR_MAP;
  } else if (upperCheeks) {
    regionName = "upper_cheeks";
    region = upperCheeks;
    mirrorMap = UPPER_CHEEK_MIRROR_MAP;
  }

  if (!regionName || !region) return [];

  const polygons = normalizeRegionPolygons(region);
  const allPolygons =
    mirrorMap && polygons.length === 1
      ? (() => {
          const mirrored = mirrorRegion(polygons[0], mirrorMap);
          return mirrored ? [...polygons, mirrored] : polygons;
        })()
      : polygons;

  return allPolygons
    .map((indices) => buildRegionDebugPath(indices, landmarks, width, height))
    .filter(Boolean) as Path2D[];
};

const buildCheekDebugPath = (
  upperIndices: readonly number[],
  lowerIndices: readonly number[],
  landmarks: Landmark[],
  width: number,
  height: number
) => {
  const upper = buildLinePoints(upperIndices, landmarks, width, height);
  const lower = orientLineToMatch(upper, buildLinePoints(lowerIndices, landmarks, width, height));
  if (upper.length < 2 || lower.length < 2) return null;

  const samples = Math.max(upper.length, lower.length, 7);
  const points: Point[] = [];

  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    const point = samplePointOnLine(upper, t);
    if (!point) continue;
    points.push(point);
  }

  for (let i = samples - 1; i >= 0; i -= 1) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    const upperPoint = samplePointOnLine(upper, t);
    const lowerPoint = samplePointOnLine(lower, t);
    if (!upperPoint || !lowerPoint) continue;
    points.push({
      x: upperPoint.x + (lowerPoint.x - upperPoint.x) * 0.74,
      y: upperPoint.y + (lowerPoint.y - upperPoint.y) * 0.74,
    });
  }

  if (points.length < 4) return null;
  const path = new Path2D();
  points.forEach((point, index) => {
    if (index === 0) path.moveTo(point.x, point.y);
    else path.lineTo(point.x, point.y);
  });
  path.closePath();
  return path;
};

const renderCheekDebug = (
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string,
  mode: CheekDebugMode
) => {
  const regionPaths = getCheekDebugRegionPaths(productData, landmarks, width, height);
  const debugPaths = regionPaths.length
    ? regionPaths
    : [
        buildCheekDebugPath(
          CHEEK_DEBUG_BAND.left.upper,
          CHEEK_DEBUG_BAND.left.lower,
          landmarks,
          width,
          height
        ),
        buildCheekDebugPath(
          CHEEK_DEBUG_BAND.right.upper,
          CHEEK_DEBUG_BAND.right.lower,
          landmarks,
          width,
          height
        ),
      ].filter(Boolean);

  debugPaths.forEach((path) => {
    if (!path) return;
    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (mode === "outline") {
      ctx.lineWidth = Math.max(2, width * 0.0035);
      ctx.strokeStyle = "#00ff88";
      ctx.stroke(path);
    } else {
      ctx.fillStyle = hexToRgba(productData.color, mode === "direct" ? 0.36 : 0.28);
      ctx.fill(path);
    }
    ctx.restore();
  });
};

export function shouldUseDirectCheekDebugRender(productData: ProductToneData | null | undefined) {
  if (!productData) return false;
  const mode = getCheekDebugMode();
  if (mode !== "direct") return false;
  return isDesktopComplexionToneKind(getDesktopToneKind(productData));
}

export function applyDesktopComplexionTone(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  kind: DesktopComplexionToneKind,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const cheekDebugMode = getCheekDebugMode();

  if (cheekDebugMode && cheekDebugMode !== "deposit_rgb") {
    renderCheekDebug(ctx, landmarks, productData, width, height, hexToRgba, cheekDebugMode);
    return;
  }

  if (kind === "blush") {
    renderBlush(
      ctx,
      landmarks,
      productData,
      width,
      height,
      hexToRgba,
      cheekDebugMode === "deposit_rgb" ? "deposit_rgb" : null
    );
    return;
  }

  if (kind === "bronzer") {
    renderBronzer(ctx, landmarks, productData, width, height, hexToRgba);
    return;
  }

  renderHighlighter(ctx, landmarks, productData, width, height, hexToRgba);
}
