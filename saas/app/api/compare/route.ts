import { NextRequest, NextResponse } from "next/server";
import { scrapeProduct, detectStore } from "@/lib/scraper";
import { normalizeProduct } from "@/lib/openai";
import { generateAffiliateUrl } from "@/lib/affiliate";
import { MOCK_COMPARISON_DATA } from "@/lib/mock-data";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get("url");
  const query = searchParams.get("q");

  if (!url && !query) {
    return NextResponse.json({ error: "URL or query required" }, { status: 400 });
  }

  try {
    if (url) {
      const store = detectStore(url);
      const scraped = await scrapeProduct(url);

      const normalized = await normalizeProduct({
        title: scraped.title,
        description: scraped.description,
        specifications: scraped.specifications,
      });

      const mockStores = MOCK_COMPARISON_DATA.stores.map((s) => ({
        ...s,
        affiliateUrl: generateAffiliateUrl(s.productUrl, s.slug),
      }));

      return NextResponse.json({
        product: {
          id: "prod_" + Date.now(),
          name: normalized.name || scraped.title,
          brand: normalized.brand || scraped.brand,
          model: normalized.model,
          category: normalized.category,
          imageUrl: scraped.imageUrl || MOCK_COMPARISON_DATA.product.imageUrl,
          specifications: normalized.specifications || {},
          reviewSummary: MOCK_COMPARISON_DATA.product.reviewSummary,
        },
        stores: mockStores,
        priceHistory: MOCK_COMPARISON_DATA.priceHistory,
        sourceStore: store,
        sourcePrice: scraped.price,
      });
    }

    return NextResponse.json(MOCK_COMPARISON_DATA);
  } catch (error) {
    console.error("Compare error:", error);
    return NextResponse.json(MOCK_COMPARISON_DATA);
  }
}
