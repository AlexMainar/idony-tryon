"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
} from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import productsCatalog from "@/data/products.json";
import { initFaceLandmarker } from "@/lib/face/detectLandmarks";
import { applyTone } from "@/lib/render/applyTone";
import {
  hexToRgba,
  resolveProductToneData,
  ProductToneData,
  ProductToneDefinition,
} from "@/lib/utils";
import CameraFeed from "./CameraFeed";
import Controls from "./Controls";

interface FaceMeshProps {
  product: any;
  selectedVariant?: string | null;
}

const productCatalog = productsCatalog as Record<
  string,
  ProductToneDefinition
>;

// Canvas fijo y simple
export default function FaceMeshComponent({
  product,
  selectedVariant,
}: FaceMeshProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const zoomRef = useRef(1);

  const [zoom, setZoom] = useState(1);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [productData, setProductData] =
    useState<ProductToneData | null>(null);

  console.log("🧠 FaceMesh mounted — product:", product);

  // Mantener zoomRef sincronizado (aunque ahora el zoom es mínimo)
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Resolver datos de tono del producto
  useEffect(() => {
    if (!product) return;

    const variantTitle =
      selectedVariant ||
      product?.selectedVariant?.title ||
      product?.variants?.edges?.[0]?.node?.title;

    console.log("🎯 resolveProductToneData inputs:", {
      product,
      selectedVariant,
      variantTitle,
    });

    const resolved = resolveProductToneData(
      product,
      productCatalog,
      product?.selectedVariant || selectedVariant
    );

    if (resolved) {
      console.log("✅ Matched tone data for", resolved.display_name);
      console.log("✅ Setting productData:", resolved);
      setProductData(resolved);
    } else {
      console.warn(
        "⚠️ No matching product tone data for",
        variantTitle
      );
      setProductData(null);
    }
  }, [product, selectedVariant]);

  // Bucle de detección SIMPLE (la versión que funcionaba)
  useEffect(() => {
    if (!productData || !isStreamReady) return;

    let isMounted = true;
    let animationFrameId: number | null = null;

    const detectFace = async () => {
      if (
        !isMounted ||
        !videoRef.current ||
        !canvasRef.current ||
        !landmarkerRef.current
      ) {
        animationFrameId = requestAnimationFrame(detectFace);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        animationFrameId = requestAnimationFrame(detectFace);
        return;
      }

      // Esperar a que el vídeo tenga metadata
      if (!video.videoWidth || !video.videoHeight) {
        animationFrameId = requestAnimationFrame(detectFace);
        return;
      }

      // Opcional: evitar procesar el mismo frame dos veces
      if (video.currentTime === lastVideoTimeRef.current) {
        animationFrameId = requestAnimationFrame(detectFace);
        return;
      }
      lastVideoTimeRef.current = video.currentTime;

      // Mantener el canvas con la resolución nativa de la cámara
      if (
        canvas.width !== video.videoWidth ||
        canvas.height !== video.videoHeight
      ) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const results = await landmarkerRef.current.detectForVideo(
        video,
        performance.now()
      );

      // Limpiar y dibujar el frame de cámara 1:1
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Aplicar maquillaje
      if (
        results.faceLandmarks &&
        results.faceLandmarks.length > 0
      ) {
        applyTone(
          ctx,
          results.faceLandmarks[0],
          productData,
          canvas.width,
          canvas.height,
          hexToRgba
        );
      }

      animationFrameId = requestAnimationFrame(detectFace);
    };

    const init = async () => {
      try {
        if (!landmarkerRef.current) {
          landmarkerRef.current = await initFaceLandmarker();
        }
        detectFace();
      } catch (error) {
        console.error("❌ FaceMesh init failed:", error);
      }
    };

    init();

    return () => {
      isMounted = false;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [productData, isStreamReady]);

  // Callbacks de cámara
  const handleStreamReady = useCallback(() => {
    setIsStreamReady(true);
    lastVideoTimeRef.current = -1;
  }, []);

  const handleStreamStopped = useCallback(() => {
    setIsStreamReady(false);
  }, []);

  const stopCamera = useCallback(() => {
    setIsCameraOn(false);
    setIsStreamReady(false);
  }, []);

  const closeTryOn = useCallback(() => {
    stopCamera();
    window.location.href = "/";
  }, [stopCamera]);

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(z + 0.1, 2)),
    []
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(z - 0.1, 0.8)),
    []
  );

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
      <CameraFeed
        videoRef={videoRef}
        isActive={isCameraOn}
        onStreamReady={handleStreamReady}
        onStreamStopped={handleStreamStopped}
        className="absolute inset-0 w-full h-full object-cover opacity-0 z-0"
      />

      <canvas
      ref={canvasRef}
      className="
        absolute 
        top-1/2 left-1/2 
        transform -translate-x-1/2 -translate-y-1/2 
        w-full h-full 
        object-cover 
        z-10 
        pointer-events-none
      "
    />

      <Controls
        className="absolute inset-0 z-20"
        onClose={closeTryOn}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
      />

      {!isCameraOn && (
        <button
          onClick={() => setIsCameraOn(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 bg-black text-white rounded-md shadow-md hover:bg-gray-800 z-30"
        >
          🎥 Volver a activar cámara
        </button>
      )}
    </div>
  );
}
