import Link from "next/link";
import Image from "next/image";
import { Search, TrendingUp, ChevronRight, ArrowLeft } from "lucide-react";
import { TRENDING_PRODUCTS } from "@/lib/mock-data";
import { formatPrice } from "@/lib/utils";

const CATEGORIES = ["All", "Smartphones", "Laptops", "Audio", "Tablets", "Home Appliances", "Wearables"];

export default function TrendingPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-50 glass border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-500 hover:text-gray-900 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg gradient-emerald flex items-center justify-center">
                <Search className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-lg text-gray-900">PriceRadar</span>
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-orange-50 text-orange-600 px-4 py-2 rounded-full text-sm font-medium mb-4 border border-orange-100">
            <TrendingUp className="w-4 h-4" />
            Updated Daily
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Trending Deals</h1>
          <p className="text-gray-500 text-lg">Top products with the biggest price drops today</p>
        </div>

        <div className="flex gap-2 flex-wrap justify-center mb-10">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                cat === "All"
                  ? "gradient-emerald text-white shadow-sm"
                  : "bg-white border border-gray-200 text-gray-600 hover:border-emerald-300 hover:text-emerald-600"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...TRENDING_PRODUCTS, ...TRENDING_PRODUCTS].slice(0, 9).map((product, i) => (
            <Link
              key={`${product.id}-${i}`}
              href={`/compare?q=${encodeURIComponent(product.name)}`}
              className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all group"
            >
              <div className="relative h-52 bg-gray-50 overflow-hidden">
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  sizes="(max-width: 768px) 100vw, 33vw"
                  unoptimized
                />
                <div className="absolute top-3 left-3">
                  <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                    -{product.discount}%
                  </span>
                </div>
                <div className="absolute top-3 right-3">
                  <span className="bg-white/90 text-gray-700 text-xs font-medium px-2 py-1 rounded-full backdrop-blur-sm">
                    {product.category}
                  </span>
                </div>
              </div>
              <div className="p-5">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">{product.brand}</p>
                <h3 className="font-semibold text-gray-900 mb-3 line-clamp-2 group-hover:text-emerald-600 transition-colors">
                  {product.name}
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{formatPrice(product.lowestPrice)}</div>
                    <div className="text-sm text-gray-400 line-through">{formatPrice(product.originalPrice)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500 mb-1">{product.stores} stores</div>
                    <div className="gradient-emerald text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1">
                      Compare <ChevronRight className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
