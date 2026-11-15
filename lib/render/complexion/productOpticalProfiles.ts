import {
  ProductEtherealRenderingDefinition,
  ProductOpticalAreaRenderStyleDefinition,
  ProductOpticalFieldDefinition,
  ProductOpticalGlowDefinition,
  ProductOpticalLayerDefinition,
  ProductToneData,
} from "@/lib/utils";

export type ResolvedOpticalLayer = {
  color: string;
  strength: number;
  responseFloor?: number;
  responseInfluence?: number;
  chromaStrength?: number;
  lumaDelta?: number;
  lumaInfluence?: number;
  field?: ProductOpticalFieldDefinition;
  glow?: ProductOpticalGlowDefinition;
};

type OpticalLayerFallback = {
  color?: string;
  strength?: number;
  responseFloor?: number;
  responseInfluence?: number;
  chromaStrength?: number;
  lumaDelta?: number;
  lumaInfluence?: number;
  field?: ProductOpticalFieldDefinition;
  glow?: ProductOpticalGlowDefinition;
};

export const resolveOpticalDepositColor = (productData: ProductToneData) =>
  productData.optical_profile?.deposit_color || productData.color;

export const resolveOpticalLayer = (
  productData: ProductToneData,
  area: string,
  layer: string,
  fallback: OpticalLayerFallback
): ResolvedOpticalLayer => {
  const areaDefinition = productData.optical_profile?.areas?.[area];
  const profileLayer = areaDefinition?.[layer] as ProductOpticalLayerDefinition | undefined;
  const depositColor = resolveOpticalDepositColor(productData);

  return {
    color: profileLayer?.color || fallback.color || depositColor,
    strength: profileLayer?.strength ?? fallback.strength ?? 0,
    responseFloor: profileLayer?.response_floor ?? fallback.responseFloor,
    responseInfluence:
      profileLayer?.response_influence ?? fallback.responseInfluence,
    chromaStrength: profileLayer?.chroma_strength ?? fallback.chromaStrength,
    lumaDelta: profileLayer?.luma_delta ?? fallback.lumaDelta,
    lumaInfluence: profileLayer?.luma_influence ?? fallback.lumaInfluence,
    field: profileLayer?.field ?? fallback.field,
    glow: profileLayer?.glow ?? fallback.glow,
  };
};

export const resolveOpticalAreaRenderStyle = (
  productData: ProductToneData,
  area: string
): ProductOpticalAreaRenderStyleDefinition | undefined =>
  productData.optical_profile?.areas?.[area]?.render_style;

export const resolveEtherealRendering = (
  productData: ProductToneData
): ProductEtherealRenderingDefinition | undefined =>
  productData.optical_profile?.rendering?.ethereal;
