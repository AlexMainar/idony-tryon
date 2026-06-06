"use client";

import { useEffect, useState } from "react";
import FaceMeshComponent from "./components/FaceMesh";
import { initFaceLandmarker } from "@/lib/face/detectLandmarks";

export default function TryOnPage() {
  const [product, setProduct] = useState<any>(null);
  const [variantTitle, setVariantTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const effectStartAt = performance.now();
    const landmarkerPreloadStartAt = performance.now();
    console.log("[TRYON PERF] page effect start");

    void initFaceLandmarker("IMAGE")
      .then(() => {
        console.log("[TRYON PERF] face landmarker preload done", {
          ms: Math.round(performance.now() - landmarkerPreloadStartAt),
        });
      })
      .catch((error) => {
        console.error("❌ Preload FaceLandmarker failed:", error);
      });

    const urlParams = new URLSearchParams(window.location.search);
    const handle = urlParams.get("handle");
    const variant = urlParams.get("variant");
    setVariantTitle(variant);
    if (!handle) {
      setLoading(false);
      return;
    }

    const fetchProduct = async () => {
      try {
        console.log("🔍 URL params before backend call:");
        console.log("   → handle:", handle);
        console.log("   → variant:", urlParams.get("variant"));

        const variant = urlParams.get("variant");
        const apiUrl = `/api/shopify/product?handle=${encodeURIComponent(handle)}${
          variant ? `&variant=${encodeURIComponent(variant)}` : ""
        }`;

        console.log("📡 Fetching from backend:", apiUrl);
        const fetchStartAt = performance.now();

        const res = await fetch(apiUrl);
        const data = await res.json();
        console.log("[TRYON PERF] product fetch done", {
          ms: Math.round(performance.now() - fetchStartAt),
          status: res.status,
        });

        console.log("✅ Backend response:", data);
        if (data?.product) {
          setProduct(data.product);
          if (!variant && data.product?.selectedVariant?.title) {
            setVariantTitle(data.product.selectedVariant.title);
          }
        }
      } catch (error) {
        console.error("❌ Error fetching product:", error);
      } finally {
        setLoading(false);
        console.log("[TRYON PERF] page fetch flow finished", {
          ms: Math.round(performance.now() - effectStartAt),
        });
      }
    };

    fetchProduct();
  }, []);

  if (!product) return null;

  return (
    <main className="w-full h-full bg-black overflow-hidden">
      <FaceMeshComponent
        product={product}
        selectedVariant={variantTitle || product?.selectedVariant?.title || null}
      />
    </main>
  );
}
