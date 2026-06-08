import { ProductToneData, RegionDefinition } from "@/lib/utils";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };
type BlushFinish = "flush_bloom" | "dream_paint";

const BLUSH_CHEEK_BAND = {
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

const CHEEK_MIRROR_MAP: Record<number, number> = {
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

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const isLikelyWebKitMaskBugBrowser = (() => {
  let cached: boolean | null = null;

  return () => {
    if (cached != null) return cached;
    if (typeof navigator === "undefined") return false;

    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    const touchPoints =
      typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) || (touchPoints > 1 && /Mac/.test(platform));
    const isSafari =
      /Safari\//.test(ua) &&
      !/Chrome\/|CriOS\/|FxiOS\/|EdgiOS\/|Edg\//.test(ua);

    cached = isIOS || isSafari;
    return cached;
  };
})();

const shouldUseSimpleMobileBlushFallback = (() => {
  let cached: boolean | null = null;

  return () => {
    if (cached != null) return cached;
    if (typeof navigator === "undefined" || typeof window === "undefined") return false;

    const ua = navigator.userAgent || "";
    const touchPoints =
      typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0;
    const coarsePointer =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    const isIOSLike =
      /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(navigator.platform || "") && touchPoints > 1);

    cached = isLikelyWebKitMaskBugBrowser() && (coarsePointer || isIOSLike);
    return cached;
  };
})();

const normalizeRegion = (region?: RegionDefinition | null): number[] | null => {
  if (!region) return null;
  if (Array.isArray(region[0])) return (region as number[][])[0];
  return region as number[];
};

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
  let sumX = 0;
  let sumY = 0;

  indices.forEach((index, idx) => {
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

    if (idx === 0) path.moveTo(point.x, point.y);
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

const buildCheekBandPath = (
  upperIndices: readonly number[],
  lowerIndices: readonly number[],
  outerBridgeIndices: readonly number[],
  landmarks: Landmark[],
  width: number,
  height: number
) => {
  const upper = buildLinePoints(upperIndices, landmarks, width, height);
  const lower = buildLinePoints(lowerIndices, landmarks, width, height);
  const outerBridge = buildLinePoints(outerBridgeIndices, landmarks, width, height);
  if (upper.length < 2 || lower.length < 2) return null;

  const alignedLower = orientLineToMatch(upper, lower);
  const lowerScale = 1.62;
  const expandedLower: Point[] = [];
  const lowerSamples = Math.max(upper.length, alignedLower.length, 6);

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
      x: anchor.x + (point.x - anchor.x) * 1.22,
      y: anchor.y + (point.y - anchor.y) * 1.22,
    };
  });

  const polygon = [...upper, ...expandedLower.slice().reverse(), ...expandedOuterBridge];
  if (polygon.length < 4) return null;

  const path = new Path2D();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;

  polygon.forEach((point, idx) => {
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
    points: polygon,
    minX,
    minY,
    maxX,
    maxY,
    centerX: sumX / polygon.length,
    centerY: sumY / polygon.length,
    areaWidth: Math.max(1, maxX - minX),
    areaHeight: Math.max(1, maxY - minY),
  };
};

const mirrorRegion = (indices: number[], map: Record<number, number>) => {
  const mirrored = indices.map((index) => map[index]);
  return mirrored.every(Boolean) ? mirrored : null;
};

const buildRegionVariants = (name: string, region?: RegionDefinition | null) => {
  const polygons = normalizeRegionPolygons(region);
  if (!polygons.length) return [];

  const mirrorMap =
    name === "cheekbones" || name === "cheeks"
      ? CHEEK_MIRROR_MAP
      : name === "temples"
        ? TEMPLE_MIRROR_MAP
        : null;

  if (!mirrorMap || polygons.length !== 1) return polygons;

  const mirrored = mirrorRegion(polygons[0], mirrorMap);
  return mirrored ? [...polygons, mirrored] : polygons;
};

type BuiltArea = NonNullable<ReturnType<typeof buildAreaPath>>;

type SoftPathMask = {
  bounds: BuiltArea;
  featherPx: number;
};

type GradientSource = CanvasGradient | ((targetCtx: CanvasRenderingContext2D) => CanvasGradient);

const buildAreaFromPoints = (points: Point[]): BuiltArea | null => {
  if (points.length < 3) return null;

  const path = new Path2D();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;

  points.forEach((point, index) => {
    sumX += point.x;
    sumY += point.y;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);

    if (index === 0) path.moveTo(point.x, point.y);
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

const buildDreamPaintCheekArea = (built: BuiltArea, faceCenterX: number) => {
  const side = built.centerX < faceCenterX ? -1 : 1;
  const rotation = side < 0 ? 0.42 : -0.42;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const centerX = built.centerX - side * built.areaWidth * 0.12;
  const centerY = built.centerY + built.areaHeight * 0.36;
  const rx = built.areaWidth * 0.78;
  const ry = built.areaHeight * 1.04;
  const points: Point[] = [];

  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2;
    const yWeight = Math.sin(angle);
    const localX = Math.cos(angle) * rx * (yWeight > 0 ? 1.02 : 0.92);
    const localY = yWeight * ry * (yWeight > 0 ? 1.16 : 0.82);

    points.push({
      x: centerX + localX * cos - localY * sin,
      y: centerY + localX * sin + localY * cos,
    });
  }

  return buildAreaFromPoints(points) ?? built;
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
  drawContent: (layerCtx: CanvasRenderingContext2D) => void
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
  maskCtx.fill(path);
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

const renderEllipseLayer = (
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  opacity: number,
  composite: GlobalCompositeOperation,
  blur: number,
  ellipse: { x: number; y: number; rx: number; ry: number; rotation: number },
  hexToRgba: (hex: string, opacity: number) => string,
  mask?: SoftPathMask
) => {
  if (mask && !isLikelyWebKitMaskBugBrowser()) {
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
      }
    );
    return;
  }

  ctx.save();
  ctx.clip(path);
  ctx.globalCompositeOperation = composite;
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

const renderGradientLayer = (
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  gradient: GradientSource,
  composite: GlobalCompositeOperation,
  blur: number,
  fillBox: { x: number; y: number; width: number; height: number },
  mask?: SoftPathMask
) => {
  if (mask && !isLikelyWebKitMaskBugBrowser()) {
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
      }
    );
    return;
  }

  ctx.save();
  ctx.clip(path);
  ctx.globalCompositeOperation = composite;
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = resolveGradient(gradient, ctx);
  ctx.fillRect(fillBox.x, fillBox.y, fillBox.width, fillBox.height);
  ctx.restore();
};

const renderCheekBlush = (
  ctx: CanvasRenderingContext2D,
  built: ReturnType<typeof buildAreaPath>,
  faceCenterX: number,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string,
  finish: BlushFinish
) => {
  if (!built) return;

  if (shouldUseSimpleMobileBlushFallback()) {
    const isDreamPaint = finish === "dream_paint";
    const fillBase = isDreamPaint
      ? mixHexColors(productColor, "#b14e6d", 0.08)
      : mixHexColors(productColor, "#a24162", 0.1);
    const fillGlow = isDreamPaint
      ? mixHexColors(productColor, "#ffd9df", 0.14)
      : mixHexColors(productColor, "#ffe0e5", 0.12);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = baseOpacity * (isDreamPaint ? 0.2 : 0.17);
    ctx.fillStyle = hexToRgba(fillBase, 1);
    ctx.fill(built.path);
    ctx.restore();

    const gradient = ctx.createLinearGradient(
      built.centerX,
      built.minY,
      built.centerX,
      built.maxY
    );
    gradient.addColorStop(0, hexToRgba(fillGlow, baseOpacity * (isDreamPaint ? 0.12 : 0.09)));
    gradient.addColorStop(
      0.45,
      hexToRgba(productColor, baseOpacity * (isDreamPaint ? 0.08 : 0.06))
    );
    gradient.addColorStop(1, "transparent");

    renderGradientLayer(
      ctx,
      built.path,
      gradient,
      "soft-light",
      0,
      {
        x: built.minX,
        y: built.minY,
        width: built.areaWidth,
        height: built.areaHeight,
      }
    );
    return;
  }

  const side = built.centerX < faceCenterX ? -1 : 1;
  const outerX = side < 0 ? built.minX : built.maxX;
  const innerX = side < 0 ? built.maxX : built.minX;
  const rotation = side < 0 ? 0.54 : -0.54;
  const isDreamPaint = finish === "dream_paint";
  const upperY = lerp(built.minY, built.maxY, isDreamPaint ? 0.28 : 0.3);
  const bodyY = lerp(built.minY, built.maxY, isDreamPaint ? 0.43 : 0.48);
  const veilY = lerp(built.minY, built.maxY, isDreamPaint ? 0.38 : 0.42);

  const creamVeil = isDreamPaint
    ? mixHexColors(productColor, "#e895a8", 0.1)
    : mixHexColors(productColor, "#cf6b90", 0.1);
  const creamBase = isDreamPaint
    ? mixHexColors(productColor, "#b94768", 0.22)
    : mixHexColors(productColor, "#8f244f", 0.2);
  const creamBody = isDreamPaint
    ? mixHexColors(productColor, "#ffadb7", 0.18)
    : mixHexColors(productColor, "#f3a4b4", 0.18);
  const creamBloom = isDreamPaint
    ? mixHexColors(productColor, "#ffe2e7", 0.16)
    : mixHexColors(productColor, "#ffdce4", 0.2);
  const satinLift = isDreamPaint
    ? mixHexColors(productColor, "#fff7f8", 0.08)
    : mixHexColors(productColor, "#fff4f6", 0.1);
  const softCoreMask: SoftPathMask = {
    bounds: built,
    featherPx: isDreamPaint
      ? Math.max(6, Math.min(13, built.areaWidth * 0.036))
      : Math.max(3, Math.min(6, built.areaWidth * 0.018)),
  };
  const softOuterMask: SoftPathMask = {
    bounds: built,
    featherPx: isDreamPaint
      ? Math.max(22, Math.min(44, built.areaWidth * 0.132))
      : Math.max(9, Math.min(18, built.areaWidth * 0.055)),
  };

  const createVeilGradient = (targetCtx: CanvasRenderingContext2D) => {
    const veilGrad = targetCtx.createLinearGradient(
      lerp(innerX, outerX, 0.18),
      built.minY,
      lerp(innerX, outerX, 0.84),
      built.maxY
    );
    veilGrad.addColorStop(0, "transparent");
    veilGrad.addColorStop(0.2, hexToRgba(creamVeil, baseOpacity * (isDreamPaint ? 0.18 : 0.12)));
    veilGrad.addColorStop(0.54, hexToRgba(creamVeil, baseOpacity * (isDreamPaint ? 0.3 : 0.2)));
    veilGrad.addColorStop(0.84, hexToRgba(creamBody, baseOpacity * (isDreamPaint ? 0.16 : 0.1)));
    veilGrad.addColorStop(1, "transparent");
    return veilGrad;
  };

  renderGradientLayer(
    ctx,
    built.path,
    createVeilGradient,
    "soft-light",
    Math.max(isDreamPaint ? 16 : 18, built.areaWidth * (isDreamPaint ? 0.082 : 0.09)),
    {
      x: built.minX - built.areaWidth * 0.3,
      y: built.minY - built.areaHeight * 0.4,
      width: built.areaWidth * 1.6,
      height: built.areaHeight * 1.8,
    },
    softOuterMask
  );

  renderEllipseLayer(
    ctx,
    built.path,
    creamBase,
    baseOpacity * (isDreamPaint ? 0.18 : 0.16),
    "multiply",
    Math.max(isDreamPaint ? 16 : 14, built.areaWidth * (isDreamPaint ? 0.084 : 0.072)),
    {
      x: lerp(innerX, outerX, isDreamPaint ? 0.64 : 0.58),
      y: bodyY,
      rx: built.areaWidth * (isDreamPaint ? 0.34 : 0.3),
      ry: built.areaHeight * (isDreamPaint ? 0.24 : 0.2),
      rotation,
    },
    hexToRgba,
    softCoreMask
  );

  renderEllipseLayer(
    ctx,
    built.path,
    creamBody,
    baseOpacity * (isDreamPaint ? 0.54 : 0.38),
    "soft-light",
    Math.max(isDreamPaint ? 28 : 22, built.areaWidth * (isDreamPaint ? 0.138 : 0.108)),
    {
      x: lerp(innerX, outerX, isDreamPaint ? 0.58 : 0.56),
      y: veilY,
      rx: built.areaWidth * (isDreamPaint ? 0.68 : 0.58),
      ry: built.areaHeight * (isDreamPaint ? 0.48 : 0.38),
      rotation,
    },
    hexToRgba,
    softOuterMask
  );

  renderEllipseLayer(
    ctx,
    built.path,
    creamBloom,
    baseOpacity * (isDreamPaint ? 0.14 : 0.14),
    "screen",
    Math.max(isDreamPaint ? 14 : 18, built.areaWidth * (isDreamPaint ? 0.072 : 0.088)),
    {
      x: lerp(innerX, outerX, isDreamPaint ? 0.48 : 0.5),
      y: upperY,
      rx: built.areaWidth * (isDreamPaint ? 0.34 : 0.4),
      ry: built.areaHeight * 0.2,
      rotation,
    },
    hexToRgba,
    softCoreMask
  );

  renderEllipseLayer(
    ctx,
    built.path,
    satinLift,
    baseOpacity * (isDreamPaint ? 0.05 : 0.08),
    "screen",
    Math.max(isDreamPaint ? 14 : 20, built.areaWidth * (isDreamPaint ? 0.075 : 0.1)),
    {
      x: lerp(innerX, outerX, isDreamPaint ? 0.4 : 0.44),
      y: lerp(built.minY, built.maxY, isDreamPaint ? 0.22 : 0.24),
      rx: built.areaWidth * (isDreamPaint ? 0.26 : 0.32),
      ry: built.areaHeight * (isDreamPaint ? 0.13 : 0.15),
      rotation,
    },
    hexToRgba,
    softCoreMask
  );
};

const renderNoseTint = (
  ctx: CanvasRenderingContext2D,
  built: ReturnType<typeof buildAreaPath>,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) => {
  if (!built) return;

  if (shouldUseSimpleMobileBlushFallback()) {
    const noseColor = mixHexColors(productColor, "#f3b6bf", 0.12);
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = baseOpacity * 0.12;
    ctx.fillStyle = hexToRgba(noseColor, 1);
    ctx.fill(built.path);
    ctx.restore();
    return;
  }

  const noseColor = mixHexColors(productColor, "#f4b0b8", 0.18);
  const noseGlow = mixHexColors(productColor, "#ffe5e8", 0.2);
  const noseGrad = ctx.createRadialGradient(
    built.centerX,
    lerp(built.minY, built.maxY, 0.38),
    0,
    built.centerX,
    lerp(built.minY, built.maxY, 0.42),
    Math.max(built.areaWidth, built.areaHeight) * 0.88
  );
  noseGrad.addColorStop(0, hexToRgba(noseColor, baseOpacity * 0.16));
  noseGrad.addColorStop(0.58, hexToRgba(noseGlow, baseOpacity * 0.08));
  noseGrad.addColorStop(1, "transparent");

  renderGradientLayer(
    ctx,
    built.path,
    noseGrad,
    "soft-light",
    Math.max(8, built.areaWidth * 0.4),
    {
      x: built.minX - built.areaWidth,
      y: built.minY - built.areaHeight,
      width: built.areaWidth * 3,
      height: built.areaHeight * 3,
    }
  );
};

const renderSoftAreaBlush = (
  ctx: CanvasRenderingContext2D,
  built: BuiltArea | null,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string,
  intensity = 1
) => {
  if (!built) return;

  if (shouldUseSimpleMobileBlushFallback()) {
    const areaBase = mixHexColors(productColor, "#af4b67", 0.08);
    const areaGlow = mixHexColors(productColor, "#ffe0e5", 0.1);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = baseOpacity * 0.1 * intensity;
    ctx.fillStyle = hexToRgba(areaBase, 1);
    ctx.fill(built.path);
    ctx.restore();

    const gradient = ctx.createLinearGradient(
      built.centerX,
      built.minY,
      built.centerX,
      built.maxY
    );
    gradient.addColorStop(0, hexToRgba(areaGlow, baseOpacity * 0.08 * intensity));
    gradient.addColorStop(0.4, hexToRgba(productColor, baseOpacity * 0.05 * intensity));
    gradient.addColorStop(1, "transparent");

    renderGradientLayer(
      ctx,
      built.path,
      gradient,
      "soft-light",
      0,
      {
        x: built.minX,
        y: built.minY,
        width: built.areaWidth,
        height: built.areaHeight,
      }
    );
    return;
  }

  const softCoreMask: SoftPathMask = {
    bounds: built,
    featherPx: Math.max(5, Math.min(14, built.areaWidth * 0.07)),
  };
  const softOuterMask: SoftPathMask = {
    bounds: built,
    featherPx: Math.max(10, Math.min(28, built.areaWidth * 0.14)),
  };
  const areaBase = mixHexColors(productColor, "#a53d5b", 0.12);
  const areaBody = mixHexColors(productColor, "#ff9aaa", 0.16);
  const areaGlow = mixHexColors(productColor, "#ffd9df", 0.16);

  const areaGrad = (targetCtx: CanvasRenderingContext2D) => {
    const gradient = targetCtx.createRadialGradient(
      built.centerX,
      built.centerY,
      Math.max(1, Math.min(built.areaWidth, built.areaHeight) * 0.08),
      built.centerX,
      built.centerY,
      Math.max(built.areaWidth, built.areaHeight) * 0.92
    );
    gradient.addColorStop(0, hexToRgba(areaBody, baseOpacity * 0.28 * intensity));
    gradient.addColorStop(0.54, hexToRgba(areaBody, baseOpacity * 0.16 * intensity));
    gradient.addColorStop(1, "transparent");
    return gradient;
  };

  renderGradientLayer(
    ctx,
    built.path,
    areaGrad,
    "soft-light",
    Math.max(8, built.areaWidth * 0.1),
    {
      x: built.minX - built.areaWidth * 0.32,
      y: built.minY - built.areaHeight * 0.32,
      width: built.areaWidth * 1.64,
      height: built.areaHeight * 1.64,
    },
    softOuterMask
  );

  renderEllipseLayer(
    ctx,
    built.path,
    areaBase,
    baseOpacity * 0.12 * intensity,
    "multiply",
    Math.max(5, built.areaWidth * 0.06),
    {
      x: built.centerX,
      y: built.centerY,
      rx: built.areaWidth * 0.38,
      ry: built.areaHeight * 0.34,
      rotation: 0,
    },
    hexToRgba,
    softCoreMask
  );

  renderEllipseLayer(
    ctx,
    built.path,
    areaGlow,
    baseOpacity * 0.1 * intensity,
    "screen",
    Math.max(7, built.areaWidth * 0.08),
    {
      x: built.centerX,
      y: lerp(built.minY, built.maxY, 0.32),
      rx: built.areaWidth * 0.32,
      ry: built.areaHeight * 0.2,
      rotation: 0,
    },
    hexToRgba,
    softOuterMask
  );
};

const renderLipTint = (
  ctx: CanvasRenderingContext2D,
  outerBuilt: ReturnType<typeof buildAreaPath>,
  innerPath: Path2D | null,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string,
  finish: BlushFinish
) => {
  if (!outerBuilt) return;

  const combined = new Path2D();
  combined.addPath(outerBuilt.path);
  if (innerPath) combined.addPath(innerPath);

  const isDreamPaint = finish === "dream_paint";
  const lipBase = isDreamPaint
    ? mixHexColors(productColor, "#93445a", 0.14)
    : mixHexColors(productColor, "#8e2f4d", 0.14);
  const lipCream = isDreamPaint
    ? mixHexColors(productColor, "#ffc4cc", 0.12)
    : mixHexColors(productColor, "#f2b1be", 0.16);
  const lipGlow = isDreamPaint
    ? mixHexColors(productColor, "#fff0f3", 0.1)
    : mixHexColors(productColor, "#ffdfe4", 0.14);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = baseOpacity * (isDreamPaint ? 0.52 : 0.46);
  ctx.fillStyle = hexToRgba(lipBase, baseOpacity * (isDreamPaint ? 0.68 : 0.62));
  ctx.fill(combined, "evenodd");
  ctx.restore();

  ctx.save();
  ctx.clip(combined, "evenodd");
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = baseOpacity * (isDreamPaint ? 0.2 : 0.24);
  ctx.filter = `blur(${Math.max(isDreamPaint ? 2 : 2.5, outerBuilt.areaWidth * (isDreamPaint ? 0.024 : 0.03))}px)`;
  ctx.fillStyle = hexToRgba(lipCream, baseOpacity * (isDreamPaint ? 0.42 : 0.5));
  ctx.fill(combined, "evenodd");
  ctx.restore();

  const lipGrad = ctx.createLinearGradient(
    outerBuilt.centerX,
    outerBuilt.minY,
    outerBuilt.centerX,
    outerBuilt.maxY
  );
  lipGrad.addColorStop(0, hexToRgba(lipGlow, baseOpacity * (isDreamPaint ? 0.12 : 0.18)));
  lipGrad.addColorStop(0.35, hexToRgba(lipGlow, baseOpacity * (isDreamPaint ? 0.04 : 0.06)));
  lipGrad.addColorStop(1, "transparent");

  renderGradientLayer(
    ctx,
    combined,
    lipGrad,
    "screen",
    Math.max(isDreamPaint ? 2.4 : 3, outerBuilt.areaWidth * (isDreamPaint ? 0.016 : 0.02)),
    {
      x: outerBuilt.minX - outerBuilt.areaWidth * 0.2,
      y: outerBuilt.minY - outerBuilt.areaHeight * 0.2,
      width: outerBuilt.areaWidth * 1.4,
      height: outerBuilt.areaHeight * 1.4,
    }
  );
};

export function renderBlush(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const finish: BlushFinish =
    productData.display_name?.toLowerCase().includes("dream paint blush")
      ? "dream_paint"
      : "flush_bloom";
  const baseOpacity = clamp01((productData.opacity ?? 0.55) * (finish === "dream_paint" ? 1.12 : 1));

  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  const faceCenterX =
    leftTemple && rightTemple
      ? ((leftTemple.x + rightTemple.x) * width) / 2
      : width / 2;

  const cheekMasks = [
    buildCheekBandPath(
      BLUSH_CHEEK_BAND.left.upper,
      BLUSH_CHEEK_BAND.left.lower,
      BLUSH_CHEEK_BAND.left.outerBridge,
      landmarks,
      width,
      height
    ),
    buildCheekBandPath(
      BLUSH_CHEEK_BAND.right.upper,
      BLUSH_CHEEK_BAND.right.lower,
      BLUSH_CHEEK_BAND.right.outerBridge,
      landmarks,
      width,
      height
    ),
  ].filter(Boolean);

  if (cheekMasks.length) {
    cheekMasks.forEach((built) => {
      renderCheekBlush(
        ctx,
        built,
        faceCenterX,
        productData.color,
        baseOpacity,
        hexToRgba,
        finish
      );
    });
  } else {
    const cheekRegion = normalizeRegion(productData.regions["cheeks"]);
    if (!cheekRegion) return;

    const cheekRegions = [cheekRegion];
    const mirroredCheek = mirrorRegion(cheekRegion, CHEEK_MIRROR_MAP);
    if (mirroredCheek) cheekRegions.push(mirroredCheek);

    cheekRegions.forEach((indices) => {
      const built = buildAreaPath(indices, landmarks, width, height);
      renderCheekBlush(
        ctx,
        built,
        faceCenterX,
        productData.color,
        baseOpacity,
        hexToRgba,
        finish
      );
    });
  }

  const noseRegion = normalizeRegion(productData.regions["nose"]);
  if (noseRegion) {
    const noseBuilt = buildAreaPath(noseRegion, landmarks, width, height);
    renderNoseTint(ctx, noseBuilt, productData.color, baseOpacity, hexToRgba);
  }

  Object.entries(productData.regions ?? {}).forEach(([name, region]) => {
    if (
      name === "cheeks" ||
      name === "cheekbones" ||
      name === "nose" ||
      name === "lips_outer" ||
      name === "lips_inner"
    ) {
      return;
    }

    buildRegionVariants(name, region).forEach((indices) => {
      const built = buildAreaPath(indices, landmarks, width, height);
      if (!built) return;

      if (name === "nose_contour") {
        renderSoftAreaBlush(ctx, built, productData.color, baseOpacity, hexToRgba, 0.58);
        return;
      }

      if (name === "eyelids") {
        renderSoftAreaBlush(ctx, built, productData.color, baseOpacity, hexToRgba, 0.45);
        return;
      }

      if (name === "temples") {
        renderSoftAreaBlush(ctx, built, productData.color, baseOpacity, hexToRgba, 0.5);
      }
    });
  });

  const lipsOuter = normalizeRegion(productData.regions["lips_outer"]);
  if (lipsOuter) {
    const outerBuilt = buildAreaPath(lipsOuter, landmarks, width, height);
    const lipsInner = normalizeRegion(productData.regions["lips_inner"]);
    const innerBuilt = lipsInner ? buildAreaPath(lipsInner, landmarks, width, height) : null;
    renderLipTint(
      ctx,
      outerBuilt,
      innerBuilt?.path || null,
      productData.color,
      baseOpacity,
      hexToRgba,
      finish
    );
  }
}
