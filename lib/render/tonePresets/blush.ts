import { ProductToneData, RegionDefinition } from "@/lib/utils";
type Landmark = { x: number; y: number };

const normalizeRegion = (region: RegionDefinition): number[] => {
  if (Array.isArray(region[0])) return (region as number[][])[0];
  return region as number[];
};

export function renderBlush(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  productData: ProductToneData,
  width: number,
  height: number,
  hexToRgba: (hex: string, opacity: number) => string
) {
  const color = hexToRgba(productData.color, productData.opacity);
  const cheeks = normalizeRegion(productData.regions["cheeks"]);
  if (!cheeks) return;

  const indices = cheeks;
  const centerX = indices.reduce((s, i) => s + landmarks[i].x * width, 0) / indices.length;
  const centerY = indices.reduce((s, i) => s + landmarks[i].y * height, 0) / indices.length;
  const radius = 90;

  ctx.save();
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");

  ctx.globalCompositeOperation = "soft-light";
  ctx.filter = "blur(15px)";
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}