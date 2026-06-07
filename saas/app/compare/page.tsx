"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft, Star, Truck, ExternalLink, TrendingDown,
  Bell, Heart, Share2, ShieldCheck, Zap, ChevronDown, ChevronUp, Filter, Search
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { MOCK_COMPARISON_DATA } from "@/lib/mock-data";
import { formatPrice, calculateDiscount, formatNumber } from "@/lib/utils";

type SortOption = "price_asc" | "price_desc" | "rating" | "delivery";
type FilterOption = "all" | "in_stock" | "cashback" | "emi";

function CompareContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url");
  searchParams.get("q");

  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<typeof MOCK_COMPARISON_DATA | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("price_asc");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [priceRange, setPriceRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [showSpecs, setShowSpecs] = useState(false);
  const [savedToWatchlist, setSavedToWatchlist] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (url) {
        const response = await fetch(`/api/compare?url=${encodeURIComponent(url)}`);
        if (response.ok) {
          const result = await response.json() as typeof MOCK_COMPARISON_DATA;
          setData(result);
        } else {
          setData(MOCK_COMPARISON_DATA);
        }
      } else {
        await new Promise((r) => setTimeout(r, 1500));
        setData(MOCK_COMPARISON_DATA);
      }
    } catch {
      setData(MOCK_COMPARISON_DATA);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredStores = data?.stores
    .filter((store) => {
      if (filter === "in_stock") return store.inStock;
      if (filter === "cashback") return store.cashback > 0;
      if (filter === "emi") return store.emiAvailable;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      if (sortBy === "delivery") return (a.deliveryDays || 99) - (b.deliveryDays || 99);
      return 0;
    }) || [];

  const lowestPrice = filteredStores.reduce((min, s) => (s.price < min ? s.price : min), Infinity);

  if (isLoading) {
    return <LoadingState url={url} />;
  }

  if (!data) {
    return <ErrorState />;
  }

  const product = data.product;
  const discount = calculateDiscount(data.stores[0]?.originalPrice || 0, lowestPrice);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Nav */}
      <nav className="sticky top-0 z-50 glass border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-gray-900 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg gradient-emerald flex items-center justify-center">
                <Search className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-lg text-gray-900">PriceRadar</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSavedToWatchlist(!savedToWatchlist)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                savedToWatchlist
                  ? "bg-red-50 text-red-500 border border-red-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <Heart className={`w-4 h-4 ${savedToWatchlist ? "fill-current" : ""}`} />
              <span className="hidden sm:inline">{savedToWatchlist ? "Saved" : "Save"}</span>
            </button>
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Share</span>
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Product Info */}
          <div className="lg:col-span-1 space-y-6">
            {/* Product Card */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="relative rounded-xl overflow-hidden bg-gray-50 mb-5 h-56">
                {product.imageUrl && (
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    fill
                    className="object-contain p-4"
                    sizes="(max-width: 1024px) 100vw, 33vw"
                    unoptimized
                  />
                )}
                {discount > 0 && (
                  <div className="absolute top-3 left-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                    -{discount}% OFF
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full font-medium border border-emerald-100">
                    {product.category}
                  </span>
                  <span className="text-xs text-gray-500">{product.brand}</span>
                </div>
                <h1 className="font-bold text-gray-900 text-lg leading-snug">{product.name}</h1>

                <div className="flex items-baseline gap-2 pt-1">
                  <span className="text-3xl font-extrabold text-gray-900">
                    {formatPrice(lowestPrice)}
                  </span>
                  {data.stores[0]?.originalPrice && (
                    <span className="text-gray-400 line-through text-sm">
                      {formatPrice(data.stores[0].originalPrice)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <TrendingDown className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-600 font-medium">Lowest price</span>
                  <span>across {data.stores.length} stores</span>
                </div>
              </div>
            </div>

            {/* AI Review Summary */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-emerald-500" />
                <h3 className="font-semibold text-gray-900 text-sm">AI Review Summary</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{product.reviewSummary}</p>
            </div>

            {/* Specifications */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button
                onClick={() => setShowSpecs(!showSpecs)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <h3 className="font-semibold text-gray-900">Specifications</h3>
                {showSpecs ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
              </button>
              {showSpecs && (
                <div className="px-5 pb-5 border-t border-gray-50">
                  {Object.entries(product.specifications).map(([key, value]) => (
                    <div key={key} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                      <span className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">{key}</span>
                      <span className="text-xs text-gray-900">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Price Alert */}
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 text-emerald-600" />
                <h3 className="font-semibold text-emerald-800">Set Price Alert</h3>
              </div>
              <p className="text-sm text-emerald-700 mb-4">Get notified when price drops below your target</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Target price (₹)"
                  className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-400"
                />
                <button className="gradient-emerald text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity">
                  Set Alert
                </button>
              </div>
            </div>
          </div>

          {/* Right: Comparison & History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Filters & Sort */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex gap-2 flex-wrap">
                {(["all", "in_stock", "cashback", "emi"] as FilterOption[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      filter === f
                        ? "gradient-emerald text-white shadow-sm"
                        : "bg-white border border-gray-200 text-gray-600 hover:border-emerald-300"
                    }`}
                  >
                    {f === "all" ? "All Stores" : f === "in_stock" ? "In Stock" : f === "cashback" ? "Cashback" : "EMI Available"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 sm:ml-auto">
                <Filter className="w-4 h-4 text-gray-400" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none bg-white text-gray-600"
                >
                  <option value="price_asc">Lowest Price</option>
                  <option value="price_desc">Highest Price</option>
                  <option value="rating">Best Rating</option>
                  <option value="delivery">Fastest Delivery</option>
                </select>
              </div>
            </div>

            {/* Store Comparison Cards */}
            <div className="space-y-3">
              {filteredStores.map((store) => {
                const isLowest = store.price === lowestPrice;
                return (
                  <div
                    key={store.id}
                    className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all hover:shadow-md ${
                      isLowest ? "border-emerald-200 ring-1 ring-emerald-200" : "border-gray-100"
                    }`}
                  >
                    {isLowest && (
                      <div className="gradient-emerald text-white text-xs font-bold px-4 py-1.5 flex items-center gap-2">
                        <Zap className="w-3 h-3" />
                        LOWEST PRICE
                      </div>
                    )}
                    <div className="p-4 sm:p-5">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100 font-bold text-gray-700 text-sm">
                            {store.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-gray-900">{store.name}</h3>
                              {!store.inStock && (
                                <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full border border-red-100">
                                  Out of Stock
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                              {store.rating && (
                                <span className="flex items-center gap-1">
                                  <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                                  {store.rating} ({formatNumber(store.reviewCount || 0)})
                                </span>
                              )}
                              {store.deliveryDays !== undefined && (
                                <span className="flex items-center gap-1">
                                  <Truck className="w-3.5 h-3.5" />
                                  {store.deliveryDays === 0 ? "Today" : `${store.deliveryDays} days`}
                                </span>
                              )}
                              {store.deliveryFee === 0 && (
                                <span className="flex items-center gap-1 text-emerald-600">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Free delivery
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-2xl font-extrabold text-gray-900">
                              {formatPrice(store.price)}
                            </div>
                            {store.originalPrice && store.originalPrice > store.price && (
                              <div className="text-xs text-gray-400 line-through">
                                {formatPrice(store.originalPrice)}
                              </div>
                            )}
                            {store.cashback > 0 && (
                              <div className="text-xs text-emerald-600 font-medium mt-0.5">
                                +{formatPrice(store.cashback)} cashback
                              </div>
                            )}
                          </div>

                          <a
                            href={store.affiliateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              fetch(`/api/track?store=${store.slug}&price=${store.price}`, { method: "POST" }).catch(() => {});
                            }}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                              store.inStock
                                ? isLowest
                                  ? "gradient-emerald text-white hover:opacity-90 shadow-sm"
                                  : "bg-gray-900 text-white hover:bg-gray-700"
                                : "bg-gray-100 text-gray-400 cursor-not-allowed"
                            }`}
                          >
                            {store.inStock ? "Buy Now" : "Unavailable"}
                            {store.inStock && <ExternalLink className="w-3.5 h-3.5" />}
                          </a>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-50">
                        {store.emiAvailable && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full border border-blue-100">
                            EMI Available
                          </span>
                        )}
                        {store.cashback > 0 && (
                          <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded-full border border-emerald-100">
                            {formatPrice(store.cashback)} Cashback
                          </span>
                        )}
                        {store.deliveryDays !== undefined && store.deliveryDays <= 2 && (
                          <span className="text-xs bg-orange-50 text-orange-600 px-2 py-1 rounded-full border border-orange-100">
                            Fast Delivery
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Price History Chart */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-gray-900">Price History</h3>
                <div className="flex gap-1">
                  {(["7d", "30d", "90d", "all"] as const).map((range) => (
                    <button
                      key={range}
                      onClick={() => setPriceRange(range)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                        priceRange === range
                          ? "gradient-emerald text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {range === "all" ? "All" : range.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.priceHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatPrice(v), "Price"]}
                    labelFormatter={(l: string) => new Date(l).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
                    contentStyle={{ borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ fill: "#10b981", r: 4 }}
                    activeDot={{ r: 6, fill: "#059669" }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-50 text-sm">
                <div>
                  <span className="text-gray-500">Lowest ever: </span>
                  <span className="font-semibold text-gray-900">
                    {formatPrice(Math.min(...data.priceHistory.map((p) => p.price)))}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Current: </span>
                  <span className="font-semibold text-emerald-600">{formatPrice(lowestPrice)}</span>
                </div>
              </div>
            </div>

            {/* Similar Products Placeholder */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4">Similar Products</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { name: "iPhone 15 Pro", price: 134900, img: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=200" },
                  { name: "Galaxy S24", price: 74999, img: "https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=200" },
                  { name: "OnePlus 12", price: 53999, img: "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=200" },
                  { name: "Pixel 8 Pro", price: 84999, img: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=200" },
                ].map((p, i) => (
                  <Link key={i} href={`/compare?q=${encodeURIComponent(p.name)}`} className="group">
                    <div className="bg-gray-50 rounded-xl overflow-hidden aspect-square relative mb-2">
                      <Image src={p.img} alt={p.name} fill className="object-cover group-hover:scale-105 transition-transform" sizes="150px" unoptimized />
                    </div>
                    <p className="text-xs font-medium text-gray-900 line-clamp-2 mb-1">{p.name}</p>
                    <p className="text-xs text-emerald-600 font-bold">{formatPrice(p.price)}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingState({ url }: { url: string | null }) {
  const [step, setStep] = useState(0);
  const steps = [
    "Fetching product details...",
    "Analyzing with AI...",
    "Searching 50+ stores...",
    "Matching products...",
    "Comparing prices...",
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => (s < steps.length - 1 ? s + 1 : s));
    }, 700);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-gray-100 p-10 max-w-md w-full mx-4 shadow-lg text-center">
        <div className="w-16 h-16 gradient-emerald rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse">
          <Search className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Finding Best Prices</h2>
        {url && (
          <p className="text-sm text-gray-500 mb-6 break-all line-clamp-2">{url}</p>
        )}
        <div className="space-y-3 mb-6">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 text-sm transition-all ${
                i < step ? "text-emerald-600" : i === step ? "text-gray-900 font-medium" : "text-gray-300"
              }`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                i < step ? "bg-emerald-500 text-white" : i === step ? "border-2 border-emerald-500 animate-spin border-t-transparent rounded-full" : "bg-gray-100"
              }`}>
                {i < step && "✓"}
              </div>
              {s}
            </div>
          ))}
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="gradient-emerald h-2 rounded-full transition-all duration-700"
            style={{ width: `${((step + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<LoadingState url={null} />}>
      <CompareContent />
    </Suspense>
  );
}

function ErrorState() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-gray-100 p-10 max-w-md w-full mx-4 shadow-lg text-center">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Product Not Found</h2>
        <p className="text-gray-500 mb-6">We could not find price information for this product. Please try another URL.</p>
        <Link href="/" className="gradient-emerald text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity inline-block">
          Try Another Product
        </Link>
      </div>
    </div>
  );
}
