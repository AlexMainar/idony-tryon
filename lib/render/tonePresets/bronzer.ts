import { ProductToneData, RegionDefinition } from "@/lib/utils";
type Landmark = { x: number; y: number };

const normalizeRegion = (region: RegionDefinition): number[] => {
  if (Array.isArray(region[0])) return (region as number[][])[0];
  return region as number[];
};
export function renderBronzer(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const color = hexToRgba(productData.color, productData.opacity * 0.9);

  const areas = ["cheekbones", "temples", "nose_contour"];
  ctx.save();
  areas.forEach((name) => {
    const region = productData.regions[name];
    if (!region) return;

    const indices = normalizeRegion(region);
    const centerX = indices.reduce((s, i) => s + landmarks[i].x * width, 0) / indices.length;
    const centerY = indices.reduce((s, i) => s + landmarks[i].y * height, 0) / indices.length;
    const radius = 110;

    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "transparent");

    ctx.globalCompositeOperation = "multiply";
    ctx.filter = "blur(20px)";
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}