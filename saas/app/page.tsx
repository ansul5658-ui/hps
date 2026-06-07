"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Search, TrendingUp, Shield, Zap, ChevronRight, ArrowRight, BarChart3, Bell, Globe } from "lucide-react";
import { TRENDING_PRODUCTS, BLOG_POSTS } from "@/lib/mock-data";
import { formatPrice } from "@/lib/utils";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("Please enter a product URL");
      return;
    }
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url.trim())) {
      setError("Please enter a valid URL starting with http:// or https://");
      return;
    }
    setError("");
    setIsLoading(true);
    router.push(`/compare?url=${encodeURIComponent(url.trim())}`);
  };

  const exampleUrls = [
    "amazon.in/dp/B0CHX2FSCF",
    "flipkart.com/apple-iphone-15",
    "croma.com/apple-iphone-15",
  ];

  const features = [
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Instant Comparison",
      description: "Compare prices across 50+ stores in seconds with AI-powered matching",
      color: "text-yellow-500",
      bg: "bg-yellow-50",
    },
    {
      icon: <BarChart3 className="w-6 h-6" />,
      title: "Price History",
      description: "Track price trends over 7, 30, or 90 days to buy at the right time",
      color: "text-blue-500",
      bg: "bg-blue-50",
    },
    {
      icon: <Bell className="w-6 h-6" />,
      title: "Price Alerts",
      description: "Get notified instantly when prices drop to your target",
      color: "text-emerald-500",
      bg: "bg-emerald-50",
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Verified Deals",
      description: "All prices verified in real-time. No fake discounts, ever",
      color: "text-purple-500",
      bg: "bg-purple-50",
    },
    {
      icon: <Globe className="w-6 h-6" />,
      title: "50+ Stores",
      description: "Amazon, Flipkart, Myntra, Croma, Nykaa, Meesho and many more",
      color: "text-orange-500",
      bg: "bg-orange-50",
    },
    {
      icon: <TrendingUp className="w-6 h-6" />,
      title: "AI Predictions",
      description: "Smart buying recommendations based on historical price trends",
      color: "text-pink-500",
      bg: "bg-pink-50",
    },
  ];

  const stats = [
    { value: "50+", label: "Stores Tracked" },
    { value: "10M+", label: "Products Indexed" },
    { value: "₹2.4Cr", label: "Saved by Users" },
    { value: "4.9★", label: "User Rating" },
  ];

  const stores = [
    { name: "Amazon", color: "#FF9900" },
    { name: "Flipkart", color: "#2874F0" },
    { name: "Myntra", color: "#FF3F6C" },
    { name: "Ajio", color: "#E51E25" },
    { name: "Nykaa", color: "#FC2779" },
    { name: "Meesho", color: "#9B2EE1" },
    { name: "Croma", color: "#6CC04A" },
    { name: "Reliance", color: "#0066CC" },
    { name: "Tata Cliq", color: "#3B2067" },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-emerald flex items-center justify-center">
                <Search className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-xl text-gray-900">PriceRadar</span>
            </Link>
            <div className="hidden md:flex items-center gap-6">
              <Link href="/compare" className="text-gray-600 hover:text-emerald-600 text-sm font-medium transition-colors">Compare</Link>
              <Link href="/trending" className="text-gray-600 hover:text-emerald-600 text-sm font-medium transition-colors">Trending</Link>
              <Link href="/blog" className="text-gray-600 hover:text-emerald-600 text-sm font-medium transition-colors">Blog</Link>
              <Link href="/dashboard" className="text-gray-600 hover:text-emerald-600 text-sm font-medium transition-colors">Dashboard</Link>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/sign-in" className="text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors">Sign In</Link>
              <Link href="/sign-up" className="gradient-emerald text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium mb-8 border border-emerald-100">
            <Zap className="w-4 h-4" />
            AI-Powered Price Intelligence
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-gray-900 mb-6 leading-tight">
            Find the{" "}
            <span className="text-gradient">Lowest Price</span>
            <br />
            on Every Product
          </h1>

          <p className="text-xl text-gray-500 mb-12 max-w-2xl mx-auto leading-relaxed">
            Paste any product link from Amazon, Flipkart, Myntra, or 50+ stores.
            Our AI instantly finds you the best deal across the web.
          </p>

          {/* Search Box */}
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mb-4">
            <div className="flex gap-2 p-2 bg-white rounded-2xl shadow-xl border border-gray-100">
              <div className="flex-1 flex items-center gap-3 px-4">
                <Search className="w-5 h-5 text-gray-400 shrink-0" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(""); }}
                  placeholder="Paste any product URL here..."
                  className="flex-1 outline-none text-gray-900 placeholder-gray-400 text-base bg-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="gradient-emerald text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    Compare Prices
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
            {error && <p className="text-red-500 text-sm mt-2 text-left px-2">{error}</p>}
          </form>

          {/* Example URLs */}
          <div className="flex flex-wrap justify-center gap-2 text-sm text-gray-500 mb-12">
            <span>Try:</span>
            {exampleUrls.map((example, i) => (
              <button
                key={i}
                onClick={() => setUrl(`https://${example}`)}
                className="text-emerald-600 hover:text-emerald-700 hover:underline transition-colors"
              >
                {example}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stores Banner */}
      <section className="py-12 bg-gray-50 border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4">
          <p className="text-center text-sm text-gray-500 mb-6 font-medium uppercase tracking-wider">
            Comparing prices across
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {stores.map((store, i) => (
              <div
                key={i}
                className="bg-white border border-gray-200 rounded-xl px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm hover:shadow-md transition-shadow cursor-default"
                style={{ borderTopColor: store.color, borderTopWidth: "3px" }}
              >
                {store.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Everything you need to shop smarter
            </h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              PriceRadar uses AI to match products across stores and track prices so you never overpay.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl border border-gray-100 hover:border-emerald-200 hover:shadow-lg transition-all group"
              >
                <div className={`w-12 h-12 ${feature.bg} ${feature.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-gray-900 text-lg mb-2">{feature.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trending Products */}
      <section className="py-24 px-4 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-12">
            <div>
              <h2 className="text-4xl font-bold text-gray-900 mb-2">Trending Deals</h2>
              <p className="text-gray-500">Top products with the biggest price drops today</p>
            </div>
            <Link
              href="/trending"
              className="hidden sm:flex items-center gap-2 text-emerald-600 font-medium hover:text-emerald-700 transition-colors"
            >
              View All <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {TRENDING_PRODUCTS.map((product) => (
              <Link
                key={product.id}
                href={`/compare?q=${encodeURIComponent(product.name)}`}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all group"
              >
                <div className="relative h-48 bg-gray-50 overflow-hidden">
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                  />
                  <div className="absolute top-3 left-3">
                    <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                      -{product.discount}%
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">
                    {product.brand} · {product.category}
                  </p>
                  <h3 className="font-semibold text-gray-900 mb-3 line-clamp-2">{product.name}</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xl font-bold text-gray-900">
                        {formatPrice(product.lowestPrice)}
                      </div>
                      <div className="text-sm text-gray-400 line-through">
                        {formatPrice(product.originalPrice)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">{product.stores} stores</div>
                      <div className="text-emerald-600 text-sm font-medium flex items-center gap-1 mt-1">
                        Compare <ChevronRight className="w-3 h-3" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">How PriceRadar Works</h2>
            <p className="text-xl text-gray-500">Three simple steps to find the best deal</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-8 left-1/3 right-1/3 h-0.5 bg-emerald-100" />
            {[
              {
                step: "01",
                title: "Paste the URL",
                description: "Copy any product link from Amazon, Flipkart, or any supported store and paste it in our search box.",
                icon: "🔗",
              },
              {
                step: "02",
                title: "AI Analyzes",
                description: "Our AI identifies the exact product, matches it across 50+ stores, and fetches real-time prices.",
                icon: "🤖",
              },
              {
                step: "03",
                title: "Save Money",
                description: "See all prices side-by-side, view price history, set alerts, and buy from the cheapest store.",
                icon: "💰",
              },
            ].map((step, i) => (
              <div key={i} className="text-center relative">
                <div className="w-16 h-16 gradient-emerald rounded-2xl flex items-center justify-center text-2xl mx-auto mb-6 shadow-lg">
                  {step.icon}
                </div>
                <div className="text-sm font-bold text-emerald-600 mb-2">{step.step}</div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{step.title}</h3>
                <p className="text-gray-500 leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Blog Section */}
      <section className="py-24 px-4 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-12">
            <div>
              <h2 className="text-4xl font-bold text-gray-900 mb-2">Buying Guides</h2>
              <p className="text-gray-500">Expert reviews and best-of lists to help you decide</p>
            </div>
            <Link href="/blog" className="hidden sm:flex items-center gap-2 text-emerald-600 font-medium hover:text-emerald-700 transition-colors">
              All Guides <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {BLOG_POSTS.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all group"
              >
                <div className="relative h-48 overflow-hidden">
                  <Image
                    src={post.imageUrl}
                    alt={post.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    sizes="(max-width: 768px) 100vw, 33vw"
                    unoptimized
                  />
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full font-medium">
                      {post.category}
                    </span>
                    <span className="text-xs text-gray-400">{post.readTime}</span>
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2 group-hover:text-emerald-600 transition-colors">
                    {post.title}
                  </h3>
                  <p className="text-sm text-gray-500 line-clamp-2">{post.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="gradient-emerald rounded-3xl p-12 text-center text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full translate-y-1/2 -translate-x-1/2" />
            <div className="relative">
              <h2 className="text-4xl font-bold mb-4">Start Saving Today</h2>
              <p className="text-emerald-100 text-lg mb-8 max-w-xl mx-auto">
                Join 500,000+ smart shoppers who save an average of ₹2,400 per month using PriceRadar.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/sign-up"
                  className="bg-white text-emerald-600 font-bold px-8 py-4 rounded-xl hover:bg-emerald-50 transition-colors"
                >
                  Create Free Account
                </Link>
                <Link
                  href="/compare"
                  className="border-2 border-white text-white font-bold px-8 py-4 rounded-xl hover:bg-white/10 transition-colors"
                >
                  Compare a Product
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg gradient-emerald flex items-center justify-center">
                  <Search className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-xl text-gray-900">PriceRadar</span>
              </div>
              <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
                {"India's smartest price comparison engine. Find the best deals across 50+ stores instantly."}
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link href="/compare" className="hover:text-emerald-600 transition-colors">Price Comparison</Link></li>
                <li><Link href="/trending" className="hover:text-emerald-600 transition-colors">Trending Deals</Link></li>
                <li><Link href="/dashboard" className="hover:text-emerald-600 transition-colors">Dashboard</Link></li>
                <li><Link href="/blog" className="hover:text-emerald-600 transition-colors">Buying Guides</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link href="/about" className="hover:text-emerald-600 transition-colors">About Us</Link></li>
                <li><Link href="/contact" className="hover:text-emerald-600 transition-colors">Contact</Link></li>
                <li><Link href="/privacy" className="hover:text-emerald-600 transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-emerald-600 transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-400">
              © 2024 PriceRadar. All rights reserved.
            </p>
            <p className="text-xs text-gray-400">
              * We may earn affiliate commissions when you buy through our links. This helps keep PriceRadar free.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
