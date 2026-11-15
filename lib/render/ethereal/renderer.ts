import type { ProductToneData } from "@/lib/utils";
import type { RenderLandmark } from "@/lib/render/landmarks";
import type { EtherealLight } from "./lighting";
import type { EtherealSurfaceState } from "./tracking";
import { createEtherealFilmRenderer } from "./filmRenderer";
import { createEtherealSurfaceRenderer } from "./surfaceRenderer";
export { ETHEREAL_FILM_REVISION } from "./filmRenderer";
export { ETHEREAL_RENDER_REVISION } from "./surfaceRenderer";
export type { EtherealSurfaceState } from "./tracking";
export type EtherealMaterial = "surface" | "film";
export const isEtherealProduct = (tone: ProductToneData | null | undefined) =>
  tone?.optical_profile?.finish === "pearlescent_highlighter" ||
  !!tone?.display_name?.toLowerCase().includes("ethereal");

export type EtherealDrawOptions = {
  source: HTMLCanvasElement;
  landmarks: RenderLandmark[] | null;
  product: ProductToneData;
  exposureGain: number;
  enabled: boolean;
  frozen: boolean;
  timestampMs: number;
  lightingOverride?: EtherealLight;
  surfaceOverride?: EtherealSurfaceState;
};


export function createEtherealRenderer(material:EtherealMaterial="surface"){
  return material==="film"?createEtherealFilmRenderer():createEtherealSurfaceRenderer();
}
export type EtherealRenderer=ReturnType<typeof createEtherealRenderer>;
