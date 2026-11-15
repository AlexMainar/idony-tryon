export type RegionDefinition = number[] | number[][];

export interface ProductOpticalFieldSampleDefinition {
  t: number;
  weight?: number;
}

export interface ProductOpticalFieldDefinition {
  line?: "body" | "ridge";
  samples?: ProductOpticalFieldSampleDefinition[];
  strength_multiplier?: number;
  radius_x_scale?: number;
  depth_radius_x_scale?: number;
  radius_y_scale?: number;
  lower_radius_y_scale?: number;
  radius_scale?: number;
  center_x_mix?: number;
  center_y_mix?: number;
  rotation?: number;
}

export interface ProductOpticalGlowDefinition {
  glow_strength?: number;
  tint_strength?: number;
  highlight_response?: number;
}

export interface ProductHighlighterRenderingDefinition extends ProductOpticalGlowDefinition {
  opacity_reference?: number;
  opacity_scale_min?: number;
  opacity_scale_max?: number;
  max_luma_lift?: number;
  core_max_luma_lift?: number;
  skin_integration?: number;
}

export interface ProductOpticalAreaRenderStyleDefinition {
  tint_blur?: number;
  pearl_blur?: number;
  sheen_blur?: number;
  sparkle_blur?: number;
  pearl_radius_x?: number;
  pearl_radius_y?: number;
  shift_x?: number;
  shift_y?: number;
  deposit_compact_scale?: number;
}

export interface ProductEtherealAreaBandDefinition {
  sample_points?: number[];
  body_mix?: number;
  ridge_mix_start?: number;
  ridge_mix_end?: number;
  min_depth_px?: number;
  area_depth_scale?: number;
  chain_depth_scale?: number;
  upper_offset_scale?: number;
  lower_offset_scale?: number;
  clip_feather_scale?: number;
}

export interface ProductEtherealFallbackBandPointDefinition {
  t: number;
  y_offset_scale?: number;
}

export interface ProductEtherealFallbackBandDefinition {
  inner_limit_scale?: number;
  outer_x_mix?: number;
  outer_y_mix?: number;
  cheek_base_mix?: number;
  support_cheek_mix?: number;
  inner_mix?: number;
  inner_y_offset_scale?: number;
  outer_lift_scale?: number;
  ridge_points?: ProductEtherealFallbackBandPointDefinition[];
  min_depth_px?: number;
  depth_face_scale?: number;
  depth_line_scale?: number;
  upper_offset_scale?: number;
  lower_offset_scale?: number;
  body_offset_scale?: number;
}

export interface ProductEtherealSideLandmarksDefinition {
  left?: number;
  right?: number;
}

export interface ProductEtherealCheekboneEllipseDefinition {
  outer_eye?: ProductEtherealSideLandmarksDefinition;
  temple_cheek?: ProductEtherealSideLandmarksDefinition;
  inner_cheek?: ProductEtherealSideLandmarksDefinition;
  support_cheek?: ProductEtherealSideLandmarksDefinition;
  sample_points?: number[];
  outer_mix?: number;
  inner_support_mix?: number;
  inner_mix?: number;
  outer_shift_x_scale?: number;
  outer_shift_y_scale?: number;
  inner_shift_x_scale?: number;
  inner_shift_y_scale?: number;
  center_y_shift_scale?: number;
  ridge_y_offset_scale?: number;
  body_y_offset_scale?: number;
  radius_x_scale?: number;
  radius_y_face_scale?: number;
  min_radius_x_px?: number;
  min_radius_y_px?: number;
  clip_feather_scale?: number;
}

export interface ProductEtherealRenderingDefinition {
  base_opacity_min?: number;
  base_opacity_max?: number;
  cheekbone_ellipse?: ProductEtherealCheekboneEllipseDefinition;
  area_band?: ProductEtherealAreaBandDefinition;
  fallback_band?: ProductEtherealFallbackBandDefinition;
}

export interface ProductOpticalRenderingDefinition {
  ethereal?: ProductEtherealRenderingDefinition;
  highlighter?: ProductHighlighterRenderingDefinition;
}

export interface ProductOpticalLayerDefinition {
  color?: string;
  strength?: number;
  response_floor?: number;
  response_influence?: number;
  chroma_strength?: number;
  luma_delta?: number;
  luma_influence?: number;
  field?: ProductOpticalFieldDefinition;
  glow?: ProductOpticalGlowDefinition;
}

export interface ProductOpticalAreaDefinition {
  render_style?: ProductOpticalAreaRenderStyleDefinition;
  veil?: ProductOpticalLayerDefinition;
  body?: ProductOpticalLayerDefinition;
  core?: ProductOpticalLayerDefinition;
  contour?: ProductOpticalLayerDefinition;
  tint?: ProductOpticalLayerDefinition;
  pearl?: ProductOpticalLayerDefinition;
  sheen?: ProductOpticalLayerDefinition;
  sparkle?: ProductOpticalLayerDefinition;
  [layer: string]:
    | ProductOpticalLayerDefinition
    | ProductOpticalAreaRenderStyleDefinition
    | undefined;
}

export interface ProductOpticalProfile {
  finish?: string;
  display_color?: string;
  deposit_color?: string;
  light_adaptation?: number;
  luma_influence?: number;
  chroma_strength?: number;
  luma_delta?: number;
  rendering?: ProductOpticalRenderingDefinition;
  areas?: Record<string, ProductOpticalAreaDefinition>;
}

export interface ProductToneDefinition {
  color: string;
  opacity: number;
  regions: Record<string, RegionDefinition>;
  display_name?: string;
  optical_profile?: ProductOpticalProfile;
}

export interface ProductToneData extends ProductToneDefinition {
  product_type?: string;
  display_name?: string;
}

const normalizeKey = (value?: string | null) =>
  value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim() ?? "";

/**
 * Some handles include suffixes like `_lipstick` but our JSON keys don't.
 */
const sanitizeBaseKey = (value: string) => value.replace("_lipstick", "");

const simplifyProductTitle = (title: string) => {
  let simplified = title.toLowerCase();
  // Remove common suffixes and special characters
  simplified = simplified.replace(/(oil&_tint|stick|lipstick|paint|lip|&|,|\.|')/g, "");
  simplified = simplified.replace(/\s+/g, "_");
  simplified = simplified.replace(/_+/g, "_");
  simplified = simplified.trim();
  if (simplified.endsWith("_")) {
    simplified = simplified.slice(0, -1);
  }
  return simplified;
};

export const hexToRgba = (hex: string, opacity: number) => {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export function buildVariantMatchKey(productTitle?: string, variantTitle?: string) {
  if (!productTitle || !variantTitle) return null;
  const baseKey = simplifyProductTitle(productTitle);
  const variantKey = normalizeKey(variantTitle);
  if (!baseKey || !variantKey) return null;
  const matchKey = `${baseKey}_${variantKey}`;
  console.log("Generated match key:", matchKey);
  return matchKey;
}

export function resolveProductToneData(
  product: any,
  catalog: Record<string, ProductToneDefinition>,
  selectedVariant?: any
): ProductToneData | null {
  if (!product) return null;

  const normalizedVariant =
    typeof selectedVariant === "string"
      ? { title: selectedVariant }
      : selectedVariant;

  // ✅ 1. Use explicitly passed variant first
  const variantNode =
    normalizedVariant ||
    product?.selectedVariant ||
    product?.variants?.edges?.[0]?.node ||
    null;

  if (!variantNode) {
    console.warn("⚠️ No variant node found in product", product);
    return null;
  }

  // ✅ 2. Normalize titles
  const productTitle = product?.title ?? "";
  const productHandle = product?.handle ?? "";
  const baseKey = simplifyProductTitle(productTitle);
  const handleKey = normalizeKey(productHandle);
  const variantTitle = normalizeKey(variantNode?.title);

  // ✅ 3. Generate match keys [time waste code, need improment]
  const matchCandidates = [
    baseKey && variantTitle ? `${baseKey}_${variantTitle}` : null,
    handleKey && variantTitle ? `${handleKey}_${variantTitle}` : null,
    baseKey || null,
    handleKey || null,
    `lip_grace_${variantTitle}`,
    `lip_bloom_${variantTitle}`,
    `dream_paint_${variantTitle}`,
    `flush_bloom_${variantTitle}`,
    `ethereal_${variantTitle}`,
  ].filter(Boolean) as string[];

  // ✅ 4. Try matching against your local catalog
  let matchKey: string | null = null;
  for (const key of matchCandidates) {
    if (catalog[key]) {
      console.log(`✅ Matched tone key: ${key}`);
      matchKey = key;
      break;
    } else {
      console.log(`❌ Tried key "${key}" — not found`);
    }
  }

  if (!matchKey) {
    console.warn("⚠️ No matching tone data found for", variantTitle);
    console.log("Available catalog keys:", Object.keys(catalog));
    return null;
  }

  // ✅ 5. Return combined tone data
  return {
    ...catalog[matchKey],
    product_type:
      variantNode?.metafields?.product_type ||
      product?.metafields?.product_type ||
      "",
    display_name: catalog[matchKey]?.display_name || variantNode?.title,
  };
}
