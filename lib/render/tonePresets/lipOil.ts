import { ProductToneData } from "@/lib/utils";

type Landmark = { x: number; y: number };

export function renderLipOil(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  if (!productData?.regions?.lips_outer || !productData?.regions?.lips_inner) return;

  const outer = productData.regions["lips_outer"];
  const inner = productData.regions["lips_inner"];

  // --- Per-tone tuning ---
  const toneMap: Record<string, { brightness: number; gloss: number }> = {
    "Lip Bloom Oil & Tint - Ruby Vice": { brightness: 0.98, gloss: 0.36 },
    "Lip Bloom Oil & Tint - Clover Club": { brightness: 0.95, gloss: 0.33 },
    "Lip Bloom Oil & Tint - Barbados": { brightness: 0.92, gloss: 0.3 },
  };
  const toneSettings =
    toneMap[productData.display_name || ""] || { brightness: 1, gloss: 0.4 };

  const colorDeposit = hexToRgba(
    productData.color,
    Math.min(1, productData.opacity * 1.22)
  );
  const colorBlend = hexToRgba(
    productData.color,
    Math.min(1, productData.opacity * 1.05)
  );

  // --- Build outer & inner paths ---
  const outerPath = new Path2D();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  outer.forEach((i, idx) => {
    const p = landmarks[i];
    const x = p.x * width;
    const y = p.y * height;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (idx === 0) outerPath.moveTo(x, y);
    else outerPath.lineTo(x, y);
  });
  outerPath.closePath();

  const innerPath = new Path2D();
  inner.forEach((i, idx) => {
    const p = landmarks[i];
    const x = p.x * width;
    const y = p.y * height;
    if (idx === 0) innerPath.moveTo(x, y);
    else innerPath.lineTo(x, y);
  });
  innerPath.closePath();

  // Build a single even-odd path so inner mouth is excluded without punching transparency
  const lipFillPath = new Path2D();
  lipFillPath.addPath(outerPath);
  lipFillPath.addPath(innerPath);

  const lipWidth = Math.max(1, maxX - minX);
  const lipHeight = Math.max(1, maxY - minY);
  const lipCenterX = (minX + maxX) / 2;
  const upperLipY = landmarks[13].y * height;
  const lowerLipY = landmarks[14].y * height;
  const baseBlur = Math.max(1.0, Math.min(2.0, lipWidth * 0.016));
  const glazeBlur = Math.max(1.8, Math.min(4.2, lipWidth * 0.03));

  // --- 1️⃣ Base layers: preserve natural lip shading (avoid flat neon paint) ---
  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.9;
  ctx.filter = `blur(${baseBlur}px)`;
  ctx.fillStyle = colorDeposit;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.3;
  ctx.filter = `blur(${baseBlur}px)`;
  ctx.fillStyle = colorBlend;
  ctx.fill(lipFillPath, "evenodd");
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
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // --- 3️⃣ Brightness correction (simulate undertone reflection) ---
  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
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
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // --- 4️⃣ Gloss layer: tight directional highlights (less hologram) ---
  const upperHighlightY =
    upperLipY - (lipHeight * 0.26 * toneSettings.gloss);
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
  ctx.globalAlpha = toneSettings.gloss * 0.82;
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
  ctx.globalAlpha = toneSettings.gloss * 0.4;
  ctx.fillStyle = wetSpot;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // --- 5️⃣ Final soft overlay for natural blending ---
  ctx.save();
  ctx.clip(lipFillPath, "evenodd");
  ctx.globalCompositeOperation = "soft-light";
  ctx.filter = `blur(${Math.max(0.8, baseBlur * 1.25)}px)`;
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = colorBlend;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();
}
