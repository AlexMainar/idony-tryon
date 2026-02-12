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
    "Lip Bloom Oil & Tint - Ruby Vice": { brightness: 1.0, gloss: 0.62 },
    "Lip Bloom Oil & Tint - Clover Club": { brightness: 1.0, gloss: 0.58 },
    "Lip Bloom Oil & Tint - Barbados": { brightness: 0.92, gloss: 0.54 },
  };
  const toneSettings =
    toneMap[productData.display_name || ""] || { brightness: 1, gloss: 0.4 };

  const colorDeposit = hexToRgba(
    productData.color,
    Math.min(1, productData.opacity * 1.08)
  );
  const colorBlend = hexToRgba(
    productData.color,
    Math.min(1, productData.opacity * 0.95)
  );

  // --- Build outer & inner paths ---
  const outerPath = new Path2D();
  outer.forEach((i, idx) => {
    const p = landmarks[i];
    const x = p.x * width;
    const y = p.y * height;
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

  // --- 1️⃣ Base layers: stronger pigment + natural blend ---
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "blur(1.5px)";
  ctx.fillStyle = colorDeposit;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.9;
  ctx.filter = "blur(1.5px)";
  ctx.fillStyle = colorBlend;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // --- 2️⃣ Brightness correction (simulate undertone reflection) ---
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.11 * toneSettings.brightness;
  const brightGrad = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    250
  );
  brightGrad.addColorStop(0, "rgba(255,255,255,0.25)");
  brightGrad.addColorStop(1, "transparent");
  ctx.fillStyle = brightGrad;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // --- 3️⃣ Gloss layer: upper-lip highlight ---
  const upperHighlightY =
    landmarks[13].y * height - (height * 0.015 * toneSettings.gloss);
  const glossGrad = ctx.createLinearGradient(0, upperHighlightY, 0, upperHighlightY + 80);
  glossGrad.addColorStop(0, "rgba(255,255,255,0.35)");
  glossGrad.addColorStop(0.4, "rgba(255,255,255,0.15)");
  glossGrad.addColorStop(1, "transparent");

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.filter = "blur(6px)";
  ctx.globalAlpha = toneSettings.gloss;
  ctx.fillStyle = glossGrad;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();

  // --- 4️⃣ Final soft overlay for natural blending ---
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.filter = "blur(2px)";
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = colorBlend;
  ctx.fill(lipFillPath, "evenodd");
  ctx.restore();
}
