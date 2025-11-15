"use client";
import { useEffect } from "react";

interface MakeupOverlayProps {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    width: number;
    height: number;
    className?: string;
}

export default function MakeupOverlay({ canvasRef, width, height, className }: MakeupOverlayProps) {
    useEffect(() => {
        if (!canvasRef.current) return;
        canvasRef.current.width = width;
        canvasRef.current.height = height;
    }, [canvasRef, width, height]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={className}
        />
    );
}
