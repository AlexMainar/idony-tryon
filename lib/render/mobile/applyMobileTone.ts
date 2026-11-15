import type { ProductToneData } from "@/lib/utils";
import type { RenderLandmark } from "@/lib/render/landmarks";
import { applyMobileComplexionTone, isMobileComplexionProduct } from "./applyMobileComplexionTone";
import { applyMobileLipTone } from "./applyMobileLipTone";
import { applyMobileLipOilTone, type MobileLipOilRenderer } from "./applyMobileLipOilTone";
import { applyMobileEtherealTone, type EtherealFrame } from "./applyMobileEtherealTone";
import { isEtherealProduct } from "@/lib/render/ethereal/renderer";

/** One pipeline on touch, mouse, Safari, Firefox and Chromium alike. */
export const shouldUseMobileTonePipeline = () => true;

export function applyMobileTone(
  ctx: CanvasRenderingContext2D, landmarks: RenderLandmark[], productData: ProductToneData,
  width: number, height: number, hexToRgba: (hex: string, opacity: number) => string,
  yawFade = 1, lipOil?: MobileLipOilRenderer, ethereal?: EtherealFrame,
) {
  if (!productData?.display_name) return false;
  const name = productData.display_name.toLowerCase();
  const type = (productData.product_type || "").toLowerCase();
  ctx.save();
  try {
    if (isEtherealProduct(productData)) {
      return applyMobileEtherealTone(ctx, landmarks, productData, ethereal);
    }
    if (isMobileComplexionProduct(productData)) {
      return applyMobileComplexionTone(ctx, landmarks, productData, width, height, hexToRgba);
    }
    // Oil takes precedence over generic lip metadata.
    if (name.includes("lip bloom") || name.includes("oil & tint") || type.includes("lip oil")) {
      return applyMobileLipOilTone(ctx, landmarks, productData, width, height, hexToRgba, yawFade, lipOil);
    }
    if (name.includes("lip grace") || name.includes("lipstick") || type.includes("lips_inner")) {
      return applyMobileLipTone(ctx, landmarks, productData, width, height, hexToRgba);
    }
    return false;
  } finally { ctx.restore(); }
}
