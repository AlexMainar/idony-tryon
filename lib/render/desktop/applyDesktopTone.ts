import { ProductToneData } from "@/lib/utils";

import {
  applyDesktopComplexionTone,
  shouldUseDirectCheekDebugRender,
} from "@/lib/render/desktop/applyDesktopComplexionTone";
import { applyDesktopLipTone } from "@/lib/render/desktop/applyDesktopLipTone";
import {
  getDesktopToneKind,
  isDesktopComplexionToneKind,
  isDesktopLipToneKind,
} from "@/lib/render/desktop/toneKind";

type Landmark = { x: number; y: number };

export { shouldUseDirectCheekDebugRender };

export function applyDesktopTone(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string,
  yawFade = 1
) {
  const kind = getDesktopToneKind(productData);
  if (!kind) return;

  ctx.save();
  if (isDesktopComplexionToneKind(kind)) {
    applyDesktopComplexionTone(ctx, landmarks, productData, kind, width, height, hexToRgba);
  } else if (isDesktopLipToneKind(kind)) {
    applyDesktopLipTone(ctx, landmarks, productData, kind, width, height, hexToRgba, yawFade);
  }
  ctx.restore();
}
