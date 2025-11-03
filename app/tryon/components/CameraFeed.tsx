"use client";
import { useEffect, useRef } from "react";

export default function CameraFeed() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    async function startCamera() {
      try {
        console.log("Requesting camera...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
        });
        console.log("Camera stream started:", stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    }
    startCamera();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <video ref={videoRef} autoPlay playsInline muted className="max-w-full max-h-[90vh]" />
    </div>
  );
}