import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { store, price } = Object.fromEntries(request.nextUrl.searchParams);

    // In production, save to database
    console.log(`Click tracked: store=${store}, price=${price}`);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
