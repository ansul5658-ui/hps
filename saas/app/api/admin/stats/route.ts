import { NextResponse } from "next/server";

export async function GET() {
  // In production: fetch from database
  return NextResponse.json({
    totalRevenue: 558000,
    monthlyRevenue: 134000,
    totalClicks: 17100,
    conversionRate: 32,
    activeUsers: 4891,
    totalUsers: 500000,
    productsTracked: 10200000,
    storesConnected: 50,
  });
}
