import { LIP_ANCHORS, type LipPoint } from "./deformGeometry";

export function drawDiagnosticContours(ctx: CanvasRenderingContext2D, width: number, height: number,
  raw: LipPoint[] | null, stabilized: LipPoint[] | null, selection: "both" | "raw" | "stabilized" | "none" = "both") {
  ctx.save();
  ctx.lineWidth = Math.max(1, width / 960);
  const draw = (points: LipPoint[] | null, original: boolean) => {
    if (!points) return;
    ctx.strokeStyle = original ? "#ffcf50" : "#36ecff";
    ctx.setLineDash(original ? [] : [3, 3]);
    for (const kind of ["upper", "lower"] as const) for (const edge of ["outer", "inner"] as const) {
      ctx.beginPath();
      LIP_ANCHORS[kind][edge].forEach((id, i) => {
        const p = points[id];
        if (i) ctx.lineTo(p.x * width, p.y * height); else ctx.moveTo(p.x * width, p.y * height);
      });
      ctx.stroke();
    }
  };
  if (selection === "both" || selection === "raw") draw(raw, true);
  if (selection === "both" || selection === "stabilized") draw(stabilized, false);
  ctx.restore();
}
