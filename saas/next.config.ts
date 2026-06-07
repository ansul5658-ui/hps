import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.amazon.in" },
      { protocol: "https", hostname: "**.amazon.com" },
      { protocol: "https", hostname: "**.flipkart.com" },
      { protocol: "https", hostname: "**.myntra.com" },
      { protocol: "https", hostname: "**.ajio.com" },
      { protocol: "https", hostname: "**.nykaa.com" },
      { protocol: "https", hostname: "**.meesho.com" },
      { protocol: "https", hostname: "**.croma.com" },
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "rukminim2.flixcart.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "via.placeholder.com" },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
