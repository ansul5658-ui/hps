import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { productId: string; targetPrice: number; email?: string };

    if (!body.productId || !body.targetPrice) {
      return NextResponse.json({ error: "Product ID and target price required" }, { status: 400 });
    }

    // In production: save alert to DB and send confirmation email
    return NextResponse.json({
      success: true,
      message: `Alert set for ₹${body.targetPrice}. We'll notify you when the price drops.`,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
