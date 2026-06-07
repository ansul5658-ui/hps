import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // In production: look up affiliate link by tracking code and redirect
  // For now redirect to homepage
  console.log(`Tracking code: ${code}`);

  return NextResponse.redirect(new URL("/", request.url));
}
