import { ProductToneData } from "@/lib/utils";

import { renderLipGrace } from "@/lib/render/tonePresets/lips";

type Landmark = { x: number; y: number };

// Preserve the approved Lip Grace finish on every device.
export function applyMobileLipTone(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  renderLipGrace(
    ctx,
    landmarks,
    productData,
    width,
    height,
    hexToRgba,
    true
  );
  return true;
}
