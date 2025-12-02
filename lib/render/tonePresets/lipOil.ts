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
    "Lip Bloom Oil & Tint - Ruby Vice": { brightness: 1.1, gloss: 0.45 },
    "Lip Bloom Oil & Tint - Clover Club": { brightness: 1.05, gloss: 0.4 },
    "Lip Bloom Oil & Tint - Barbados": { brightness: 0.95, gloss: 0.35 },
  };
  const toneSettings =
    toneMap[productData.display_name || ""] || { brightness: 1, gloss: 0.4 };

  const color = hexToRgba(productData.color, productData.opacity * 0.85);

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

  // --- 1️⃣ Base layer: soft translucent tint ---
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.filter = "blur(2px)";
  ctx.fillStyle = color;
  ctx.fill(outerPath, "evenodd");
  ctx.restore();

  // --- 2️⃣ Brightness correction (simulate undertone reflection) ---
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.15 * toneSettings.brightness;
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
  ctx.fill(outerPath, "evenodd");
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
  ctx.fill(outerPath);
  ctx.restore();

  // --- 4️⃣ Mouth cutout ---
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,1)";
  ctx.fill(innerPath);
  ctx.restore();

  // --- 5️⃣ Final soft overlay for natural blending ---
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.filter = "blur(2px)";
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = color;
  ctx.fill(outerPath);
  ctx.restore();
}