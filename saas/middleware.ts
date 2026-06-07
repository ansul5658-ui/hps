import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limiting headers
  const response = NextResponse.next();
  response.headers.set("X-Powered-By", "PriceRadar");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Protect admin routes in production
  if (pathname.startsWith("/admin")) {
    const adminSecret = request.cookies.get("admin_secret")?.value;
    if (process.env.NODE_ENV === "production" && adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.webp$).*)",
  ],
};
