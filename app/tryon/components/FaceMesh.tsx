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

const DEFAULT_CAMERA_ZOOM = 1.34;

function applyFaceFocusVignette(
  ctx: CanvasRenderingContext2D,
  landmarks: { x: number; y: number }[],
  width: number,
  height: number
) {
  const nose = landmarks[1];
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  if (!nose || !leftTemple || !rightTemple) return;

  const cx = nose.x * width;
  const cy = nose.y * height;
  const faceWidth = Math.max(
    120,
    Math.abs(rightTemple.x - leftTemple.x) * width
  );
  const innerRadius = faceWidth * 0.58;
  const outerRadius = faceWidth * 1.35;

  const vignette = ctx.createRadialGradient(
    cx,
    cy,
    innerRadius,
    cx,
    cy,
    outerRadius
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0.04)");
  vignette.addColorStop(1, "rgba(0,0,0,0.2)");

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// Canvas fijo y simple
export default function FaceMeshComponent({
  product,
  selectedVariant,
}: FaceMeshProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const faceAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(DEFAULT_CAMERA_ZOOM);
  const productDataRef = useRef<ProductToneData | null>(null);


  const [zoom, setZoom] = useState(DEFAULT_CAMERA_ZOOM);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [productData, setProductData] = useState<ProductToneData | null>(null);

  console.log("🧠 FaceMesh mounted — product:", product);

  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [activeVariantTitle, setActiveVariantTitle] = useState<string | null>(
    null
  );

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
      if (!isMounted) return;

      if (
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
      if (!isMounted) return;

      const currentProductData = productDataRef.current;
      if (!currentProductData) {
        animationFrameId = requestAnimationFrame(detectFace);
        return;
      }

      // Limpiar y dibujar el frame de cámara 1:1
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const baseScale = Math.max(
        canvas.width / video.videoWidth,
        canvas.height / video.videoHeight
      );
      const scale = baseScale * zoomRef.current;
      const baseOffsetX =
        (canvas.width - video.videoWidth * scale) / 2;
      const baseOffsetY =
        (canvas.height - video.videoHeight * scale) / 2;

      let offsetX = baseOffsetX;
      let offsetY = baseOffsetY;
      if (
        results.faceLandmarks &&
        results.faceLandmarks.length > 0
      ) {
        const landmarks = results.faceLandmarks[0];
        const nose = landmarks[1];
        if (nose) {
          const nextAnchor = {
            x: nose.x * video.videoWidth,
            y: nose.y * video.videoHeight,
          };
          const prev = faceAnchorRef.current;
          const smoothed = prev
            ? {
                x: prev.x + (nextAnchor.x - prev.x) * 0.22,
                y: prev.y + (nextAnchor.y - prev.y) * 0.22,
              }
            : nextAnchor;

          faceAnchorRef.current = smoothed;

          const targetX = canvas.width * 0.5;
          const targetY = canvas.height * 0.5;
          offsetX = targetX - smoothed.x * scale;
          offsetY = targetY - smoothed.y * scale;

          const minOffsetX = canvas.width - video.videoWidth * scale;
          const minOffsetY = canvas.height - video.videoHeight * scale;
          offsetX = Math.min(0, Math.max(minOffsetX, offsetX));
          offsetY = Math.min(0, Math.max(minOffsetY, offsetY));
        }
      } else {
        faceAnchorRef.current = null;
      }

      ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
      ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);


      // Aplicar maquillaje
      if (
        results.faceLandmarks &&
        results.faceLandmarks.length > 0
      ) {
        const landmarks = results.faceLandmarks[0];
        const isLipBloom =
          currentProductData.display_name
            ?.toLowerCase()
            .includes("lip bloom") ?? false;

        applyTone(
          ctx,
          landmarks,
          currentProductData,
          video.videoWidth,
          video.videoHeight,
          hexToRgba
        );

        if (isLipBloom) {
          applyFaceFocusVignette(
            ctx,
            landmarks,
            video.videoWidth,
            video.videoHeight
          );
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  }, [isStreamReady]);

  useEffect(() => {
    productDataRef.current = productData;
  }, [productData]);

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

      if (payload.type === "TRYON_STOP_CAMERA") {
        setIsCameraOn(false);
        setIsStreamReady(false);
        return;
      }

      if (payload.type === "COLOR_CHANGED") {
        const incomingVariantId = payload.variantId
          ? String(payload.variantId)
          : null;
        const incomingVariantTitle = payload.variantTitle
          ? String(payload.variantTitle)
          : null;
        if (!incomingVariantId && !incomingVariantTitle) return;

        console.log("💄 Received new variant from Shopify:", {
          id: incomingVariantId,
          title: incomingVariantTitle,
        });
        (window as any).__lastVariant = {
          id: incomingVariantId,
          title: incomingVariantTitle,
        };
        if (incomingVariantId) setActiveVariantId(incomingVariantId);
        if (incomingVariantTitle) setActiveVariantTitle(incomingVariantTitle);
        window.parent?.postMessage(
          {
            type: "TRYON_COLOR_ACK",
            variantId: incomingVariantId,
            variantTitle: incomingVariantTitle,
          },
          "*"
        );
      }
    }

    window.addEventListener("message", handleMessage, false);
    return () => {
      window.removeEventListener("message", handleMessage, false);
    };
  }, []); // 👈 runs once, just sets up the listener in shopify for color swap

  // When Shopify sends new variant → update the tone data
  useEffect(() => {
    if (!product || (!activeVariantId && !activeVariantTitle)) return;

    console.log("🎨 Updating tone for new variant:", {
      id: activeVariantId,
      title: activeVariantTitle,
    });

    const normalizeVariantId = (id: any) => {
      if (!id) return "";
      const str = String(id);
      const match = str.match(/(\d+)$/);
      return match ? match[1] : str;
    };

    const targetId = activeVariantId
      ? normalizeVariantId(activeVariantId)
      : "";

    // find the variant object by ID first
    const variantNode =
      targetId &&
      product?.variants?.edges?.find(
        (v: any) => {
          const vid = normalizeVariantId(v?.node?.id);
          return vid === targetId;
        }
      )?.node;

    let resolved: ProductToneData | null = null;
    let title = variantNode?.title || activeVariantTitle || "";

    if (variantNode) {
      resolved = resolveProductToneData(
        { ...product, selectedVariant: variantNode },
        productCatalog,
        variantNode
      );
    } else if (activeVariantTitle) {
      console.warn("⚠️ Variant node not found for ID:", activeVariantId);
      resolved = resolveProductToneData(
        product,
        productCatalog,
        activeVariantTitle
      );
    }

    if (resolved) {
      console.log("✅ Updated tone data:", resolved.display_name);
      setProductData(resolved);
    } else {
      console.warn("⚠️ No tone data found for variant:", title);
    }
  }, [activeVariantId, activeVariantTitle, product]);

  // Callbacks de cámara
  const handleStreamReady = useCallback(() => {
    setIsStreamReady(true);
    lastVideoTimeRef.current = -1;
    // 🔔 Tell Shopify: camera + canvas are ready
    window.parent?.postMessage({ type: "TRYON_READY" }, "*");
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
    window.parent?.postMessage({ type: "TRYON_CLOSE" }, "*");
  }, [stopCamera]);

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(z + 0.1, 2.2)),
    []
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(z - 0.1, 1)),
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
