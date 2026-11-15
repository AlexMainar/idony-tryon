import type { ProductToneData } from "@/lib/utils";
import type { RenderLandmark } from "@/lib/render/landmarks";
import type { EtherealRenderer, EtherealDrawOptions } from "@/lib/render/ethereal/renderer";
import type { EtherealLight } from "@/lib/render/ethereal/lighting";

export type EtherealFrame = Omit<EtherealDrawOptions, "landmarks" | "product"> & {
  renderer: EtherealRenderer;
  onRendered?: (light: EtherealLight) => void;
};

export function applyMobileEtherealTone(
  ctx: CanvasRenderingContext2D,
  landmarks: RenderLandmark[],
  product: ProductToneData,
  frame?: EtherealFrame,
) {
  if (!frame) throw new Error("El renderer de superficie de Ethereal todavía no está preparado.");
  const { renderer, onRendered, ...options } = frame;
  const light = renderer.draw(ctx, { ...options, landmarks: landmarks.length ? landmarks : null, product });
  onRendered?.(light);
  return true;
}
