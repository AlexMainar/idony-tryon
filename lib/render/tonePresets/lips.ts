import { ProductToneData, RegionDefinition } from "@/lib/utils";
type Landmark = { x: number; y: number };

const normalizeRegion = (region: RegionDefinition): number[] => {
    if (Array.isArray(region[0])) return (region as number[][])[0];
    return region as number[];
};

export function renderLipGrace(
    ctx: CanvasRenderingContext2D,
    landmarks: Landmark[],
    productData: ProductToneData,
    width: number,
    height: number,
    hexToRgba: (hex: string, opacity: number) => string
) {
    const outer = normalizeRegion(productData.regions["lips_outer"]);
    const inner = normalizeRegion(productData.regions["lips_inner"]);
    if (!outer) return;

    const color = hexToRgba(productData.color, productData.opacity);
    const buildPath = (indices: number[]) => {
        const path = new Path2D();
        indices.forEach((i, idx) => {
            const p = landmarks[i];
            if (idx === 0) path.moveTo(p.x * width, p.y * height);
            else path.lineTo(p.x * width, p.y * height);
        });
        path.closePath();
        return path;
    };

    const outerPath = buildPath(outer);
    const innerPath = inner ? buildPath(inner) : null;
    const combined = new Path2D();
    combined.addPath(outerPath);
    if (innerPath) combined.addPath(innerPath);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "blur(2px)";
    ctx.fillStyle = color;
    ctx.fill(combined, "evenodd");

    // Subtle shadow corners (adds volume)
    const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, 250);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(1, "rgba(0,0,0,0.15)");
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = grad;
    ctx.fill(combined);

    ctx.restore();
}