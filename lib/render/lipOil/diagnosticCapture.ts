import type { LipPoint } from "./deformGeometry";

export type DiagnosticFrame = {
  timeMs: number;
  detectionMs: number;
  image: string;
  raw: LipPoint[] | null;
  stabilized: LipPoint[] | null;
};
export type LipDiagnostic = {
  kind: "idony_lip_diagnostic_v1";
  createdAt: string;
  analysis?: "native_smoothing_comparison";
  width: number;
  height: number;
  frames: DiagnosticFrame[];
};
export const MAX_CAPTURE_FRAMES = 180;
export const CAPTURE_MS = 6000;

export function parseLipDiagnostic(text: string): LipDiagnostic {
  const value = JSON.parse(text);
  const validPoints = (ps: unknown) => ps === null || (Array.isArray(ps) && ps.length >= 455 && ps.length <= 478 && ps.every(p =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z))));
  if (value?.kind !== "idony_lip_diagnostic_v1" || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || value.width < 16 || value.width > 4096 || value.height < 16 || value.height > 4096
    || !Array.isArray(value.frames) || !value.frames.length || value.frames.length > MAX_CAPTURE_FRAMES) throw new Error("Archivo de diagnóstico no válido.");
  if (value.analysis !== undefined && value.analysis !== "native_smoothing_comparison") throw new Error("Tipo de comparación no válido.");
  let previous = -1;
  for (const frame of value.frames) {
    if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 || frame.timeMs <= previous
      || !Number.isFinite(frame.detectionMs) || frame.detectionMs < 0
      || typeof frame.image !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(frame.image)
      || !validPoints(frame.raw) || !validPoints(frame.stabilized)) throw new Error("Fotograma de diagnóstico no válido.");
    previous = frame.timeMs;
  }
  return value;
}

/** Snapshot the camera canvas before the next frame can modify it. JPEG encode
 * runs asynchronously; frames keep acquisition order regardless of completion.
 */
export function captureDiagnosticFrame(canvas: HTMLCanvasElement, timeMs: number, detectionMs: number,
  raw: LipPoint[] | null, stabilized: LipPoint[] | null): Promise<DiagnosticFrame> {
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width; snapshot.height = canvas.height;
  snapshot.getContext("2d")!.drawImage(canvas, 0, 0);
  const clone = (ps: LipPoint[] | null) => ps?.map(p => ({ ...p })) ?? null;
  const points = { raw: clone(raw), stabilized: clone(stabilized) };
  return new Promise((resolve, reject) => snapshot.toBlob(blob => {
    snapshot.width = snapshot.height = 0;
    if (!blob) { reject(new Error("No se pudo guardar el fotograma.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo codificar el fotograma."));
    reader.onload = () => resolve({ timeMs, detectionMs, image: String(reader.result), ...points });
    reader.readAsDataURL(blob);
  }, "image/jpeg", .9));
}
