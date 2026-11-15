import { ProductToneData } from "@/lib/utils";

import { renderLipGrace } from "@/lib/render/tonePresets/lips";
import { renderLipOil } from "@/lib/render/tonePresets/lipOil";

import { DesktopLipToneKind } from "@/lib/render/desktop/toneKind";

type Landmark = { x: number; y: number };

export function applyDesktopLipTone(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  kind: DesktopLipToneKind,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string,
  yawFade = 1
) {
  if (kind === "lipOil") {
    renderLipOil(ctx, landmarks, productData, width, height, hexToRgba, yawFade);
    return;
  }

  renderLipGrace(ctx, landmarks, productData, width, height, hexToRgba);
}
