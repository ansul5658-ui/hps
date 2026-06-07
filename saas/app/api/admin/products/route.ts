import { NextRequest, NextResponse } from "next/server";
import { TRENDING_PRODUCTS } from "@/lib/mock-data";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const search = searchParams.get("search") || "";

  let products = TRENDING_PRODUCTS;
  if (search) {
    products = products.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.brand.toLowerCase().includes(search.toLowerCase())
    );
  }

  const start = (page - 1) * limit;
  const paginatedProducts = products.slice(start, start + limit);

  return NextResponse.json({
    products: paginatedProducts,
    total: products.length,
    page,
    totalPages: Math.ceil(products.length / limit),
  });
}
