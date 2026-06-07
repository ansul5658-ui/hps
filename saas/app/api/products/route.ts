import { NextRequest, NextResponse } from "next/server";
import { TRENDING_PRODUCTS } from "@/lib/mock-data";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const limit = parseInt(searchParams.get("limit") || "10");

  let products = TRENDING_PRODUCTS;

  if (category) {
    products = products.filter((p) =>
      p.category.toLowerCase() === category.toLowerCase()
    );
  }

  return NextResponse.json({
    products: products.slice(0, limit),
    total: products.length,
  });
}
