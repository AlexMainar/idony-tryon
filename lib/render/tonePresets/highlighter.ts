import { ProductToneData, RegionDefinition } from "@/lib/utils";
type Landmark = { x: number; y: number };

const normalizeRegion = (region: RegionDefinition): number[] => {
  if (Array.isArray(region[0])) return (region as number[][])[0];
  return region as number[];
};

export function renderHighlighter(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const color = hexToRgba(productData.color, productData.opacity);

  const highlightAreas = ["upper_cheeks", "nose_tip", "eyelids", "cupid_bow"];
  ctx.save();
  highlightAreas.forEach((area) => {
    const region = productData.regions[area];
    if (!region) return;

    const indices = normalizeRegion(region);
    const centerX = indices.reduce((s, i) => s + landmarks[i].x * width, 0) / indices.length;
    const centerY = indices.reduce((s, i) => s + landmarks[i].y * height, 0) / indices.length;

    const radius = 70;
    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    grad.addColorStop(0, hexToRgba("#ffffff", 0.5));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, "transparent");

    ctx.globalCompositeOperation = "screen";
    ctx.filter = "blur(10px)";
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}