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

const AREA_STYLES: Record<string, AreaStyle> = {
  nose_tip: {
    tintOpacity: 0.16,
    pearlOpacity: 0.3,
    sheenOpacity: 0.18,
    sparkleOpacity: 0.24,
    tintBlur: 6,
    pearlBlur: 5.6,
    sheenBlur: 4.2,
    sparkleBlur: 3.2,
    pearlRadiusX: 1.18,
    pearlRadiusY: 1.14,
    shiftX: 0,
    shiftY: 0.02,
  },
  cupid_bow: {
    tintOpacity: 0.12,
    pearlOpacity: 0.36,
    sheenOpacity: 0.14,
    sparkleOpacity: 0.2,
    tintBlur: 2.4,
    pearlBlur: 2.1,
    sheenBlur: 1.8,
    sparkleBlur: 1.4,
    pearlRadiusX: 1.02,
    pearlRadiusY: 0.86,
    shiftX: 0,
    shiftY: 0.16,
  },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
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

const ETHEREAL_CHEEK_BAND = {
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

// Precomputed from MediaPipe tessellation; keeping only the cheek-band triangles
// avoids importing the package into the Next/Turbopack render path.
const ETHEREAL_CHEEK_TRIANGLES: [number, number, number][] = [
  [50, 101, 118],
  [118, 229, 230],
  [50, 187, 205],
  [119, 120, 230],
  [111, 117, 123],
  [123, 147, 187],
  [100, 101, 120],
  [35, 111, 143],
  [50, 117, 123],
  [50, 101, 205],
  [101, 118, 119],
  [118, 119, 230],
  [31, 111, 117],
  [111, 116, 123],
  [36, 100, 101],
  [50, 123, 187],
  [101, 119, 120],
  [117, 118, 229],
  [111, 116, 143],
  [50, 117, 118],
  [36, 101, 205],
  [123, 147, 177],
  [330, 347, 348],
  [347, 348, 450],
  [261, 340, 346],
  [340, 345, 352],
  [266, 329, 330],
  [280, 352, 411],
  [330, 348, 349],
  [346, 347, 449],
  [340, 345, 372],
  [280, 346, 347],
  [266, 330, 425],
  [352, 376, 401],
  [280, 330, 347],
  [347, 449, 450],
  [280, 411, 425],
  [348, 349, 450],
  [340, 346, 352],
  [352, 376, 411],
  [329, 330, 349],
  [265, 340, 372],
  [280, 346, 352],
  [280, 330, 425],
];

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

const pointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-6) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
};

const projectPointToSegment = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const segmentLengthSq = dx * dx + dy * dy;

  if (segmentLengthSq <= 1e-6) {
    return { distance: getDistance(point, start), ratio: 0, projected: start };
  }

  const rawRatio =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / segmentLengthSq;
  const ratio = clamp01(rawRatio);
  const projected = {
    x: start.x + dx * ratio,
    y: start.y + dy * ratio,
  };

  return {
    distance: getDistance(point, projected),
    ratio,
    projected,
  };
};

const distanceToPolygonEdge = (point: Point, polygon: Point[]) => {
  if (polygon.length < 2) return Number.POSITIVE_INFINITY;

  let minDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const projection = projectPointToSegment(point, start, end);
    minDistance = Math.min(minDistance, projection.distance);
  }

  return minDistance;
};

const projectPointToPolyline = (point: Point, polyline: Point[]) => {
  if (polyline.length < 2) return { distance: Number.POSITIVE_INFINITY, t: 0 };

  const segmentLengths: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const length = getDistance(polyline[i], polyline[i + 1]);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength <= 1e-6) return { distance: Number.POSITIVE_INFINITY, t: 0 };

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestT = 0;
  let traversed = 0;

  for (let i = 0; i < polyline.length - 1; i += 1) {
    const length = segmentLengths[i];
    if (length <= 1e-6) continue;

    const projection = projectPointToSegment(point, polyline[i], polyline[i + 1]);
    if (projection.distance < bestDistance) {
      bestDistance = projection.distance;
      bestT = (traversed + length * projection.ratio) / totalLength;
    }

    traversed += length;
  }

  return { distance: bestDistance, t: bestT };
};

const buildCheekBand = (
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
  const polygon = [...upper, ...alignedLower.slice().reverse(), ...outerBridge];
  if (polygon.length < 4) return null;

  const ridgeSamples = Math.max(upper.length, alignedLower.length, 6);
  const bodyLine: Point[] = [];
  const ridgeLine: Point[] = [];
  let bandDepthSum = 0;

  for (let i = 0; i < ridgeSamples; i += 1) {
    const t = ridgeSamples === 1 ? 0 : i / (ridgeSamples - 1);
    const upperPoint = samplePointOnLine(upper, t);
    const lowerPoint = samplePointOnLine(alignedLower, t);
    if (!upperPoint || !lowerPoint) continue;

    bandDepthSum += getDistance(upperPoint, lowerPoint);
    bodyLine.push({
      x: lerp(upperPoint.x, lowerPoint.x, 0.44),
      y: lerp(upperPoint.y, lowerPoint.y, 0.44),
    });
    ridgeLine.push({
      x: lerp(upperPoint.x, lowerPoint.x, 0.2),
      y: lerp(upperPoint.y, lowerPoint.y, 0.2),
    });
  }

  if (bodyLine.length < 2 || ridgeLine.length < 2) return null;

  return {
    polygon,
    bodyLine,
    ridgeLine,
    averageDepth: bandDepthSum / bodyLine.length,
  };
};

function drawEtherealCheekboneDiagnostic(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  productColor: string,
  baseOpacity: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  if (!leftTemple || !rightTemple) return;

  const faceWidth = Math.max(1, Math.abs(rightTemple.x - leftTemple.x) * width);
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const offscreenCtx = offscreen.getContext("2d");
  if (!offscreenCtx) return;

  const gaussian = (distance: number, sigma: number) =>
    Math.exp(-(distance * distance) / (2 * sigma * sigma));

  const warmBase = mixHexColors(productColor, "#ca9872", 0.30);
  const warmBody = mixHexColors(productColor, "#ddb18f", 0.2);
  const pearlSoft = mixHexColors(productColor, "#e5c4aa", 0.16);
  const pearlCore = mixHexColors(productColor, "#ecd0b7", 0.14);

  const drawCheekBand = (
    upperIndices: readonly number[],
    lowerIndices: readonly number[],
    outerBridgeIndices: readonly number[]
  ) => {
    const band = buildCheekBand(
      upperIndices,
      lowerIndices,
      outerBridgeIndices,
      landmarks,
      width,
      height
    );
    if (!band) return;

    const drawTriangleLayer = ({
      targetLine,
      sigma,
      blur,
      composite,
      layerColor,
      layerOpacity,
      alongFloor,
      alongPower,
      outerBias,
      cutoff,
      edgeFeather,
    }: {
      targetLine: Point[];
      sigma: number;
      blur: number;
      composite: GlobalCompositeOperation;
      layerColor: string;
      layerOpacity: number;
      alongFloor: number;
      alongPower: number;
      outerBias: number;
      cutoff: number;
      edgeFeather: number;
    }) => {
      offscreenCtx.clearRect(0, 0, width, height);

      for (const [a, b, c] of ETHEREAL_CHEEK_TRIANGLES) {
        const la = landmarks[a];
        const lb = landmarks[b];
        const lc = landmarks[c];
        if (!la || !lb || !lc) continue;

        const p1 = { x: la.x * width, y: la.y * height };
        const p2 = { x: lb.x * width, y: lb.y * height };
        const p3 = { x: lc.x * width, y: lc.y * height };
        const centroid = {
          x: (p1.x + p2.x + p3.x) / 3,
          y: (p1.y + p2.y + p3.y) / 3,
        };

        if (!pointInPolygon(centroid, band.polygon)) continue;

        const projection = projectPointToPolyline(centroid, targetLine);
        const distanceWeight = gaussian(projection.distance, sigma);
        const arcWeight = Math.pow(Math.sin(Math.PI * clamp01(projection.t)), alongPower);
        const alongWeight = lerp(alongFloor, 1, arcWeight);
        const outerLift = lerp(1 - outerBias, 1 + outerBias, projection.t);
        const edgeDistance = distanceToPolygonEdge(centroid, band.polygon);
        const edgeWeight = smoothstep(
          0,
          Math.max(1, band.averageDepth * edgeFeather),
          edgeDistance
        );
        const weight = distanceWeight * alongWeight * outerLift * edgeWeight;

        if (weight < cutoff) continue;

        offscreenCtx.beginPath();
        offscreenCtx.moveTo(p1.x, p1.y);
        offscreenCtx.lineTo(p2.x, p2.y);
        offscreenCtx.lineTo(p3.x, p3.y);
        offscreenCtx.closePath();
        offscreenCtx.fillStyle = hexToRgba(layerColor, clamp01(layerOpacity * weight));
        offscreenCtx.fill();
      }

      ctx.save();
      ctx.globalCompositeOperation = composite;
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();
    };

    drawTriangleLayer({
      targetLine: band.bodyLine,
      sigma: Math.max(faceWidth * 0.1, band.averageDepth * 1.9),
      blur: Math.max(12, band.averageDepth * 0.9),
      composite: "multiply",
      layerColor: warmBase,
      layerOpacity: baseOpacity * 0.9,
      alongFloor: 0.82,
      alongPower: 0.66,
      outerBias: 0.5,
      cutoff: 0.004,
      edgeFeather: 0.9,
    });

    drawTriangleLayer({
      targetLine: band.bodyLine,
      sigma: Math.max(faceWidth * 0.046, band.averageDepth * 1.02),
      blur: Math.max(9, band.averageDepth * 0.9),
      composite: "soft-light",
      layerColor: warmBody,
      layerOpacity: baseOpacity * 0.9,
      alongFloor: 0.66,
      alongPower: 0.78,
      outerBias: 0.04,
      cutoff: 0.007,
      edgeFeather: 0.72,
    });

    drawTriangleLayer({
      targetLine: band.bodyLine,
      sigma: Math.max(faceWidth * 0.036, band.averageDepth * 0.8),
      blur: Math.max(7, band.averageDepth * 0.28),
      composite: "screen",
      layerColor: pearlSoft,
      layerOpacity: baseOpacity * 0.21,
      alongFloor: 0.56,
      alongPower: 0.9,
      outerBias: 0.04,
      cutoff: 0.008,
      edgeFeather: 0.56,
    });

    drawTriangleLayer({
      targetLine: band.ridgeLine,
      sigma: Math.max(faceWidth * 0.014, band.averageDepth * 0.9),
      blur: Math.max(3.4, band.averageDepth * 0.5),
      composite: "screen",
      layerColor: pearlCore,
      layerOpacity: baseOpacity * 0.5,
      alongFloor: 0.5,
      alongPower: 1.12,
      outerBias: 0.05,
      cutoff: 0.016,
      edgeFeather: 0.5,
    });
  };

  drawCheekBand(
    ETHEREAL_CHEEK_BAND.left.upper,
    ETHEREAL_CHEEK_BAND.left.lower,
    ETHEREAL_CHEEK_BAND.left.outerBridge
  );
  drawCheekBand(
    ETHEREAL_CHEEK_BAND.right.upper,
    ETHEREAL_CHEEK_BAND.right.lower,
    ETHEREAL_CHEEK_BAND.right.outerBridge
  );
}

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

const getPolygonsForArea = (region: RegionDefinition) => normalizeRegionPolygons(region);

export function renderHighlighter(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const baseOpacity = clamp01(Math.max(0.2, Math.min(0.8, productData.opacity || 0.4)));
  const isEthereal =
    productData.display_name?.toLowerCase().includes("ethereal") ?? false;

  // Ethereal keeps a custom cheek renderer, then falls through to JSON-driven accent regions.
  if (isEthereal && productData.regions.upper_cheeks) {
    drawEtherealCheekboneDiagnostic(
      ctx,
      landmarks,
      width,
      height,
      productData.color,
      baseOpacity,
      hexToRgba
    );
  }

  // Keep tint subtle; luminizer should read as sheen first.
  const toneBase = hexToRgba(productData.color, baseOpacity * 0.42);
  const toneMid = hexToRgba(productData.color, baseOpacity * 0.24);
  const pearlCore = hexToRgba("#fff8ef", baseOpacity * 0.95);
  const pearlMid = hexToRgba("#ffe9d7", baseOpacity * 0.62);

  const accentAreas = ["nose_tip", "cupid_bow"].filter((area) => productData.regions[area]);
  accentAreas.forEach((area) => {
    const region = productData.regions[area];
    if (!region) return;

    const polygons = getPolygonsForArea(region);
    const style = AREA_STYLES[area];
    if (!style) return;
    const useFeatheredPathFill = area === "nose_tip";

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
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = style.tintOpacity;
      ctx.filter = `blur(${style.tintBlur}px)`;
      ctx.fillStyle = tintGrad;
      if (useFeatheredPathFill) {
        ctx.fill(path);
      } else {
        ctx.clip(path);
        ctx.fillRect(minX - areaWidth, minY - areaHeight, areaWidth * 3, areaHeight * 3);
      }
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
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = style.pearlOpacity;
      ctx.filter = `blur(${style.pearlBlur}px)`;
      ctx.fillStyle = pearlGrad;
      if (useFeatheredPathFill) {
        ctx.fill(path);
      } else {
        ctx.clip(path);
        ctx.fillRect(minX - areaWidth, minY - areaHeight, areaWidth * 3, areaHeight * 3);
      }
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
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = style.sheenOpacity;
      ctx.filter = `blur(${style.sheenBlur}px)`;
      ctx.fillStyle = sweepGrad;
      if (useFeatheredPathFill) {
        ctx.fill(path);
      } else {
        ctx.clip(path);
        ctx.fillRect(
          minX - areaWidth * 0.2,
          minY - areaHeight * 0.5,
          areaWidth * 1.4,
          areaHeight * 2
        );
      }
      ctx.restore();

      // 4) One broader wet spot keeps the sheen without creating two clipped blobs.
      const spotGrad = ctx.createRadialGradient(
        liftX,
        liftY,
        0,
        liftX,
        liftY,
        Math.max(areaWidth, areaHeight) * 0.4
      );
      spotGrad.addColorStop(0, "rgba(255,250,244,0.28)");
      spotGrad.addColorStop(0.45, "rgba(255,240,228,0.12)");
      spotGrad.addColorStop(1, "transparent");

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = clamp01(style.sparkleOpacity);
      ctx.filter = `blur(${Math.max(4, style.sparkleBlur * 2)}px)`;
      ctx.fillStyle = spotGrad;
      if (useFeatheredPathFill) {
        ctx.fill(path);
      } else {
        ctx.clip(path);
        ctx.fillRect(
          minX - areaWidth * 0.5,
          minY - areaHeight * 0.7,
          areaWidth * 2,
          areaHeight * 2
        );
      }
      ctx.restore();
    });
  });
}
