import { MetadataRoute } from "next";
import { BLOG_POSTS, TRENDING_PRODUCTS } from "@/lib/mock-data";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://priceradar.in";

  const staticPages = [
    { url: baseUrl, changeFrequency: "daily" as const, priority: 1.0 },
    { url: `${baseUrl}/compare`, changeFrequency: "hourly" as const, priority: 0.9 },
    { url: `${baseUrl}/trending`, changeFrequency: "daily" as const, priority: 0.8 },
    { url: `${baseUrl}/blog`, changeFrequency: "weekly" as const, priority: 0.7 },
    { url: `${baseUrl}/dashboard`, changeFrequency: "monthly" as const, priority: 0.5 },
  ];

  const blogPages = BLOG_POSTS.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const productPages = TRENDING_PRODUCTS.map((product) => ({
    url: `${baseUrl}/compare?q=${encodeURIComponent(product.name)}`,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...blogPages, ...productPages];
}
