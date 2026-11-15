import type { ProductToneData } from "@/lib/utils";
import type { RenderLandmark } from "@/lib/render/landmarks";
import { applyMobileTone } from "@/lib/render/mobile/applyMobileTone";
import type { MobileLipOilRenderer } from "@/lib/render/mobile/applyMobileLipOilTone";
import type { EtherealFrame } from "@/lib/render/mobile/applyMobileEtherealTone";

// Legacy direct-canvas debug paths must not bypass the unified frame pipeline.
export const shouldUseDirectCheekDebugRender = (_productData: ProductToneData) => false;

export function applyTone(
  ctx: CanvasRenderingContext2D, landmarks: RenderLandmark[], productData: ProductToneData,
  width: number, height: number, hexToRgba: (hex: string, opacity: number) => string,
  yawFade = 1, lipOil?: MobileLipOilRenderer, ethereal?: EtherealFrame,
) {
  return applyMobileTone(ctx, landmarks, productData, width, height, hexToRgba, yawFade, lipOil, ethereal);
}
