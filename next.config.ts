import type { NextConfig } from "next";

/**
 * Two build modes:
 *
 * 1. Default (`npm run build`) — a standard Next.js app for Node hosts
 *    such as Vercel/Netlify. Best quality, supports everything.
 *
 * 2. Static export (`npm run export`) — sets BUILD_STATIC=true to emit a
 *    plain HTML/CSS/JS site into `out/` that you can upload to ANY host,
 *    including a WordPress (PHP) server, via FTP/cPanel.
 *
 *    If you serve it from a SUBFOLDER (e.g. yoursite.com/campus), set the
 *    folder as a base path so asset URLs resolve correctly:
 *
 *      NEXT_BASE_PATH=/campus npm run export
 *
 *    Then upload the contents of `out/` into that folder. For a whole
 *    domain or subdomain (e.g. www. or admissions.yoursite.com), leave
 *    NEXT_BASE_PATH unset and upload `out/` to the web root.
 */
const isStatic = process.env.BUILD_STATIC === "true";
const basePath = process.env.NEXT_BASE_PATH || "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  ...(isStatic ? { output: "export" } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  trailingSlash: isStatic,
  images: {
    // Static export can't use the Next image optimizer; we use plain <img>
    // tags anyway, so this is just a safety net.
    unoptimized: isStatic,
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    optimizePackageImports: ["motion", "gsap"],
  },
};

export default nextConfig;
