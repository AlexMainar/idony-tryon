import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let faceLandmarker: FaceLandmarker | null = null;

/**
 * Initializes the MediaPipe FaceLandmarker model.
 * Caches the instance so we don't reload it every time.
 */
export async function initFaceLandmarker(): Promise<FaceLandmarker> {
  if (faceLandmarker) return faceLandmarker;

  try {
    console.log("🧠 Initializing MediaPipe FaceLandmarker...");
    const vision = await FilesetResolver.forVisionTasks("/mediapipe");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task" },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    console.log("✅ FaceLandmarker ready.");
    return faceLandmarker;
  } catch (err) {
    console.error("❌ Error initializing FaceLandmarker:", err);
    throw err;
  }
}
