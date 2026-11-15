import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { LipDiagnostic } from "./diagnosticCapture";
import type { LipPoint } from "./deformGeometry";

/** Replay identical decoded pixels and acquisition timestamps through both
 * detector configurations. Do not apply our shape or image-anchor filters.
 * MediaPipe enables native landmark smoothing only with numFaces === 1:
 * https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
 */
export async function compareDetectors(clip: LipDiagnostic, signal: AbortSignal,
  progress: (completed: number, total: number) => void): Promise<LipDiagnostic> {
  let standard: FaceLandmarker | null = null, unfiltered: FaceLandmarker | null = null;
  const check = () => { if (signal.aborted) throw new Error("Comparación cancelada."); };
  try {
    const vision = await FilesetResolver.forVisionTasks("/mediapipe");check();
    const options = { baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task" },
      runningMode: "VIDEO" as const, minFaceDetectionConfidence: .65, minFacePresenceConfidence: .75, minTrackingConfidence: .8 };
    standard = await FaceLandmarker.createFromOptions(vision, { ...options, numFaces: 1 });check();
    unfiltered = await FaceLandmarker.createFromOptions(vision, { ...options, numFaces: 2 });check();
    const canvas = document.createElement("canvas");canvas.width=clip.width;canvas.height=clip.height;
    const ctx = canvas.getContext("2d")!;
    const frames: LipDiagnostic['frames'] = [];
    // Multiple-face mode can change result order. Match the same person to
    // the recorded face, instead of assuming that result[0] is always correct.
    const choose = (faces: LipPoint[][], reference: LipPoint[] | null) => {
      if (!faces.length) return null;
      if (!reference) return faces.length === 1 ? faces[0] : null;
      const ids=[1,33,263,61,291];
      const scored=faces.map(points=>({points,error:ids.reduce((s,i)=>s+(points[i].x-reference[i].x)**2+(points[i].y-reference[i].y)**2,0)/ids.length})).sort((a,b)=>a.error-b.error);
      return scored[0].error < .025 ? scored[0].points : null;
    };
    for (const frame of clip.frames) {
      check();
      const image = await new Promise<HTMLImageElement>((resolve,reject) => {
        const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("Fotograma ilegible."));img.src=frame.image;
      });check();
      if(image.naturalWidth!==clip.width||image.naturalHeight!==clip.height)throw new Error("Dimensiones del fotograma incorrectas.");
      ctx.drawImage(image,0,0);
      const start=performance.now();
      const first=choose(standard.detectForVideo(canvas,frame.timeMs+1).faceLandmarks,frame.raw);
      const second=choose(unfiltered.detectForVideo(canvas,frame.timeMs+1).faceLandmarks,frame.raw);
      frames.push({...frame,raw:first,stabilized:second,detectionMs:performance.now()-start});
      progress(frames.length,clip.frames.length);
      // Keep Cancel and repaint responsive between inference calls.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    check();
    return {...clip,createdAt:new Date().toISOString(),frames,analysis:"native_smoothing_comparison"};
  } finally {standard?.close();unfiltered?.close();}
}
