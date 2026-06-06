import { ProductToneData } from "@/lib/utils";

// --- Tone preset imports ---
import { renderBlush } from "@/lib/render/tonePresets/blush";
import { renderBronzer } from "@/lib/render/tonePresets/bronzer";
import { renderHighlighter } from "@/lib/render/tonePresets/highlighter";
import { renderLipGrace } from "@/lib/render/tonePresets/lips";
import { renderLipOil } from "@/lib/render/tonePresets/lipOil";

type Landmark = { x: number; y: number };
export function applyTone(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string,
  yawFade = 1,
) {
  if (!productData || !productData.display_name) return;

  const name = productData.display_name.toLowerCase();
  const type = (productData.product_type || "").toLowerCase();

  // 🧭 Detection by keywords
  const isBlush =
    name.includes("blush") || name.includes("flush") || type.includes("cheeks");
  const isBronzer =
    name.includes("bronzer") || type.includes("bronzer");
  const isHighlighter =
    name.includes("luminizer") || name.includes("highlight") || type.includes("highlighter");
  const isLipOil =
    name.includes("lip bloom") || name.includes("oil & tint") || type.includes("lip oil");
  const isLipGrace =
    !isLipOil &&
    (name.includes("lip grace") || name.includes("lipstick") || type.includes("lips_inner"));

  // 🧩 Dispatch to correct renderer
  ctx.save();
  if (isBlush) renderBlush(ctx, landmarks, productData, width, height, hexToRgba);
  else if (isBronzer) renderBronzer(ctx, landmarks, productData, width, height, hexToRgba);
  else if (isHighlighter) renderHighlighter(ctx, landmarks, productData, width, height, hexToRgba);
  else if (isLipOil) {
    renderLipOil(ctx, landmarks, productData, width, height, hexToRgba, yawFade);
  }
  else if (isLipGrace) renderLipGrace(ctx, landmarks, productData, width, height, hexToRgba);
  ctx.restore();
}
