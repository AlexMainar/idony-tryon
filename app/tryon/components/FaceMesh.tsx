"use client";
import React, { useRef, useEffect, useState, useCallback } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import productsCatalog from "@/data/products.json";
import { initFaceLandmarker } from "@/lib/face/detectLandmarks";
import { applyTone } from "@/lib/render/applyTone";
import {
    hexToRgba,
    resolveProductToneData,
    ProductToneData,
    ProductToneDefinition
} from "@/lib/utils";
import CameraFeed from "./CameraFeed";
import MakeupOverlay from "./MakeupOverlay";
import Controls from "./Controls";

interface FaceMeshProps {
    product: any;
    selectedVariant?: string | null;
}

const productCatalog = productsCatalog as Record<string, ProductToneDefinition>;
const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;

export default function FaceMeshComponent({ product, selectedVariant }: FaceMeshProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const landmarkerRef = useRef<FaceLandmarker | null>(null);
    const lastVideoTimeRef = useRef(-1);
    const zoomRef = useRef(1);

    const [zoom, setZoom] = useState(1);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [isStreamReady, setIsStreamReady] = useState(false);
    const [productData, setProductData] = useState<ProductToneData | null>(null);

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
  const resolved = resolveProductToneData(product, productCatalog, selectedVariant);
  if (resolved) setProductData(resolved);
  else {
    console.warn("⚠️ No matching product tone data for", selectedVariant);
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
                return;
            }

            const video = videoRef.current;

            if (video.currentTime === lastVideoTimeRef.current) {
                animationFrameId = requestAnimationFrame(detectFace);
                return;
            }
            lastVideoTimeRef.current = video.currentTime;

            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                animationFrameId = requestAnimationFrame(detectFace);
                return;
            }

            const results = await landmarkerRef.current.detectForVideo(
                video,
                performance.now()
            );

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();

            const { width: w, height: h } = canvas;
            ctx.translate(w / 2, h / 2);
            ctx.scale(zoomRef.current, zoomRef.current);
            ctx.translate(-w / 2, -h / 2);
            ctx.drawImage(video, 0, 0, w, h);

            // 🧩 Step 1: Debug logs
            // 🧩 Step 1: Debug logs (once every second)
            const now = Date.now();
            const lastLogTime = (window as any).__lastLogTime || 0;

            if (now - lastLogTime > 1000) {
                console.log("🧠 productData passed to applyTone:", productData);
                console.log("🎯 productData.regions:", productData?.regions);
                console.log("🧍‍♂️ landmarks length:", results.faceLandmarks?.[0]?.length);
                (window as any).__lastLogTime = now;
            }
            
            if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                applyTone(ctx, results.faceLandmarks[0], productData, w, h, hexToRgba);
            }

            ctx.restore();
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
        <div className="flex flex-col items-center justify-center w-full h-screen bg-white relative">
            <div className="relative w-[640px] h-[480px] overflow-hidden rounded-xl shadow-lg">
                <CameraFeed
                    videoRef={videoRef}
                    isActive={isCameraOn}
                    onStreamReady={handleStreamReady}
                    onStreamStopped={handleStreamStopped}
                />
                <MakeupOverlay
                    canvasRef={canvasRef}
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
                    className="absolute top-0 left-0 w-full h-full z-10 pointer-events-none"
                />
                <Controls
                    className="absolute inset-0 z-20"
                    onClose={closeTryOn}
                    onZoomIn={zoomIn}
                    onZoomOut={zoomOut}
                />
            </div>

            {!isCameraOn && (
                <button
                    onClick={() => {
                        setIsCameraOn(true);
                    }}
                    className="mt-6 px-6 py-2 bg-black text-white rounded-md shadow-md hover:bg-gray-800"
                >
                    🎥 Volver a activar cámara
                </button>
            )}
        </div>
    );
}
