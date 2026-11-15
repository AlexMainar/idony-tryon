import { ProductToneData } from "@/lib/utils";

export type UnifiedComplexionProduct =
  | "flush_bloom"
  | "dream_paint_blush"
  | "dream_paint_bronzer";

export const getUnifiedComplexionProduct = (
  productData: ProductToneData | null | undefined
): UnifiedComplexionProduct | null => {
  const name = productData?.display_name?.toLowerCase().trim() || "";
  const type = (productData?.product_type || "").toLowerCase();

  if (name.includes("dream paint blush")) return "dream_paint_blush";
  if (name.includes("flush") && name.includes("bloom")) return "flush_bloom";
  if (name.includes("dream paint bronzer") || type.includes("bronzer")) {
    return "dream_paint_bronzer";
  }

  return null;
};

export const shouldUseUnifiedComplexionRenderer = (
  productData: ProductToneData | null | undefined
) => Boolean(getUnifiedComplexionProduct(productData));
