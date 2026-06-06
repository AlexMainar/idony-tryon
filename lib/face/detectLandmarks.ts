import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type FaceLandmarkerRunningMode = "IMAGE" | "VIDEO";

const faceLandmarkerCache: Partial<Record<FaceLandmarkerRunningMode, FaceLandmarker>> = {};

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

  try {
    const startedAt = performance.now();
    console.log("🧠 Initializing MediaPipe FaceLandmarker...", { runningMode });
    const vision = await FilesetResolver.forVisionTasks("/mediapipe");
    const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task" },
      runningMode,
      numFaces: 1,
      minFaceDetectionConfidence: 0.65,
      minFacePresenceConfidence: 0.75,
      // A high threshold avoids leaning on MediaPipe's temporal tracker when
      // the face moves vertically; tracker lag shows up as lip "floating".
      minTrackingConfidence: 0.95,
    });
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
}
