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

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    outer.forEach((i) => {
        const p = landmarks[i];
        if (!p) return;
        const x = p.x * width;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
    });
    const lipWidth = Math.max(1, maxX - minX);
    const featherPx = Math.max(1.35, Math.min(3.4, lipWidth * 0.028));

    const coreColor = hexToRgba(
        productData.color,
        Math.min(1, productData.opacity * 0.68)
    );
    const featherFillColor = hexToRgba(
        productData.color,
        Math.min(1, productData.opacity * 0.52)
    );

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

    // Base color deposit that preserves lip texture from camera feed.
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = coreColor;
    ctx.fill(combined, "evenodd");
    ctx.restore();

    // Soft color lift, clipped to lip mask so blur doesn't bleed outside contour.
    ctx.save();
    ctx.clip(combined, "evenodd");
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.4;
    ctx.filter = `blur(${featherPx * 1.05}px)`;
    ctx.fillStyle = featherFillColor;
    ctx.fill(combined, "evenodd");
    ctx.restore();

    // Subtle shadow corners (adds volume)
    const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, 250);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(1, "rgba(0,0,0,0.15)");
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = grad;
    ctx.fill(combined);
    ctx.restore();
}
