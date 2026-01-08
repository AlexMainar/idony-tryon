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
  const [productData, setProductData] = useState<ProductToneData | null>(null);

  console.log("🧠 FaceMesh mounted — product:", product);

  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

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

      // visible size (critical fix)
      canvas.style.width = "100%";
      canvas.style.height = "100%";

      // FIX: Mediapipe keeps overwriting canvas styles → force correct stacking
      canvas.style.zIndex = "10";
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";

      const results = await landmarkerRef.current.detectForVideo(
        video,
        performance.now()
      );

      // Limpiar y dibujar el frame de cámara 1:1
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      
      const scale = Math.max(
        canvas.width / video.videoWidth,
        canvas.height / video.videoHeight
      );
      const drawWidth = video.videoWidth * scale;
      const drawHeight = video.videoHeight * scale;
      const offsetX = (canvas.width - drawWidth) / 2;
      const offsetY = (canvas.height - drawHeight) / 2;

      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

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

useEffect(() => {
  function handleMessage(event: MessageEvent) {
    let payload: any = event.data;

    // Shopify or other scripts might send strings; attempt to parse JSON
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return;
      }
    }

    if (!payload || typeof payload !== "object") return;

    if (payload.type === "COLOR_CHANGED" && payload.variantId) {
      const incomingVariantId = String(payload.variantId);
      console.log("💄 Received new variant from Shopify:", incomingVariantId);
      setActiveVariantId(incomingVariantId);
    }
  }

  window.addEventListener("message", handleMessage, false);
  return () => {
    window.removeEventListener("message", handleMessage, false);
  };
}, []); // 👈 runs once, just sets up the listener in shopify for color swap

// When Shopify sends new variant → update the tone data
useEffect(() => {
  if (!activeVariantId || !product) return;

  console.log("🎨 Updating tone for new variant:", activeVariantId);

  const normalizeVariantId = (id: any) => {
    if (!id) return "";
    const str = String(id);
    const match = str.match(/(\d+)$/);
    return match ? match[1] : str;
  };

  const targetId = normalizeVariantId(activeVariantId);

  // find the variant object
  const variantNode =
    product?.variants?.edges?.find(
      (v: any) => {
        const vid = normalizeVariantId(v?.node?.id);
        return vid === targetId;
      }
    )?.node;

  if (!variantNode) {
    console.warn("⚠️ Variant node not found for ID:", activeVariantId);
    return;
  }

  const title = variantNode?.title;

  const resolved = resolveProductToneData(
    { ...product, selectedVariant: variantNode },
    productCatalog,
    variantNode
  );

  if (resolved) {
    console.log("✅ Updated tone data:", resolved.display_name);
    setProductData(resolved);
  } else {
    console.warn("⚠️ No tone data found for variant:", title);
  }
}, [activeVariantId, product]);

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
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* VIDEO (invisible, only used for detection) */}
      <CameraFeed
        videoRef={videoRef}
        isActive={isCameraOn}
        onStreamReady={handleStreamReady}
        onStreamStopped={handleStreamStopped}
        className="absolute inset-0 w-full h-full object-contain opacity-0 z-0"
      />

      {/* CANVAS (visible layer with makeup) */}
      <canvas
        ref={canvasRef}
        className="
        absolute inset-0
        w-full h-full
        pointer-events-none 
        z-10
      "
      />

      {/* CONTROLS (must be ABOVE canvas) */}
      <Controls
        className="controls absolute top-4 right-4 z-50 pointer-events-auto flex items-center gap-3"
        onClose={closeTryOn}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
      />

      {/* REACTIVATE CAMERA BUTTON */}
      {!isCameraOn && (
        <button
          onClick={() => setIsCameraOn(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 bg-black text-white rounded-md shadow-md hover:bg-gray-800 z-50"
        >
          🎥 Volver a activar cámara
        </button>
      )}
    </div>
  );
}
