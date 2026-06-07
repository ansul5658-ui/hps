import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Clock, Search, ChevronRight, Tag } from "lucide-react";
import { BLOG_POSTS, TRENDING_PRODUCTS } from "@/lib/mock-data";
import { formatPrice } from "@/lib/utils";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) return { title: "Not Found" };
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, images: [post.imageUrl] },
  };
}

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

const BLOG_CONTENT: Record<string, string[]> = {
  "best-smartphones-under-20000": [
    "Finding a great smartphone under ₹20,000 has never been easier. With fierce competition between brands, you get flagship-level features at mid-range prices.",
    "Our top picks for 2024 include devices with 5G connectivity, 48MP cameras, and 5000mAh batteries. Here's what to look for when shopping in this budget.",
    "The Redmi Note 13 Pro stands out with its 200MP camera and AMOLED display. The Realme 12 Pro offers excellent value with its Snapdragon chip and fast charging.",
    "For pure performance, the Samsung Galaxy M34 5G delivers with its Exynos chip and six-year software support promise. The POCO X6 is our top pick for gaming.",
    "Our Recommendation: Compare prices across Amazon, Flipkart, and Croma to find the best deal. Prices fluctuate frequently, so setting a price alert can help you catch the lowest price.",
  ],
  "best-laptops-for-students": [
    "The perfect student laptop balances performance, battery life, portability, and price. We tested 20+ laptops to find the best options for 2024.",
    "For engineering and CS students, the Lenovo IdeaPad Slim 5 with Ryzen 5 offers excellent performance for coding and development tasks.",
    "Arts and design students will love the Apple MacBook Air M2 for its color accuracy and Creative Suite performance, while the ASUS VivoBook 14 OLED offers similar display quality at lower cost.",
    "Budget-conscious students should look at the Acer Aspire Lite or Lenovo ThinkBook 15, both offering solid performance under ₹50,000.",
    "Our Recommendation: Buy during sales events like Amazon Great Indian Festival or Flipkart Big Billion Days for the best discounts. Set a PriceRadar alert!",
  ],
  "best-smartwatches-under-10000": [
    "The Indian smartwatch market has exploded with options under ₹10,000 that rival premium devices in features.",
    "The Noise ColorFit Pro 4 Alpha leads with a stunning AMOLED display, GPS, and 7-day battery life. The boAt Xtend Pro series offers excellent build quality.",
    "For health tracking, the Fire-Boltt Phoenix Ultra has the most comprehensive suite including SpO2, stress monitoring, and ECG.",
    "The Amazfit GTS 4 Mini stands out for its accurate GPS and 15-day battery, making it perfect for fitness enthusiasts.",
    "Our Recommendation: Avoid buying from unknown brands even at lower prices. Stick to established brands for better after-sales support and regular software updates.",
  ],
};

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);

  if (!post) notFound();

  const content = BLOG_CONTENT[slug] || [
    "This comprehensive guide covers everything you need to know about finding the best deals.",
    "Our experts have researched extensively to bring you the most up-to-date recommendations.",
    "Use PriceRadar to compare prices across all major Indian stores before making your purchase.",
  ];

  const relatedProducts = TRENDING_PRODUCTS.filter(
    (p) => p.category.toLowerCase() === post.category.toLowerCase()
  ).slice(0, 3);

  return (
    <div className="min-h-screen bg-white">
      <nav className="sticky top-0 z-50 glass border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-4">
          <Link href="/blog" className="text-gray-500 hover:text-gray-900 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg gradient-emerald flex items-center justify-center">
              <Search className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900">PriceRadar</span>
          </Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-emerald-50 text-emerald-700 text-sm font-medium px-3 py-1.5 rounded-full border border-emerald-100 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              {post.category}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-gray-400">
              <Clock className="w-3.5 h-3.5" />
              {post.readTime}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight">{post.title}</h1>
          <p className="text-lg text-gray-500 leading-relaxed">{post.excerpt}</p>
        </div>

        <div className="relative h-64 sm:h-80 rounded-2xl overflow-hidden mb-10">
          <Image src={post.imageUrl} alt={post.title} fill className="object-cover" sizes="700px" unoptimized />
        </div>

        <div className="prose prose-gray max-w-none">
          {content.map((paragraph, i) => (
            <p key={i} className={`text-gray-700 leading-relaxed mb-6 ${i === 0 ? "text-lg font-medium" : ""}`}>
              {paragraph}
            </p>
          ))}
        </div>

        {/* Affiliate Notice */}
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mt-8 text-sm text-amber-700">
          <strong>Disclosure:</strong> We may earn affiliate commissions when you buy through our links. This helps us keep PriceRadar free and independent.
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div className="mt-12">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Compare Prices on Top Picks</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {relatedProducts.map((product) => (
                <Link
                  key={product.id}
                  href={`/compare?q=${encodeURIComponent(product.name)}`}
                  className="bg-gray-50 rounded-2xl p-4 hover:bg-emerald-50 hover:border-emerald-200 border border-gray-100 transition-all group"
                >
                  <div className="relative h-32 mb-3 rounded-xl overflow-hidden bg-white">
                    <Image src={product.imageUrl} alt={product.name} fill className="object-cover" sizes="200px" unoptimized />
                  </div>
                  <p className="text-xs text-gray-400 mb-1">{product.brand}</p>
                  <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-2 group-hover:text-emerald-700">{product.name}</h3>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-600 text-sm">{formatPrice(product.lowestPrice)}</span>
                    <span className="text-xs text-gray-400 flex items-center gap-0.5">Compare <ChevronRight className="w-3 h-3" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
