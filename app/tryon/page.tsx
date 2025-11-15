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
        const res = await fetch(`/api/shopify/product?handle=${handle}`);
        const data = await res.json();
        setProduct(data);
      } catch (error) {
        console.error("Error fetching product:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, []);

  if (loading) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen bg-white text-black">
        <h1 className="text-xl font-semibold mb-2">Cargando cámara...</h1>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen bg-white text-black">
        <h1 className="text-xl font-semibold mb-2">Producto no encontrado</h1>
      </main>
    );
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-white text-black">
      <h1 className="text-2xl font-bold mb-4">🎨 {product.title}</h1>
      <FaceMeshComponent product={product.product} selectedVariant={variantTitle} />
    </main>
  );
}