import { ProductToneData, RegionDefinition } from "@/lib/utils";

type Landmark = { x: number; y: number };
type Point = { x: number; y: number };
type ToneSettings = { brightness: number; gloss: number };
type LipBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lipWidth: number;
  lipHeight: number;
  lipCenterX: number;
  upperLipY: number;
  lowerLipY: number;
};

const DEFAULT_TONE_SETTINGS: ToneSettings = { brightness: 1, gloss: 0.4 };

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

const getPolygonCenter = (points: Point[]): Point => {
  if (!points.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
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

function isVinylClearcoatEnabled() {
  if (typeof window === "undefined") return true;
  const flag = (window as any).__IDONY_LIPOIL_VINYL__;
  if (flag === undefined || flag === null) return true;
  if (typeof flag === "boolean") return flag;
  const normalized = String(flag).trim().toLowerCase();
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}

function drawSpecBlob(
  ctx: CanvasRenderingContext2D,
  lipFillPath: Path2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  blurPx: number
) {
  const spot = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
  // Warm highlight looks like clearcoat; pure white looked like a painted line.
  spot.addColorStop(0, "rgba(255,246,238,0.95)");
  spot.addColorStop(0.35, "rgba(255,241,230,0.42)");
  spot.addColorStop(1, "transparent");

  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "screen";
  ctx.filter = `blur(${Math.max(0.8, blurPx)}px)`;
  ctx.globalAlpha = clamp01(alpha);
  ctx.fillStyle = spot;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();
}

function applyLegacyGloss(
  ctx: CanvasRenderingContext2D,
  lipFillPath: Path2D,
  lipCenterX: number,
  lipWidth: number,
  lipHeight: number,
  upperLipY: number,
  lowerLipY: number,
  glazeBlur: number,
  glossStrength: number
) {
  const upperHighlightY = upperLipY - lipHeight * 0.26 * glossStrength;
  const glossGrad = ctx.createLinearGradient(
    0,
    upperHighlightY,
    0,
    upperHighlightY + lipHeight * 0.95
  );
  glossGrad.addColorStop(0, "rgba(255,255,255,0.18)");
  glossGrad.addColorStop(0.35, "rgba(255,255,255,0.05)");
  glossGrad.addColorStop(1, "transparent");

  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "screen";
  ctx.filter = `blur(${glazeBlur}px)`;
  ctx.globalAlpha = glossStrength * 0.82;
  ctx.fillStyle = glossGrad;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  const wetSpot = ctx.createRadialGradient(
    lipCenterX,
    lowerLipY - lipHeight * 0.08,
    0,
    lipCenterX,
    lowerLipY - lipHeight * 0.08,
    lipWidth * 0.18
  );
  wetSpot.addColorStop(0, "rgba(255,255,255,0.22)");
  wetSpot.addColorStop(1, "transparent");

  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "screen";
  ctx.filter = `blur(${Math.max(1, glazeBlur * 0.6)}px)`;
  ctx.globalAlpha = glossStrength * 0.4;
  ctx.fillStyle = wetSpot;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();
}

function applyVinylClearcoat(
  ctx: CanvasRenderingContext2D,
  lipFillPath: Path2D,
  bounds: LipBounds,
  glazeBlur: number,
  glossStrength: number
) {
  const {
    minX,
    minY,
    maxX,
    maxY,
    lipWidth,
    lipHeight,
    lipCenterX,
    upperLipY,
    lowerLipY,
  } = bounds;
  const openness = clamp01(
    Math.abs(lowerLipY - upperLipY) / Math.max(1, lipHeight * 0.46)
  );
  const openDamping = 1 - openness * 0.45;

  // Clearcoat film across the whole lip, intentionally low alpha.
  const coat = ctx.createLinearGradient(0, minY, 0, maxY);
  coat.addColorStop(0, "rgba(255,244,236,0.16)");
  coat.addColorStop(0.24, "rgba(255,244,236,0.14)");
  coat.addColorStop(0.56, "rgba(255,236,226,0.07)");
  coat.addColorStop(1, "rgba(255,230,220,0.03)");
  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "soft-light";
  ctx.filter = `blur(${Math.max(0.8, glazeBlur * 0.5)}px)`;
  ctx.globalAlpha = glossStrength * 0.52 * openDamping;
  ctx.fillStyle = coat;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // Broad wet reflection centered on the lip mass (not corners).
  const broadY = upperLipY + lipHeight * 0.3;
  const broad = ctx.createRadialGradient(
    lipCenterX,
    broadY,
    0,
    lipCenterX,
    broadY,
    lipWidth * 0.58
  );
  broad.addColorStop(0, "rgba(255,248,242,0.22)");
  broad.addColorStop(0.45, "rgba(255,241,232,0.1)");
  broad.addColorStop(1, "transparent");
  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "screen";
  ctx.filter = `blur(${Math.max(1, glazeBlur * 1.05)}px)`;
  ctx.globalAlpha = Math.max(0, glossStrength * (0.29 - openness * 0.16));
  ctx.fillStyle = broad;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // Specular blobs placed like real clearcoat catchlights.
  const upperBlobY = upperLipY - lipHeight * 0.1;
  const lowerBlobY = lowerLipY - lipHeight * 0.08;
  const blur = Math.max(0.9, glazeBlur * 0.72);
  drawSpecBlob(
    ctx,
    lipFillPath,
    lipCenterX,
    upperBlobY,
    lipWidth * 0.085,
    glossStrength * 0.4 * openDamping,
    blur
  );
  drawSpecBlob(
    ctx,
    lipFillPath,
    lipCenterX - lipWidth * 0.11,
    lowerBlobY,
    lipWidth * 0.08,
    glossStrength * 0.46 * openDamping,
    blur
  );
  drawSpecBlob(
    ctx,
    lipFillPath,
    lipCenterX + lipWidth * 0.09,
    lowerBlobY + lipHeight * 0.01,
    lipWidth * 0.07,
    glossStrength * 0.34 * openDamping,
    blur
  );
}

export function renderLipOil(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  if (!productData?.regions?.lips_outer || !productData?.regions?.lips_inner) return;

  const outer = normalizeRegion(productData.regions["lips_outer"]);
  const inner = normalizeRegion(productData.regions["lips_inner"]);

  // --- Per-tone tuning ---
  const toneMap: Record<string, { brightness: number; gloss: number }> = {
    "Lip Bloom Oil & Tint - Ruby Vice": { brightness: 0.98, gloss: 0.36 },
    "Lip Bloom Oil & Tint - Clover Club": { brightness: 0.95, gloss: 0.33 },
    "Lip Bloom Oil & Tint - Barbados": { brightness: 0.92, gloss: 0.3 },
  };
  const toneSettings = toneMap[productData.display_name || ""] || DEFAULT_TONE_SETTINGS;

  const colorDeposit = hexToRgba(
    productData.color,
    Math.min(1, productData.opacity * 1.22)
  );
  const colorBlend = hexToRgba(
    productData.color,
    Math.min(1, productData.opacity * 1.05)
  );

  // --- Build outer & inner paths ---
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

  const lipWidth = Math.max(1, maxX - minX);
  const lipHeight = Math.max(1, maxY - minY);
  const lipCenterX = (minX + maxX) / 2;
  const upper13 = toPoint(landmarks, 13, width, height);
  const lower14 = toPoint(landmarks, 14, width, height);
  if (!upper13 || !lower14) return;
  const upperLipY = upper13.y;
  const lowerLipY = lower14.y;
  const lipCenterY = (minY + maxY) / 2;
  const lipCenter = { x: lipCenterX, y: lipCenterY };
  const mouthGapPx = Math.abs(lowerLipY - upperLipY);
  const openness = clamp01(mouthGapPx / Math.max(1, lipHeight * 0.52));
  const baseBlurRaw = Math.max(1.0, Math.min(2.0, lipWidth * 0.016));
  const glazeBlurRaw = Math.max(1.8, Math.min(4.2, lipWidth * 0.03));
  const blurDamping = 1 - openness * 0.5;
  const baseBlur = Math.max(0.65, baseBlurRaw * blurDamping);
  const glazeBlur = Math.max(1.0, glazeBlurRaw * (1 - openness * 0.58));

  // Slightly expand outer contour so color reaches full visible vermilion edge.
  const outerExpandPx = Math.max(0.8, Math.min(1.8, lipWidth * 0.009));
  const expandedOuterPoints = outerPoints.map((p) => {
    const dx = p.x - lipCenter.x;
    const dy = p.y - lipCenter.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: p.x + (dx / len) * outerExpandPx,
      y: p.y + (dy / len) * outerExpandPx,
    };
  });

  // Single mask for all passes: outer lip minus mouth cavity.
  const lipMask = new Path2D();
  lipMask.addPath(buildClosedPath(expandedOuterPoints));

  const shouldCutMouthCavity = mouthGapPx > lipHeight * 0.06;
  if (shouldCutMouthCavity && innerPoints.length >= 3) {
    const innerCenter = getPolygonCenter(innerPoints);
    const openT = clamp01((openness - 0.08) / 0.92);
    // Aggressive cavity expansion removes inner-mouth veil/fog on open mouth frames.
    const cavityScaleX = Math.min(1.42, 1.08 + openT * 0.24);
    const cavityScaleY = Math.min(1.66, 1.18 + openT * 0.42);
    const cavity = scaleFromCenterXY(
      innerPoints,
      innerCenter,
      cavityScaleX,
      cavityScaleY
    );
    lipMask.addPath(buildClosedPath(cavity));
  }

  const lipBounds: LipBounds = {
    minX,
    minY,
    maxX,
    maxY,
    lipWidth,
    lipHeight,
    lipCenterX,
    upperLipY,
    lowerLipY,
  };

  // --- 1️⃣ Base layers: preserve natural lip shading (avoid flat neon paint) ---
  ctx.save();
  ctx.clip(lipMask, "evenodd");
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.9;
  ctx.filter = `blur(${baseBlur}px)`;
  ctx.fillStyle = colorDeposit;
  ctx.fill(lipMask, "evenodd");
  ctx.restore();

  ctx.save();
  ctx.clip(lipMask, "evenodd");
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.3;
  ctx.filter = `blur(${baseBlur}px)`;
  ctx.fillStyle = colorBlend;
  ctx.fill(lipMask, "evenodd");
  ctx.restore();

  // --- 2️⃣ Lip depth map: keep contour darker and center slightly brighter ---
  const depthGrad = ctx.createLinearGradient(minX, 0, maxX, 0);
  depthGrad.addColorStop(0, "rgba(0,0,0,0.12)");
  depthGrad.addColorStop(0.18, "rgba(0,0,0,0.03)");
  depthGrad.addColorStop(0.5, "rgba(255,255,255,0.08)");
  depthGrad.addColorStop(0.82, "rgba(0,0,0,0.03)");
  depthGrad.addColorStop(1, "rgba(0,0,0,0.12)");

  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = depthGrad;
  ctx.fill(lipMask, "evenodd");
  ctx.restore();

  // --- 3️⃣ Brightness correction (simulate undertone reflection) ---
  ctx.save();
  ctx.clip(lipMask, "evenodd");
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.038 * toneSettings.brightness;
  const brightGrad = ctx.createRadialGradient(
    lipCenterX,
    (upperLipY + lowerLipY) / 2,
    0,
    lipCenterX,
    (upperLipY + lowerLipY) / 2,
    lipWidth * 0.62
  );
  brightGrad.addColorStop(0, "rgba(255,255,255,0.08)");
  brightGrad.addColorStop(1, "transparent");
  ctx.fillStyle = brightGrad;
  ctx.fill(lipMask, "evenodd");
  ctx.restore();

  // --- 4️⃣ Gloss layer ---
  // Disable gloss quickly as mouth opens to prevent inner-mouth fog.
  const glossOpenFade =
    openness <= 0.08 ? 1 : Math.max(0, 1 - (openness - 0.08) / 0.16);
  const effectiveGloss = toneSettings.gloss * glossOpenFade;
  if (effectiveGloss > 0.01 && isVinylClearcoatEnabled()) {
    applyVinylClearcoat(
      ctx,
      lipMask,
      lipBounds,
      glazeBlur,
      effectiveGloss
    );
  } else if (effectiveGloss > 0.01) {
    applyLegacyGloss(
      ctx,
      lipMask,
      lipCenterX,
      lipWidth,
      lipHeight,
      upperLipY,
      lowerLipY,
      glazeBlur,
      effectiveGloss
    );
  }

  // --- 5️⃣ Final soft overlay for natural blending ---
  ctx.save();
  ctx.clip(lipMask, "evenodd");
  ctx.globalCompositeOperation = "soft-light";
  ctx.filter = `blur(${Math.max(0.8, baseBlur * 1.25)}px)`;
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = colorBlend;
  ctx.fill(lipMask, "evenodd");
  ctx.restore();
}
