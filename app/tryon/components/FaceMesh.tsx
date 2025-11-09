"use client";
import React, { useRef, useEffect, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import products from "@/data/products.json";


// Helper — convert hex colors like "#af4c76" → "rgba(175,76,118,0.6)"
const hexToRgba = (hex: string, opacity: number) => {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export default function FaceMeshComponent() {
    // Refs → connect React to real HTML elements (video + canvas)
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // State
    const [zoom, setZoom] = useState(1);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [productData, setProductData] = useState<any>(null); // stores the product from JSON

    // Variables for face detection
    let faceLandmarker: FaceLandmarker | null = null;
    let lastVideoTime = -1;

    // -------------------------------------------------------------
    // 🧭 1️⃣ STEP 1: Read product name from the URL & Load the product JSON file from /data
    // -------------------------------------------------------------
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const productKey = params.get("product");
        if (!productKey) return;

        const product = (products as any)[productKey];
        if (product) setProductData(product);
        else console.warn(`❌ Product ${productKey} not found in products.json`);
        console.log("Loaded product:", productKey, product);

    }, []);
    // -------------------------------------------------------------
    // 🎥 3️⃣ STEP 3: When productData is ready → start face tracking
    // -------------------------------------------------------------
    useEffect(() => {
        if (!productData) return; // wait until JSON has loaded

        let isMounted = true;

        // Core loop → detect face and render makeup every frame
        const detectFace = async () => {
            // Stop if camera or component isn't ready
            if (!isMounted || !faceLandmarker || !videoRef.current || !canvasRef.current)
                return;

            const video = videoRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;

            // Skip duplicate frames
            if (video.currentTime === lastVideoTime) {
                requestAnimationFrame(detectFace);
                return;
            }
            lastVideoTime = video.currentTime;

            // -------------------------------------------------------------
            // 🧠 STEP 4: Run MediaPipe’s AI model to find facial landmarks
            // -------------------------------------------------------------
            const results = await faceLandmarker.detectForVideo(video, performance.now());

            // Clean canvas each frame and draw the current video frame
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();

            // Apply zoom (if user pressed + or -)
            const w = canvas.width;
            const h = canvas.height;
            ctx.translate(w / 2, h / 2);
            ctx.scale(zoom, zoom);
            ctx.translate(-w / 2, -h / 2);

            ctx.drawImage(video, 0, 0, w, h); // draw camera feed behind

            // -------------------------------------------------------------
            // 🧩 STEP 5: Draw makeup masks from productData
            // -------------------------------------------------------------
            if (results.faceLandmarks && results.faceLandmarks.length > 0) {
                const landmarks = results.faceLandmarks[0]; // array of 468 face points
                const color = hexToRgba(productData.color, productData.opacity); // e.g. rgba(175,76,118,0.6)

                Object.keys(productData.regions).forEach((regionName) => {
                    const region = productData.regions[regionName];

                    // 🪞 Auto-mirror cheeks if only one side exists
                    if (regionName === "cheeks" && !productData.regions["cheeks_mirror"]) {
                        // Estimate mirrored indices (MediaPipe face symmetry is around index ~168)
                        const mirrored = region.map((i: number) => {
                            const mirrorIndex = 454 - i; // approximate mirror across the nose axis
                            return mirrorIndex > 0 ? mirrorIndex : i;
                        });
                        productData.regions["cheeks_mirror"] = mirrored;
                        // Draw the mirrored cheek immediately
                        const indices = mirrored;
                        const centerX = indices.reduce((sum, i) => sum + landmarks[i].x * w, 0) / indices.length;
                        const centerY = indices.reduce((sum, i) => sum + landmarks[i].y * h, 0) / indices.length;
                        const radius = 70;

                        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
                        gradient.addColorStop(0, color);
                        gradient.addColorStop(1, "transparent");

                        ctx.globalCompositeOperation = "multiply";
                        ctx.filter = "blur(10px)";
                        ctx.fillStyle = gradient;
                        ctx.beginPath();
                        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                        ctx.fill();

                        ctx.filter = "none";
                        ctx.globalCompositeOperation = "source-over";
                    }


                    // --- LIPS: handle as one combined path (outer minus inner) ---
                    if (regionName === "lips_inner") {
                        // Do not render inner by itself; it will be subtracted when drawing lips_outer.
                        return;
                    }
                    if (regionName === "lips_outer") {
                        const outer: number[] = productData.regions["lips_outer"];
                        const inner: number[] | undefined = productData.regions["lips_inner"];

                        ctx.beginPath();

                        // Outer ring
                        outer.forEach((i: number, idx: number) => {
                            const p = landmarks[i];
                            const x = p.x * w;
                            const y = p.y * h;
                            if (idx === 0) ctx.moveTo(x, y);
                            else ctx.lineTo(x, y);
                        });
                        ctx.closePath();

                        // Inner ring (mouth opening) — subtract from outer using even-odd
                        if (inner && inner.length) {
                            inner.forEach((i: number, idx: number) => {
                                const p = landmarks[i];
                                const x = p.x * w;
                                const y = p.y * h;
                                if (idx === 0) ctx.moveTo(x, y);
                                else ctx.lineTo(x, y);
                            });
                            ctx.closePath();
                            ctx.fillStyle = color;
                            ctx.fill("evenodd");
                        } else {
                            // Fallback: no inner ring available
                            ctx.fillStyle = color;
                            ctx.fill();
                        }
                        return; // lips handled; skip generic drawing
                    }

                    // --- GENERIC REGIONS (cheeks, nose, eyelids, etc.) ---
                    // Some regions (like eyelids) may be arrays of arrays (left/right)
                    const polygons = Array.isArray(region[0]) ? region : [region];

                    polygons.forEach((indices: number[]) => {
                        // Compute center point of region
                        const centerX = indices.reduce((sum, i) => sum + landmarks[i].x * w, 0) / indices.length;
                        const centerY = indices.reduce((sum, i) => sum + landmarks[i].y * h, 0) / indices.length;

                        // Adjust radius per region for realism
                        const radius = regionName.includes("cheek") ? 70 : regionName.includes("nose") ? 40 : 50;

                        // Create gradient
                        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
                        gradient.addColorStop(0, color);
                        gradient.addColorStop(1, "transparent");

                        // Apply blending and blur to simulate natural makeup
                        ctx.globalCompositeOperation = "multiply";
                        ctx.filter = "blur(10px)";
                        ctx.globalAlpha = 1.2 * productData.opacity; // boost intensity slightly
                        ctx.fillStyle = gradient;
                        ctx.beginPath();
                        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
                        ctx.fill();

                        // Reset filters for next region
                        ctx.globalAlpha = 1;
                        ctx.filter = "none";
                        ctx.globalCompositeOperation = "source-over";
                    });
                });
            }

            ctx.restore();
            requestAnimationFrame(detectFace); // run again for next frame
        };

        // -------------------------------------------------------------
        // 🚀 STEP 6: Initialize MediaPipe + Camera
        // -------------------------------------------------------------
        async function init() {
            try {
                const vision = await FilesetResolver.forVisionTasks("http://localhost:3000/mediapipe");
                faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                    baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task" },
                    runningMode: "VIDEO",
                    numFaces: 1
                });

                // Start camera and loop
                if (videoRef.current) {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: "user" }
                    });
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                    requestAnimationFrame(detectFace);
                }
            } catch (err) {
                console.error("❌ FaceMesh init failed:", err);
            }
        }

        init();

        // Clean up when leaving page
        return () => {
            isMounted = false;
        };
    }, [productData, zoom]); // runs when product or zoom changes

    // -------------------------------------------------------------
    // UI Controls
    // -------------------------------------------------------------
    const stopCamera = () => {
        if (videoRef.current?.srcObject) {
            const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
            tracks.forEach((track) => track.stop());
            setIsCameraOn(false);
        }
    };

    const closeTryOn = () => {
        stopCamera();
        window.location.href = "/";
    };

    const zoomIn = () => setZoom((z) => Math.min(z + 0.1, 2));
    const zoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.8));

    // -------------------------------------------------------------
    // 🎨 Render HTML structure
    // -------------------------------------------------------------
    return (
        <div className="flex flex-col items-center justify-center w-full h-screen bg-white relative">
            <div className="relative w-[640px] h-[480px] overflow-hidden rounded-xl shadow-lg">
                {/* 🎥 Live video feed */}
                <video
                    ref={videoRef}
                    className="absolute top-0 left-0 w-full h-full object-cover"
                    playsInline
                    autoPlay
                    muted
                />
                {/* 🖌️ Canvas overlay for makeup */}
                <canvas
                    ref={canvasRef}
                    width={640}
                    height={480}
                    className="absolute top-0 left-0 w-full h-full z-10"
                />

                {/* ❌ Close + Zoom Controls */}
                <button
                    onClick={closeTryOn}
                    className="absolute top-3 right-3 bg-white/70 hover:bg-white text-black text-sm px-3 py-1 rounded-md shadow-md"
                >
                    ✖️ Cerrar
                </button>

                <div className="absolute bottom-3 right-3 flex flex-col space-y-2">
                    <button onClick={zoomIn} className="bg-white/70 hover:bg-white text-black rounded-full w-8 h-8 text-lg shadow">+</button>
                    <button onClick={zoomOut} className="bg-white/70 hover:bg-white text-black rounded-full w-8 h-8 text-lg shadow">−</button>
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