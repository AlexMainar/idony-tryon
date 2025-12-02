"use client";

import { useEffect, useState } from "react";
import FaceMeshComponent from "./components/FaceMesh";

export default function TryOnPage() {
  const [product, setProduct] = useState<any>(null);
  const [variantTitle, setVariantTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

        const res = await fetch(apiUrl);
        const data = await res.json();

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
