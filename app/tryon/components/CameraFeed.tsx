"use client";
import { useEffect } from "react";

interface CameraFeedProps {
    videoRef: React.RefObject<HTMLVideoElement>;
    isActive: boolean;
    onStreamReady?: () => void;
    onStreamStopped?: () => void;
    onStreamError?: (error: Error) => void;
    className?: string;
}

export default function CameraFeed({
    videoRef,
    isActive,
    onStreamReady,
    onStreamStopped,
    onStreamError,
    className
}: CameraFeedProps) {
    useEffect(() => {
        let stream: MediaStream | null = null;
        let cancelled = false;

        const cleanupStream = () => {
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
                stream = null;
                onStreamStopped?.();
            }
            if (videoRef.current) {
                videoRef.current.srcObject = null;
            }
        };

        async function startCamera() {
            if (!isActive || !videoRef.current) return;

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "user" }
                });

                if (!videoRef.current || cancelled) {
                    cleanupStream();
                    return;
                }

                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                onStreamReady?.();
            } catch (error) {
                console.error("Error accessing camera:", error);
                onStreamError?.(error as Error);
            }
        }

        if (isActive) {
            startCamera();
        } else {
            cleanupStream();
        }

        return () => {
            cancelled = true;
            cleanupStream();
        };
    }, [isActive, videoRef, onStreamReady, onStreamStopped, onStreamError]);
    const showRawFeed =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("debug") === "true";

    const effectiveClassName = [
        className,                      // from FaceMesh
        showRawFeed ? "block" : "hidden pointer-events-none",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <video
            id="idony-camera-feed"
            ref={videoRef}
            className={effectiveClassName}
            playsInline
            autoPlay
            muted
        />
    );
}
