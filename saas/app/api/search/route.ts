import { NextRequest, NextResponse } from "next/server";
import { TRENDING_PRODUCTS } from "@/lib/mock-data";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const results = TRENDING_PRODUCTS.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    p.brand.toLowerCase().includes(query.toLowerCase()) ||
    p.category.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5);

  return NextResponse.json({
    results: results.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      lowestPrice: p.lowestPrice,
      imageUrl: p.imageUrl,
      category: p.category,
    })),
  });
}
