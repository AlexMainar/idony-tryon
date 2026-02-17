import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let faceLandmarker: FaceLandmarker | null = null;

/**
 * Initializes the MediaPipe FaceLandmarker model.
 * Caches the instance so we don't reload it every time.
 */
export async function initFaceLandmarker(): Promise<FaceLandmarker> {
  if (faceLandmarker) {
    console.log("[TRYON PERF] face landmarker cache hit");
    return faceLandmarker;
  }

  try {
    const startedAt = performance.now();
    console.log("🧠 Initializing MediaPipe FaceLandmarker...");
    const vision = await FilesetResolver.forVisionTasks("/mediapipe");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task" },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    console.log("✅ FaceLandmarker ready.", {
      ms: Math.round(performance.now() - startedAt),
    });
    return faceLandmarker;
  } catch (err) {
    console.error("❌ Error initializing FaceLandmarker:", err);
    throw err;
  }
}
