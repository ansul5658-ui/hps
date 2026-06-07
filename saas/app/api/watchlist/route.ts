import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  // In production: fetch from DB using Clerk user ID
  return NextResponse.json({ items: [] });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { productId: string; targetPrice?: number };
    // In production: save to DB
    return NextResponse.json({ success: true, item: body });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  // In production: delete from DB
  return NextResponse.json({ success: true });
}
