import { NextResponse } from "next/server";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // <-- matches .env.local
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN; // shpat_...

export async function GET(request: Request) {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
        return NextResponse.json(
            { error: "Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_API_KEY env vars" },
            { status: 500 }
        );
    }

    const { searchParams } = new URL(request.url);
    const handle = searchParams.get("handle");
    if (!handle) {
        return NextResponse.json({ error: "Missing product handle" }, { status: 400 });
    }

    let variantFromUrl = searchParams.get("variant") || "";
    variantFromUrl = decodeURIComponent(variantFromUrl)
        .replace(/\+/g, " ")
        .trim()
        .toLowerCase();

    const query = `
  query getProduct($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      tags
      metafields(identifiers: [
        { namespace: "idony_tryon", key: "color" },
        { namespace: "idony_tryon", key: "opacity" },
        { namespace: "idony_tryon", key: "enabled" },
        { namespace: "idony_tryon", key: "product_type" }
      ]) {
        key
        value
      }
      variants(first: 50) {
        edges {
          node {
            id
            title
            metafields(identifiers: [
              { namespace: "idony_tryon", key: "color" },
              { namespace: "idony_tryon", key: "opacity" },
              { namespace: "idony_tryon", key: "enabled" },
              { namespace: "idony_tryon", key: "product_type" }
            ]) {
              key
              value
            }
          }
        }
      }
    }
  }
`;

    try {
        console.log("🧩 Variant from URL:", variantFromUrl || "(none)");

        const response = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/api/2024-07/graphql.json`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query, variables: { handle } }),
        });

        const data = await response.json();

        const product = data?.data?.productByHandle;
        if (!product) {
            console.error("❌ No product found in Shopify data:", data);
            return NextResponse.json({ error: "Product not found", details: data }, { status: 404 });
        }

        const variantEdges = product.variants?.edges || [];
        console.log("🧠 Shopify variants:", variantEdges.map((v: any) => v.node.title));

        const normalizeTitle = (value?: string | null) => (value || "").trim().toLowerCase();

        let selectedVariant: any = null;
        if (variantFromUrl && variantEdges.length > 0) {
            selectedVariant =
                variantEdges.find(
                    (edge: any) => normalizeTitle(edge?.node?.title) === variantFromUrl
                )?.node || null;

            if (!selectedVariant) {
                selectedVariant = variantEdges.find((edge: any) =>
                    normalizeTitle(edge?.node?.title).includes(variantFromUrl)
                )?.node;
            }

            if (selectedVariant) {
                console.log("✅ Variant match:", selectedVariant.title);
            }
        }

        if (!selectedVariant && variantEdges.length > 0) {
            selectedVariant = variantEdges[0].node;
            console.warn("⚠️ No variant matched, fallback to:", selectedVariant.title);
        }

        if (selectedVariant) {
            const cleanedMetafields: Record<string, string> = {};
            if (Array.isArray(selectedVariant.metafields)) {
                for (const mf of selectedVariant.metafields) {
                    if (mf?.key && typeof mf.value === "string") {
                        cleanedMetafields[mf.key] = mf.value;
                    }
                }
            }
            selectedVariant = {
                ...selectedVariant,
                metafields: cleanedMetafields,
            };
        }

        product.selectedVariant = selectedVariant;

        return NextResponse.json({ product });
    } catch (err: any) {
        console.error("❌ Shopify API error:", err);
        return NextResponse.json(
            { error: "Shopify API request failed", details: err.message || err },
            { status: 500 }
        );
    }
}
