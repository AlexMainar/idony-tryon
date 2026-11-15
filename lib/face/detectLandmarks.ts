import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

type FaceLandmarkerRunningMode = "IMAGE" | "VIDEO";
type DetectorKey = FaceLandmarkerRunningMode | "VIDEO_LIPS";

const faceLandmarkerCache: Partial<Record<DetectorKey, FaceLandmarker>> = {};
const pendingLandmarkers: Partial<Record<DetectorKey, Promise<FaceLandmarker>>> = {};

/**
 * Initializes the MediaPipe FaceLandmarker model.
 * Caches the instance so we don't reload it every time.
 */
export async function initFaceLandmarker(
  runningMode: FaceLandmarkerRunningMode = "VIDEO",
  profile: "face" | "lips" = "face"
): Promise<FaceLandmarker> {
  const key: DetectorKey = runningMode === "VIDEO" && profile === "lips" ? "VIDEO_LIPS" : runningMode;
  if (faceLandmarkerCache[key]) {
    console.log("[TRYON PERF] face landmarker cache hit", { runningMode, profile });
    return faceLandmarkerCache[key];
  }

  // Page preload and camera readiness can race on a cold mobile connection.
  // Share the in-flight model rather than allocating two inference contexts.
  if (pendingLandmarkers[key]) return pendingLandmarkers[key]!;

  const loading = (async () => {

    try {
      const startedAt = performance.now();
      console.log("🧠 Initializing MediaPipe FaceLandmarker...", { runningMode });
      const vision = await FilesetResolver.forVisionTasks("/mediapipe");
      const options = {
        baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "GPU" as const },
        runningMode,
        // MediaPipe smooths landmarks implicitly when numFaces is one. Lips
        // already have an image anchor + residual filter; stacking that native
        // smoother delays expressions. Keep VIDEO ROI tracking without it.
        numFaces: key === "VIDEO_LIPS" ? 2 : 1,
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
      faceLandmarkerCache[key] = faceLandmarker;
      console.log("✅ FaceLandmarker ready.", {
        runningMode,
        profile,
        ms: Math.round(performance.now() - startedAt),
      });
      return faceLandmarker;
    } catch (err) {
      console.error("❌ Error initializing FaceLandmarker:", err);
      throw err;
    }
  })();
  pendingLandmarkers[key] = loading;
  try { return await loading; }
  finally { delete pendingLandmarkers[key]; }
}
