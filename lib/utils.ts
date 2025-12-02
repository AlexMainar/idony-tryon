export type RegionDefinition = number[] | number[][];

export interface ProductToneDefinition {
  color: string;
  opacity: number;
  regions: Record<string, RegionDefinition>;
   display_name?: string;
}

export interface ProductToneData extends ProductToneDefinition {
  product_type?: string;
  display_name?: string;
}

const normalizeKey = (value?: string | null) =>
  value?.toLowerCase().replace(/\s+/g, "_").trim() ?? "";

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
  const variantTitle = variantNode?.title?.toLowerCase().replace(/\s+/g, "_") ?? "";

  // ✅ 3. Generate match keys
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
