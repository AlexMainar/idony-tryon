import { renderBlush } from "@/lib/render/tonePresets/blush";
import { renderBronzer } from "@/lib/render/tonePresets/bronzer";
import { ProductToneData, RegionDefinition } from "@/lib/utils";
import { renderHighlighter } from "@/lib/render/tonePresets/highlighter";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };
type MobileComplexionKind = "blush" | "flush" | "bronzer" | "highlighter";
type DebugMode =
  | "geometry"
  | "luminance"
  | "field"
  | "fieldluma"
  | "fieldlumaresponse"
  | "nomask_flat"
  | "nomask_deposit_rgb"
  | "nomask_deposit_band_rgb"
  | "nomask_deposit_ellipse_rgb"
  | "basis_debug"
  | "nomask_veil"
  | "nomask_veil_plus_body_broad"
  | "nomask_stack"
  | "fieldlumapath"
  | "regions"
  | "deposit"
  | "base"
  | "detail"
  | "effect"
  | "transfer"
  | "recompose"
  | "final"
  | null;

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

type CheekPreset = {
  kind: MobileComplexionKind;
  regionName: "cheeks" | "cheekbones" | "upper_cheeks";
};

const CHEEK_MIRROR_MAP: Record<number, number> = {
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

const CHEEK_PRESETS: Record<MobileComplexionKind, CheekPreset> = {
  blush: {
    kind: "blush",
    regionName: "cheeks",
  },
  flush: {
    kind: "flush",
    regionName: "cheeks",
  },
  bronzer: {
    kind: "bronzer",
    regionName: "cheekbones",
  },
  highlighter: {
    kind: "highlighter",
    regionName: "upper_cheeks",
  },
};

const clampRange = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const clampByte = (value: number) => clampRange(Math.round(value), 0, 255);

const clamp01 = (value: number) => clampRange(value, 0, 1);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const normalizeVector = (x: number, y: number) => {
  const length = Math.hypot(x, y);
  if (length <= 1e-4) return { x: 1, y: 0 };
  return { x: x / length, y: y / length };
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

const getMobileDebugMode = (() => {
  let cachedSearch = "";
  let cachedMode: DebugMode = null;

  return () => {
    if (typeof window === "undefined") return null;
    const search = window.location.search || "";
    if (search === cachedSearch) return cachedMode;
    cachedSearch = search;

    const value =
      new URLSearchParams(search).get("mobiledebug")?.toLowerCase().trim() || null;
    cachedMode =
      value === "geometry" ||
        value === "luminance" ||
        value === "field" ||
        value === "fieldluma" ||
        value === "fieldlumaresponse" ||
        value === "nomask_flat" ||
        value === "nomask_deposit_rgb" ||
        value === "nomask_deposit_band_rgb" ||
        value === "nomask_deposit_ellipse_rgb" ||
        value === "basis_debug" ||
        value === "nomask_veil" ||
        value === "nomask_veil_plus_body_broad" ||
        value === "nomask_stack" ||
        value === "fieldlumapath" ||
        value === "regions" ||
        value === "deposit" ||
        value === "base" ||
        value === "detail" ||
        value === "effect" ||
        value === "transfer" ||
        value === "recompose" ||
        value === "final"
        ? value
        : null;
    return cachedMode;
  };
})();

const normalizeRegionPolygons = (region?: RegionDefinition | null): number[][] => {
  if (!region) return [];
  if (Array.isArray(region[0])) return region as number[][];
  return [region as number[]];
};

const mirrorRegion = (indices: number[], map: Record<number, number>) => {
  const mirrored = indices.map((index) => map[index]);
  return mirrored.every(Boolean) ? mirrored : null;
};

const buildSmoothClosedPath = (points: Point[]) => {
  const path = new Path2D();
  if (points.length < 2) return path;

  const midpoint = (a: Point, b: Point) => ({
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  });

  const startMid = midpoint(points[0], points[1]);
  path.moveTo(startMid.x, startMid.y);

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const mid = midpoint(current, next);
    path.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
  }

  path.quadraticCurveTo(points[0].x, points[0].y, startMid.x, startMid.y);
  path.closePath();
  return path;
};

const buildAreaFromIndices = (
  indices: number[],
  landmarks: Landmark[],
  width: number,
  height: number
): BuiltArea | null => {
  const points: Point[] = [];
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
  });

  if (points.length < 3) return null;

  return {
    path: buildSmoothClosedPath(points),
    points,
    minX,
    minY,
    maxX,
    maxY,
    centerX: sumX / points.length,
    centerY: sumY / points.length,
    areaWidth: maxX - minX,
    areaHeight: maxY - minY,
  };
};

const getRegionAreas = (
  regionName: "cheeks" | "cheekbones" | "upper_cheeks",
  region: RegionDefinition | undefined,
  landmarks: Landmark[],
  width: number,
  height: number
) => {
  const polygons = normalizeRegionPolygons(region);
  if (!polygons.length) return [];

  let variants = polygons;
  if (regionName === "cheekbones" && polygons.length === 1) {
    const mirrored = mirrorRegion(polygons[0], CHEEK_MIRROR_MAP);
    if (mirrored) variants = [polygons[0], mirrored];
  } else if (regionName === "upper_cheeks" && polygons.length === 1) {
    const mirrored = mirrorRegion(polygons[0], UPPER_CHEEK_MIRROR_MAP);
    if (mirrored) variants = [polygons[0], mirrored];
  }

  return variants
    .map((indices) => buildAreaFromIndices(indices, landmarks, width, height))
    .filter(Boolean) as BuiltArea[];
};

const getMobileComplexionPreset = (
  productData: ProductToneData | null | undefined
): CheekPreset | null => {
  const name = productData?.display_name?.toLowerCase().trim() || "";
  const type = (productData?.product_type || "").toLowerCase();

  if (productData?.optical_profile?.finish === "pearlescent_highlighter") {
    return CHEEK_PRESETS.highlighter;
  }
  if (name.includes("dream paint blush")) return CHEEK_PRESETS.blush;
  if (name.includes("flush") && name.includes("bloom")) return CHEEK_PRESETS.flush;
  if (name.includes("dream paint bronzer") || type.includes("bronzer")) {
    return CHEEK_PRESETS.bronzer;
  }
  if (name.includes("luminizer") || type.includes("highlighter")) {
    return CHEEK_PRESETS.highlighter;
  }

  return null;
};

export const isMobileComplexionProduct = (
  productData: ProductToneData | null | undefined
): boolean => Boolean(getMobileComplexionPreset(productData));

const applyLuminanceDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number
) => {
  const minX = clampRange(Math.floor(area.minX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(area.minY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(area.maxX), 0, width);
  const maxY = clampRange(Math.ceil(area.maxY), 0, height);
  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;
      if (!ctx.isPointInPath(area.path, canvasX, canvasY)) continue;

      const pixelIndex = (y * boxWidth + x) * 4;
      data[pixelIndex] = clampByte(data[pixelIndex] + 25);
      data[pixelIndex + 1] = clampByte(data[pixelIndex + 1] - 5);
      data[pixelIndex + 2] = clampByte(data[pixelIndex + 2] - 5);
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

const getFieldDebugBasis = (
  area: BuiltArea,
  width: number,
  centerAxisOffset = 0.18,
  centerLiftOffset = 0.16,
  axisRadiusScale = 1,
  liftRadiusScale = 1
) => {
  const isLeftCheek = area.centerX < width * 0.5;
  let innerPoint = area.points[0];
  let outerPoint = area.points[0];

  area.points.forEach((point) => {
    if (isLeftCheek) {
      if (point.x > innerPoint.x) innerPoint = point;
      if (point.x < outerPoint.x) outerPoint = point;
      return;
    }

    if (point.x < innerPoint.x) innerPoint = point;
    if (point.x > outerPoint.x) outerPoint = point;
  });

  const axisDir = normalizeVector(innerPoint.x - outerPoint.x, innerPoint.y - outerPoint.y);
  let liftDir = { x: -axisDir.y, y: axisDir.x };
  if (liftDir.y > 0) {
    liftDir = { x: -liftDir.x, y: -liftDir.y };
  }

  return {
    axisDir,
    liftDir,
    centerX:
      area.centerX +
      axisDir.x * area.areaWidth * centerAxisOffset +
      liftDir.x * area.areaHeight * centerLiftOffset,
    centerY:
      area.centerY +
      axisDir.y * area.areaWidth * centerAxisOffset +
      liftDir.y * area.areaHeight * centerLiftOffset,
    axisRadius: Math.max(area.areaWidth * 0.52 * axisRadiusScale, 1),
    liftRadius: Math.max(area.areaHeight * 0.36 * liftRadiusScale, 1),
  };
};

const applyFieldDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number
) => {
  const minX = clampRange(Math.floor(area.minX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(area.minY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(area.maxX), 0, width);
  const maxY = clampRange(Math.ceil(area.maxY), 0, height);
  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width
  );
  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;
      if (!ctx.isPointInPath(area.path, canvasX, canvasY)) continue;

      const dx = canvasX - centerX;
      const dy = canvasY - centerY;
      const axisDistance = dx * axisDir.x + dy * axisDir.y;
      const liftDistance = dx * liftDir.x + dy * liftDir.y;
      const weight = Math.exp(
        -(
          (axisDistance * axisDistance) / (axisRadius * axisRadius) +
          (liftDistance * liftDistance) / (liftRadius * liftRadius)
        )
      );

      const pixelIndex = (y * boxWidth + x) * 4;
      data[pixelIndex] = clampByte(data[pixelIndex] + 25 * weight);
      data[pixelIndex + 1] = clampByte(data[pixelIndex + 1] - 5 * weight);
      data[pixelIndex + 2] = clampByte(data[pixelIndex + 2] - 5 * weight);
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

const applyFieldLumaDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number
) => {
  const minX = clampRange(Math.floor(area.minX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(area.minY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(area.maxX), 0, width);
  const maxY = clampRange(Math.ceil(area.maxY), 0, height);
  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;
      if (!ctx.isPointInPath(area.path, canvasX, canvasY)) continue;

      const dx = canvasX - centerX;
      const dy = canvasY - centerY;
      const axisDistance = dx * axisDir.x + dy * axisDir.y;
      const liftDistance = dx * liftDir.x + dy * liftDir.y;
      const fieldWeight = Math.exp(
        -(
          (axisDistance * axisDistance) / (axisRadius * axisRadius) +
          (liftDistance * liftDistance) / (liftRadius * liftRadius)
        )
      );

      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const s = fieldWeight * 1;

      data[pixelIndex] = clampByte(r + s * luma * 0.24);
      data[pixelIndex + 1] = clampByte(g - s * luma * 0.06);
      data[pixelIndex + 2] = clampByte(b - s * luma * 0.06);
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

const applyFieldLumaResponseDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number
) => {
  const minX = clampRange(Math.floor(area.minX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(area.minY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(area.maxX), 0, width);
  const maxY = clampRange(Math.ceil(area.maxY), 0, height);
  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;
      if (!ctx.isPointInPath(area.path, canvasX, canvasY)) continue;

      const dx = canvasX - centerX;
      const dy = canvasY - centerY;
      const axisDistance = dx * axisDir.x + dy * axisDir.y;
      const liftDistance = dx * liftDir.x + dy * liftDir.y;
      const fieldWeight = Math.exp(
        -(
          (axisDistance * axisDistance) / (axisRadius * axisRadius) +
          (liftDistance * liftDistance) / (liftRadius * liftRadius)
        )
      );

      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const response = Math.sqrt(luma);
      const s = fieldWeight * response;

      data[pixelIndex] = clampByte(r + s * 255 * 0.24);
      data[pixelIndex + 1] = clampByte(g - s * 255 * 0.06);
      data[pixelIndex + 2] = clampByte(b - s * 255 * 0.06);
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

const applyNoMaskFlatDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number
) => {
  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const radiusScale = 2.5;
  const extentX =
    Math.abs(axisDir.x) * axisRadius * radiusScale +
    Math.abs(liftDir.x) * liftRadius * radiusScale;
  const extentY =
    Math.abs(axisDir.y) * axisRadius * radiusScale +
    Math.abs(liftDir.y) * liftRadius * radiusScale;
  const minX = clampRange(Math.floor(centerX - extentX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(centerY - extentY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(centerX + extentX), 0, width);
  const maxY = clampRange(Math.ceil(centerY + extentY), 0, height);
  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;
      const dx = canvasX - centerX;
      const dy = canvasY - centerY;
      const axisDistance = dx * axisDir.x + dy * axisDir.y;
      const liftDistance = dx * liftDir.x + dy * liftDir.y;
      const fieldWeight = Math.exp(
        -(
          (axisDistance * axisDistance) / (axisRadius * axisRadius) +
          (liftDistance * liftDistance) / (liftRadius * liftRadius)
        )
      );

      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const response = Math.sqrt(luma);
      const s = fieldWeight * response;

      data[pixelIndex] = clampByte(r + s * 255 * 0.24);
      data[pixelIndex + 1] = clampByte(g - s * 255 * 0.06);
      data[pixelIndex + 2] = clampByte(b - s * 255 * 0.06);
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

const applyNoMaskDepositRgbDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number,
  productData: ProductToneData
) => {
  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const radiusScale = 2.5;
  const extentX =
    Math.abs(axisDir.x) * axisRadius * radiusScale +
    Math.abs(liftDir.x) * liftRadius * radiusScale;
  const extentY =
    Math.abs(axisDir.y) * axisRadius * radiusScale +
    Math.abs(liftDir.y) * liftRadius * radiusScale;
  const minX = clampRange(Math.floor(centerX - extentX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(centerY - extentY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(centerX + extentX), 0, width);
  const maxY = clampRange(Math.ceil(centerY + extentY), 0, height);
  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;
  const target = parseHexColor(productData.color);

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;
      const dx = canvasX - centerX;
      const dy = canvasY - centerY;
      const axisDistance = dx * axisDir.x + dy * axisDir.y;
      const liftDistance = dx * liftDir.x + dy * liftDir.y;
      const fieldWeight = Math.exp(
        -(
          (axisDistance * axisDistance) / (axisRadius * axisRadius) +
          (liftDistance * liftDistance) / (liftRadius * liftRadius)
        )
      );

      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const response = Math.sqrt(luma);
      const weight = clamp01(fieldWeight * response * 0.45);

      data[pixelIndex] = clampByte(lerp(r, target.r, weight));
      data[pixelIndex + 1] = clampByte(lerp(g, target.g, weight));
      data[pixelIndex + 2] = clampByte(lerp(b, target.b, weight));
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

const applyNoMaskDepositBandRgbDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number,
  productData: ProductToneData
) => {
  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const radiusScale = 2.5;
  const extentX =
    Math.abs(axisDir.x) * axisRadius * radiusScale +
    Math.abs(liftDir.x) * liftRadius * radiusScale;
  const extentY =
    Math.abs(axisDir.y) * axisRadius * radiusScale +
    Math.abs(liftDir.y) * liftRadius * radiusScale;
  const minX = clampRange(Math.floor(centerX - extentX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(centerY - extentY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(centerX + extentX), 0, width);
  const maxY = clampRange(Math.ceil(centerY + extentY), 0, height);
  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;
  const target = parseHexColor(productData.color);
  const bandHalfLength = axisRadius * 0.9;
  const bandAxisFalloff = axisRadius * 0.55;
  const bandLiftRadius = liftRadius * 0.42;

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;
      const dx = canvasX - centerX;
      const dy = canvasY - centerY;
      const axisDistance = dx * axisDir.x + dy * axisDir.y;
      const liftDistance = dx * liftDir.x + dy * liftDir.y;
      const axisOutside = Math.max(0, Math.abs(axisDistance) - bandHalfLength);
      const fieldWeight = Math.exp(
        -(
          (axisOutside * axisOutside) / (bandAxisFalloff * bandAxisFalloff) +
          (liftDistance * liftDistance) / (bandLiftRadius * bandLiftRadius)
        )
      );

      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const response = Math.sqrt(luma);
      const weight = clamp01(fieldWeight * response * 0.45);

      data[pixelIndex] = clampByte(lerp(r, target.r, weight));
      data[pixelIndex + 1] = clampByte(lerp(g, target.g, weight));
      data[pixelIndex + 2] = clampByte(lerp(b, target.b, weight));
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

const applyNoMaskDepositEllipseRgbDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number,
  productData: ProductToneData
) => {
  const {
    axisDir,
    liftDir,
    centerX,
    centerY,
    axisRadius,
    liftRadius,
  } = getFieldDebugBasis(area, width, 0.15, 0.18, 2, 1.2);

  const blushAxisRadius = axisRadius * 0.75;
  const blushLiftRadius = liftRadius * 0.55;

  const radiusScale = 2.0;
  const extentX =
    Math.abs(axisDir.x) * blushAxisRadius * radiusScale +
    Math.abs(liftDir.x) * blushLiftRadius * radiusScale;
  const extentY =
    Math.abs(axisDir.y) * blushAxisRadius * radiusScale +
    Math.abs(liftDir.y) * blushLiftRadius * radiusScale;

  const minX = clampRange(
    Math.floor(centerX - extentX),
    0,
    Math.max(width - 1, 0)
  );
  const minY = clampRange(
    Math.floor(centerY - extentY),
    0,
    Math.max(height - 1, 0)
  );
  const maxX = clampRange(Math.ceil(centerX + extentX), 0, width);
  const maxY = clampRange(Math.ceil(centerY + extentY), 0, height);

  const boxWidth = Math.max(0, maxX - minX);
  const boxHeight = Math.max(0, maxY - minY);

  if (!boxWidth || !boxHeight) return;

  const imageData = ctx.getImageData(minX, minY, boxWidth, boxHeight);
  const { data } = imageData;
  const target = parseHexColor(productData.color);

  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const canvasX = minX + x + 0.5;
      const canvasY = minY + y + 0.5;

      const dx = canvasX - centerX;
      const dy = canvasY - centerY;

      const axisDistance = dx * axisDir.x + dy * axisDir.y;
      const liftDistance = dx * liftDir.x + dy * liftDir.y;

      const fieldWeight = Math.exp(
        -(
          (axisDistance * axisDistance) /
          (blushAxisRadius * blushAxisRadius) +
          (liftDistance * liftDistance) /
          (blushLiftRadius * blushLiftRadius)
        )
      );

      const pixelIndex = (y * boxWidth + x) * 4;
      const r = data[pixelIndex];
      const g = data[pixelIndex + 1];
      const b = data[pixelIndex + 2];

      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const response = Math.sqrt(luma);
      const weight = clamp01(fieldWeight * response * 0.45);

      data[pixelIndex] = clampByte(lerp(r, target.r, weight));
      data[pixelIndex + 1] = clampByte(lerp(g, target.g, weight));
      data[pixelIndex + 2] = clampByte(lerp(b, target.b, weight));
    }
  }

  ctx.putImageData(imageData, minX, minY);
};

// basis_debug visualization
const applyBasisDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number
) => {
  const {
    axisDir,
    liftDir,
    centerX,
    centerY,
    axisRadius,
    liftRadius,
  } = getFieldDebugBasis(area, width, 0.35, 0.3, 2, 1.2);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,0,0,0.95)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,0,0,0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(
    centerX - axisDir.x * axisRadius,
    centerY - axisDir.y * axisRadius
  );
  ctx.lineTo(
    centerX + axisDir.x * axisRadius,
    centerY + axisDir.y * axisRadius
  );
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,255,0,0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(
    centerX - liftDir.x * liftRadius,
    centerY - liftDir.y * liftRadius
  );
  ctx.lineTo(
    centerX + liftDir.x * liftRadius,
    centerY + liftDir.y * liftRadius
  );
  ctx.stroke();

  ctx.restore();
};

const drawNoMaskEllipseLayer = (
  ctx: CanvasRenderingContext2D,
  color: string,
  opacity: number,
  composite: GlobalCompositeOperation,
  blur: number,
  ellipse: { x: number; y: number; rx: number; ry: number; rotation: number },
  hexToRgba: (hex: string, opacity: number) => string
) => {
  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = 1;
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = hexToRgba(color, clamp01(opacity));
  ctx.beginPath();
  ctx.ellipse(
    ellipse.x,
    ellipse.y,
    Math.max(1, ellipse.rx),
    Math.max(1, ellipse.ry),
    ellipse.rotation,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();
};

const drawNoMaskGradientLayer = (
  ctx: CanvasRenderingContext2D,
  gradientFactory: (targetCtx: CanvasRenderingContext2D) => CanvasGradient,
  composite: GlobalCompositeOperation,
  blur: number,
  fillBox: { x: number; y: number; width: number; height: number }
) => {
  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = 1;
  ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
  ctx.fillStyle = gradientFactory(ctx);
  ctx.fillRect(fillBox.x, fillBox.y, fillBox.width, fillBox.height);
  ctx.restore();
};

const applyNoMaskVeilDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number,
  productData: ProductToneData,
  preset: CheekPreset,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const extentScale = 3.2;
  const extentX =
    Math.abs(axisDir.x) * axisRadius * extentScale +
    Math.abs(liftDir.x) * liftRadius * extentScale;
  const extentY =
    Math.abs(axisDir.y) * axisRadius * extentScale +
    Math.abs(liftDir.y) * liftRadius * extentScale;
  const minX = clampRange(Math.floor(centerX - extentX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(centerY - extentY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(centerX + extentX), 0, width);
  const maxY = clampRange(Math.ceil(centerY + extentY), 0, height);
  const productColor = productData.color;
  const veilColor =
    preset.kind === "bronzer"
      ? mixHexColors(productColor, "#d49a72", 0.14)
      : preset.kind === "highlighter"
        ? mixHexColors(productColor, "#fff3e7", 0.08)
        : mixHexColors(productColor, "#f4aebe", 0.16);
  const baseOpacity =
    preset.kind === "highlighter"
      ? clamp01(Math.max(0.14, Math.min(0.34, productData.opacity || 0.28)))
      : clamp01((productData.opacity || 0.55) * (preset.kind === "bronzer" ? 0.68 : 0.52));

  const veilGradient = (targetCtx: CanvasRenderingContext2D) => {
    const startX = centerX - axisDir.x * axisRadius * 1.55;
    const startY = centerY - axisDir.y * axisRadius * 1.55;
    const endX = centerX + axisDir.x * axisRadius * 1.28;
    const endY = centerY + axisDir.y * axisRadius * 1.28;
    const gradient = targetCtx.createLinearGradient(startX, startY, endX, endY);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(0.16, hexToRgba(productColor, baseOpacity * 0.05));
    gradient.addColorStop(0.46, hexToRgba(veilColor, baseOpacity * 0.2));
    gradient.addColorStop(0.72, hexToRgba(veilColor, baseOpacity * 0.12));
    gradient.addColorStop(1, "transparent");
    return gradient;
  };

  drawNoMaskGradientLayer(
    ctx,
    veilGradient,
    "soft-light",
    Math.max(26, axisRadius * 0.26),
    {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  );
};

const applyNoMaskVeilPlusBodyBroadDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number,
  productData: ProductToneData,
  preset: CheekPreset,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const extentScale = 3.2;
  const extentX =
    Math.abs(axisDir.x) * axisRadius * extentScale +
    Math.abs(liftDir.x) * liftRadius * extentScale;
  const extentY =
    Math.abs(axisDir.y) * axisRadius * extentScale +
    Math.abs(liftDir.y) * liftRadius * extentScale;
  const minX = clampRange(Math.floor(centerX - extentX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(centerY - extentY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(centerX + extentX), 0, width);
  const maxY = clampRange(Math.ceil(centerY + extentY), 0, height);
  const productColor = productData.color;
  const veilColor =
    preset.kind === "bronzer"
      ? mixHexColors(productColor, "#d49a72", 0.12)
      : preset.kind === "highlighter"
        ? mixHexColors(productColor, "#fff3e7", 0.08)
        : productColor;
  const bodyColor =
    preset.kind === "bronzer"
      ? mixHexColors(productColor, "#b46c49", 0.24)
      : preset.kind === "highlighter"
        ? mixHexColors(productColor, "#ffefdf", 0.12)
        : productColor;
  const bodyCoreColor =
    preset.kind === "bronzer"
      ? mixHexColors(productColor, "#915433", 0.18)
      : preset.kind === "highlighter"
        ? mixHexColors(productColor, "#fff6ee", 0.08)
        : productColor;
  const baseOpacity =
    preset.kind === "highlighter"
      ? clamp01(Math.max(0.14, Math.min(0.34, productData.opacity || 0.28)))
      : clamp01(
        (productData.opacity || 0.55) *
        (preset.kind === "bronzer"
          ? 0.68
          : preset.kind === "blush" || preset.kind === "flush"
            ? 0.6
            : 0.52)
      );

  const veilGradient = (targetCtx: CanvasRenderingContext2D) => {
    const startX = centerX - axisDir.x * axisRadius * 1.55;
    const startY = centerY - axisDir.y * axisRadius * 1.55;
    const endX = centerX + axisDir.x * axisRadius * 1.28;
    const endY = centerY + axisDir.y * axisRadius * 1.28;
    const gradient = targetCtx.createLinearGradient(startX, startY, endX, endY);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(0.16, hexToRgba(productColor, baseOpacity * 0.05));
    gradient.addColorStop(0.44, hexToRgba(veilColor, baseOpacity * 0.19));
    gradient.addColorStop(0.72, hexToRgba(veilColor, baseOpacity * 0.1));
    gradient.addColorStop(1, "transparent");
    return gradient;
  };

  drawNoMaskGradientLayer(
    ctx,
    veilGradient,
    "soft-light",
    Math.max(26, axisRadius * 0.26),
    {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  );

  const bodyCenterX =
    centerX - axisDir.x * axisRadius * 0.24 - liftDir.x * liftRadius * 0.06;
  const bodyCenterY =
    centerY - axisDir.y * axisRadius * 0.24 - liftDir.y * liftRadius * 0.2;
  const bodyAxisExtent = axisRadius * 1.36;
  const bodyLiftExtent = liftRadius * 0.72;
  const bodyExtentX =
    Math.abs(axisDir.x) * bodyAxisExtent + Math.abs(liftDir.x) * bodyLiftExtent;
  const bodyExtentY =
    Math.abs(axisDir.y) * bodyAxisExtent + Math.abs(liftDir.y) * bodyLiftExtent;
  const bodyMinX = clampRange(
    Math.floor(bodyCenterX - bodyExtentX),
    0,
    Math.max(width - 1, 0)
  );
  const bodyMinY = clampRange(
    Math.floor(bodyCenterY - bodyExtentY),
    0,
    Math.max(height - 1, 0)
  );
  const bodyMaxX = clampRange(Math.ceil(bodyCenterX + bodyExtentX), 0, width);
  const bodyMaxY = clampRange(Math.ceil(bodyCenterY + bodyExtentY), 0, height);

  const bodyGradient = (targetCtx: CanvasRenderingContext2D) => {
    const startX = bodyCenterX - axisDir.x * axisRadius * 1.26;
    const startY = bodyCenterY - axisDir.y * axisRadius * 1.26;
    const endX = bodyCenterX + axisDir.x * axisRadius * 0.58;
    const endY = bodyCenterY + axisDir.y * axisRadius * 0.58;
    const gradient = targetCtx.createLinearGradient(startX, startY, endX, endY);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(0.16, hexToRgba(veilColor, baseOpacity * 0.05));
    gradient.addColorStop(0.34, hexToRgba(bodyColor, baseOpacity * 0.40));
    gradient.addColorStop(0.5, hexToRgba(bodyCoreColor, baseOpacity * 0.58));
    gradient.addColorStop(0.6, hexToRgba(bodyCoreColor, baseOpacity * 0.62));
    gradient.addColorStop(0.72, hexToRgba(bodyColor, baseOpacity * 0.44));
    gradient.addColorStop(0.84, hexToRgba(veilColor, baseOpacity * 0.07));
    gradient.addColorStop(1, "transparent");
    return gradient;
  };

  drawNoMaskGradientLayer(
    ctx,
    bodyGradient,
    "soft-light",
    Math.max(24, axisRadius * 0.22),
    {
      x: bodyMinX,
      y: bodyMinY,
      width: Math.max(1, bodyMaxX - bodyMinX),
      height: Math.max(1, bodyMaxY - bodyMinY),
    }
  );
};

const applyNoMaskStackDebugToArea = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  width: number,
  height: number,
  productData: ProductToneData,
  preset: CheekPreset,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  const { axisDir, liftDir, centerX, centerY, axisRadius, liftRadius } = getFieldDebugBasis(
    area,
    width,
    0.35,
    0.3,
    2,
    1.2
  );
  const extentScale = 3;
  const extentX =
    Math.abs(axisDir.x) * axisRadius * extentScale +
    Math.abs(liftDir.x) * liftRadius * extentScale;
  const extentY =
    Math.abs(axisDir.y) * axisRadius * extentScale +
    Math.abs(liftDir.y) * liftRadius * extentScale;
  const minX = clampRange(Math.floor(centerX - extentX), 0, Math.max(width - 1, 0));
  const minY = clampRange(Math.floor(centerY - extentY), 0, Math.max(height - 1, 0));
  const maxX = clampRange(Math.ceil(centerX + extentX), 0, width);
  const maxY = clampRange(Math.ceil(centerY + extentY), 0, height);
  const rotation = Math.atan2(axisDir.y, axisDir.x);
  const baseOpacity =
    preset.kind === "highlighter"
      ? clamp01(Math.max(0.18, Math.min(0.45, productData.opacity || 0.32)))
      : clamp01((productData.opacity || 0.55) * (preset.kind === "bronzer" ? 0.9 : 0.82));
  const productColor = productData.color;
  const baseColor =
    preset.kind === "bronzer"
      ? mixHexColors(productColor, "#6b3a27", 0.18)
      : preset.kind === "highlighter"
        ? mixHexColors(productColor, "#fff8ef", 0.08)
        : mixHexColors(productColor, "#8f244f", 0.22);
  const bodyColor =
    preset.kind === "bronzer"
      ? mixHexColors(productColor, "#c98762", 0.16)
      : preset.kind === "highlighter"
        ? mixHexColors(productColor, "#ffeede", 0.12)
        : mixHexColors(productColor, "#f3a4b4", 0.18);
  const bloomColor =
    preset.kind === "bronzer"
      ? mixHexColors(productColor, "#f3dcc8", 0.14)
      : preset.kind === "highlighter"
        ? mixHexColors(productColor, "#fffdf9", 0.05)
        : mixHexColors(productColor, "#ffdce4", 0.2);

  const veilGradient = (targetCtx: CanvasRenderingContext2D) => {
    const startX = centerX - axisDir.x * axisRadius * 1.45;
    const startY = centerY - axisDir.y * axisRadius * 1.45;
    const endX = centerX + axisDir.x * axisRadius * 1.2;
    const endY = centerY + axisDir.y * axisRadius * 1.2;
    const gradient = targetCtx.createLinearGradient(startX, startY, endX, endY);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(0.22, hexToRgba(productColor, baseOpacity * 0.12));
    gradient.addColorStop(0.56, hexToRgba(bodyColor, baseOpacity * 0.24));
    gradient.addColorStop(0.86, hexToRgba(bloomColor, baseOpacity * 0.08));
    gradient.addColorStop(1, "transparent");
    return gradient;
  };

  drawNoMaskGradientLayer(
    ctx,
    veilGradient,
    preset.kind === "bronzer" ? "soft-light" : "soft-light",
    Math.max(18, axisRadius * 0.18),
    {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  );

  drawNoMaskEllipseLayer(
    ctx,
    baseColor,
    baseOpacity * (preset.kind === "highlighter" ? 0.08 : 0.16),
    preset.kind === "highlighter" ? "soft-light" : "multiply",
    Math.max(12, axisRadius * 0.15),
    {
      x: centerX - axisDir.x * axisRadius * 0.12 + liftDir.x * liftRadius * 0.06,
      y: centerY - axisDir.y * axisRadius * 0.12 + liftDir.y * liftRadius * 0.06,
      rx: axisRadius * (preset.kind === "bronzer" ? 0.72 : 0.62),
      ry: liftRadius * (preset.kind === "highlighter" ? 0.5 : 0.72),
      rotation,
    },
    hexToRgba
  );

  drawNoMaskEllipseLayer(
    ctx,
    bodyColor,
    baseOpacity * (preset.kind === "highlighter" ? 0.18 : 0.28),
    preset.kind === "highlighter" ? "screen" : "soft-light",
    Math.max(18, axisRadius * 0.24),
    {
      x: centerX - axisDir.x * axisRadius * 0.04,
      y: centerY - axisDir.y * axisRadius * 0.04,
      rx: axisRadius * (preset.kind === "bronzer" ? 1 : 0.88),
      ry: liftRadius * (preset.kind === "highlighter" ? 0.68 : 0.98),
      rotation,
    },
    hexToRgba
  );

  drawNoMaskEllipseLayer(
    ctx,
    bloomColor,
    baseOpacity * (preset.kind === "highlighter" ? 0.14 : 0.11),
    "screen",
    Math.max(10, axisRadius * 0.14),
    {
      x: centerX - axisDir.x * axisRadius * 0.24 + liftDir.x * liftRadius * 0.18,
      y: centerY - axisDir.y * axisRadius * 0.24 + liftDir.y * liftRadius * 0.18,
      rx: axisRadius * (preset.kind === "highlighter" ? 0.48 : 0.44),
      ry: liftRadius * (preset.kind === "highlighter" ? 0.34 : 0.3),
      rotation,
    },
    hexToRgba
  );
};

const drawDebugAreaOverlay = (
  ctx: CanvasRenderingContext2D,
  area: BuiltArea,
  fillStyle: string
) => {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = fillStyle;
  ctx.fill(area.path);
  ctx.restore();
};

export function applyMobileComplexionTone(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const preset = getMobileComplexionPreset(productData);
  if (!preset) return false;

  // These calibrated presets already contain the cross-browser complexion
  // implementation. Route them here rather than falling back to desktop.
  if (preset.kind === "blush" || preset.kind === "flush") {
    renderBlush(ctx, landmarks, productData, width, height, hexToRgba);
    return true;
  }
  if (preset.kind === "bronzer") {
    renderBronzer(ctx, landmarks, productData, width, height, hexToRgba);
    return true;
  }
  if (preset.kind === "highlighter") {
    if (!productData.regions?.upper_cheeks) return false;
    renderHighlighter(ctx, landmarks, productData, width, height, hexToRgba);
    return true;
  }

  const areas = getRegionAreas(
    preset.regionName,
    (productData.regions?.[preset.regionName] ??
      (preset.regionName !== "cheeks" ? productData.regions?.cheeks : undefined)) as
    | RegionDefinition
    | undefined,
    landmarks,
    width,
    height
  );
  if (!areas.length) return false;

  const debugMode = getMobileDebugMode();

  let rendered = false;

  if (debugMode === "geometry") {
    areas.forEach((area) => {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,0,0,0.35)";
      ctx.fill(area.path);
      ctx.restore();
    });
    return true;
  }

  if (debugMode === "luminance") {
    areas.forEach((area) => {
      applyLuminanceDebugToArea(ctx, area, width, height);
    });
    return true;
  }

  if (debugMode === "field") {
    areas.forEach((area) => {
      applyFieldDebugToArea(ctx, area, width, height);
    });
    return true;
  }

  if (debugMode === "fieldluma") {
    areas.forEach((area) => {
      applyFieldLumaDebugToArea(ctx, area, width, height);
    });
    return true;
  }

  if (debugMode === "fieldlumaresponse") {
    areas.forEach((area) => {
      applyFieldLumaResponseDebugToArea(ctx, area, width, height);
    });
    return true;
  }

  if (debugMode === "basis_debug") {
    areas.forEach((area) => {
      applyBasisDebugToArea(ctx, area, width);
    });
    return true;
  }

  if (debugMode === "nomask_flat") {
    areas.forEach((area) => {
      applyNoMaskFlatDebugToArea(ctx, area, width, height);
    });
    return true;
  }

  if (debugMode === "nomask_deposit_rgb") {
    areas.forEach((area) => {
      applyNoMaskDepositRgbDebugToArea(ctx, area, width, height, productData);
    });
    return true;
  }

  if (debugMode === "nomask_deposit_band_rgb") {
    areas.forEach((area) => {
      applyNoMaskDepositBandRgbDebugToArea(ctx, area, width, height, productData);
    });
    return true;
  }

  if (debugMode === "nomask_deposit_ellipse_rgb") {
    areas.forEach((area) => {
      applyNoMaskDepositEllipseRgbDebugToArea(
        ctx,
        area,
        width,
        height,
        productData
      );
    });
    return true;
  }

  if (debugMode === "nomask_veil") {
    areas.forEach((area) => {
      applyNoMaskVeilDebugToArea(ctx, area, width, height, productData, preset, hexToRgba);
    });
    return true;
  }

  if (debugMode === "nomask_veil_plus_body_broad") {
    areas.forEach((area) => {
      applyNoMaskVeilPlusBodyBroadDebugToArea(
        ctx,
        area,
        width,
        height,
        productData,
        preset,
        hexToRgba
      );
    });
    return true;
  }

  if (debugMode === "nomask_stack") {
    areas.forEach((area) => {
      applyNoMaskStackDebugToArea(
        ctx,
        area,
        width,
        height,
        productData,
        preset,
        hexToRgba
      );
    });
    return true;
  }

  if (debugMode === "fieldlumapath") {
    areas.forEach((area) => {
      applyFieldLumaDebugToArea(ctx, area, width, height);
      drawDebugAreaOverlay(ctx, area, "rgba(255,0,0,0.15)");
    });
    return true;
  }

  if (debugMode === "regions") {
    areas.forEach((area) => {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = hexToRgba(productData.color, 0.22);
      ctx.fill(area.path);
      ctx.restore();
    });
    return true;
  }



  return rendered;
}
