import type { MetadataRoute } from "next";

// Allow this route to be emitted during static export.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://svmschool.edu.in/sitemap.xml",
  };
}
