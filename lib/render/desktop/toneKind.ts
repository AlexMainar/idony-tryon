import { ProductToneData } from "@/lib/utils";

export type DesktopComplexionToneKind = "blush" | "bronzer" | "highlighter";
export type DesktopLipToneKind = "lipOil" | "lipGrace";
export type DesktopToneKind =
  | DesktopComplexionToneKind
  | DesktopLipToneKind
  | null;

export const getDesktopToneKind = (
  productData: ProductToneData | null | undefined
): DesktopToneKind => {
  if (!productData?.display_name) return null;

  const name = productData.display_name.toLowerCase();
  const type = (productData.product_type || "").toLowerCase();

  if (productData.optical_profile?.finish === "pearlescent_highlighter") {
    return "highlighter";
  }
  if (name.includes("blush") || name.includes("flush") || type.includes("cheeks")) {
    return "blush";
  }
  if (name.includes("bronzer") || type.includes("bronzer")) {
    return "bronzer";
  }
  if (name.includes("luminizer") || name.includes("highlight") || type.includes("highlighter")) {
    return "highlighter";
  }
  if (name.includes("lip bloom") || name.includes("oil & tint") || type.includes("lip oil")) {
    return "lipOil";
  }
  if (name.includes("lip grace") || name.includes("lipstick") || type.includes("lips_inner")) {
    return "lipGrace";
  }

  return null;
};

export const isDesktopComplexionToneKind = (
  kind: DesktopToneKind
): kind is DesktopComplexionToneKind =>
  kind === "blush" || kind === "bronzer" || kind === "highlighter";

export const isDesktopLipToneKind = (
  kind: DesktopToneKind
): kind is DesktopLipToneKind => kind === "lipOil" || kind === "lipGrace";
