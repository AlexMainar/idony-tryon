"use client";
import React, { useRef, useEffect, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export default function FaceMeshComponent() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isCameraOn, setIsCameraOn] = useState(true);
  let faceLandmarker: FaceLandmarker | null = null;
  let lastVideoTime = -1;

  useEffect(() => {
    let isMounted = true;

    const detectFace = async () => {
      if (!isMounted || !faceLandmarker || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (video.currentTime === lastVideoTime) {
        requestAnimationFrame(detectFace);
        return;
      }
      lastVideoTime = video.currentTime;

      const results = await faceLandmarker.detectForVideo(video, performance.now());
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();

      // Apply zoom
      const w = canvas.width;
      const h = canvas.height;
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-w / 2, -h / 2);

      ctx.drawImage(video, 0, 0, w, h);

      if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];

        // Lip polygon indices
        const lipIndices = [
          61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
          291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
        ];

        ctx.beginPath();
        lipIndices.forEach((index, i) => {
          const p = landmarks[index];
          const x = p.x * w;
          const y = p.y * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 0, 0, 0.7)";
        ctx.fill();
      }

      ctx.restore();
      requestAnimationFrame(detectFace);
    };

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks("http://localhost:3000/mediapipe");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task" },
          runningMode: "VIDEO",
          numFaces: 1,
        });

        if (videoRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          requestAnimationFrame(detectFace);
        }
      } catch (err) {
        console.error("❌ FaceMesh init failed:", err);
      }
    }

    init();
    return () => { isMounted = false; };
  }, [zoom]);

  // 🧭 Control handlers
  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
      setIsCameraOn(false);
    }
  };

  const closeTryOn = () => {
    stopCamera();
    window.location.href = "/"; // or redirect to your main product page
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 0.1, 2));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.8));

  return (
    <div className="flex flex-col items-center justify-center w-full h-screen bg-white relative">
      <div className="relative w-[640px] h-[480px] overflow-hidden rounded-xl shadow-lg">
        <video
          ref={videoRef}
          className="absolute top-0 left-0 w-full h-full object-cover"
          playsInline
          autoPlay
          muted
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="absolute top-0 left-0 w-full h-full z-10"
        />
        {/* ✖️ Close button */}
        <button
          onClick={closeTryOn}
          className="absolute top-3 right-3 bg-white/70 hover:bg-white text-black text-sm px-3 py-1 rounded-md shadow-md"
        >
          ✖️ Cerrar
        </button>

        {/* ➕➖ Zoom buttons */}
        <div className="absolute bottom-3 right-3 flex flex-col space-y-2">
          <button
            onClick={zoomIn}
            className="bg-white/70 hover:bg-white text-black rounded-full w-8 h-8 text-lg shadow"
          >
            +
          </button>
          <button
            onClick={zoomOut}
            className="bg-white/70 hover:bg-white text-black rounded-full w-8 h-8 text-lg shadow"
          >
            −
          </button>
        </div>
      </div>

      {!isCameraOn && (
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-6 py-2 bg-black text-white rounded-md shadow-md hover:bg-gray-800"
        >
          🎥 Volver a activar cámara
        </button>
      )}
    </div>
  );
}