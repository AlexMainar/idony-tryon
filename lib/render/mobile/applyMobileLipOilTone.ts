import type { ProductToneData } from "@/lib/utils";
import type { LipPoint } from "@/lib/render/lipOil/deformGeometry";
import { createLipOilRenderer } from "@/lib/render/lipOil/renderer";
import { createMobileLipTracker } from "./lipTracker";
import { lipOilTones } from "@/lib/render/lipOil/tones";

export function getLipOilColor(productData: ProductToneData) {
  const name = productData.display_name.toLowerCase().trim();
  const tone = lipOilTones.find(t => name.endsWith(t.display_name.split(" - ")[1].toLowerCase()));
  if (!tone) throw new Error(`Tono Lip Bloom no reconocido: ${productData.display_name}`);
  return tone.color;
}

/** Owned by a camera session: no GPU/context or tracking state leaks between products. */
export async function createMobileLipOilRenderer() {
  const THREE = await import("three");
  const surface = createLipOilRenderer(THREE);
  const tracker = createMobileLipTracker();
  return {
    track(ctx: CanvasRenderingContext2D, points: LipPoint[] | null, width: number, height: number, time: number) {
      return tracker.update(ctx, points, width, height, time);
    },
    draw(ctx: CanvasRenderingContext2D, points: LipPoint[], productData: ProductToneData, width: number, height: number) {
      // Copy the same frame into Three before writing its complete result back.
      // Pigment + coating + texture are the approved lab material, with no 2D pass.
      surface.draw(ctx, ctx.canvas, points, width, height, getLipOilColor(productData));
    },
    dispose() { tracker.reset(); surface.dispose(); },
  };
}
export type MobileLipOilRenderer = Awaited<ReturnType<typeof createMobileLipOilRenderer>>;

export function applyMobileLipOilTone(
  ctx: CanvasRenderingContext2D, landmarks: LipPoint[], productData: ProductToneData,
  width: number, height: number, _hexToRgba: (hex: string, opacity: number) => string,
  _yawFade = 1, renderer?: MobileLipOilRenderer,
) {
  if (!renderer) throw new Error("El material 3D de Lip Bloom todavía no está preparado.");
  renderer.draw(ctx, landmarks, productData, width, height);
  return true;
}
