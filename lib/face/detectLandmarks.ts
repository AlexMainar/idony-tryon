import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type FaceLandmarkerRunningMode = "IMAGE" | "VIDEO";

const faceLandmarkerCache: Partial<Record<FaceLandmarkerRunningMode, FaceLandmarker>> = {};
const pendingLandmarkers: Partial<Record<FaceLandmarkerRunningMode, Promise<FaceLandmarker>>> = {};

/**
 * Initializes the MediaPipe FaceLandmarker model.
 * Caches the instance so we don't reload it every time.
 */
export async function initFaceLandmarker(
  runningMode: FaceLandmarkerRunningMode = "VIDEO"
): Promise<FaceLandmarker> {
  if (faceLandmarkerCache[runningMode]) {
    console.log("[TRYON PERF] face landmarker cache hit", { runningMode });
    return faceLandmarkerCache[runningMode];
  }

  // Page preload and camera readiness can race on a cold mobile connection.
  // Share the in-flight model rather than allocating two inference contexts.
  if (pendingLandmarkers[runningMode]) return pendingLandmarkers[runningMode]!;

  const loading = (async () => {

  try {
    const startedAt = performance.now();
    console.log("🧠 Initializing MediaPipe FaceLandmarker...", { runningMode });
    const vision = await FilesetResolver.forVisionTasks("/mediapipe");
    const options = {
      baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "GPU" as const },
      runningMode,
      numFaces: 1,
      minFaceDetectionConfidence: 0.65,
      minFacePresenceConfidence: 0.75,
      // A high threshold avoids leaning on MediaPipe's temporal tracker when
      // the face moves vertically; tracker lag shows up as lip "floating".
      minTrackingConfidence: 0.95,
    };
    let faceLandmarker: FaceLandmarker;
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch (gpuError) {
      console.warn("GPU face inference unavailable; using CPU.", gpuError);
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        ...options, baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
    faceLandmarkerCache[runningMode] = faceLandmarker;
    console.log("✅ FaceLandmarker ready.", {
      runningMode,
      ms: Math.round(performance.now() - startedAt),
    });
    return faceLandmarker;
  } catch (err) {
    console.error("❌ Error initializing FaceLandmarker:", err);
    throw err;
  }
  })();
  pendingLandmarkers[runningMode] = loading;
  try { return await loading; }
  finally { delete pendingLandmarkers[runningMode]; }
}
