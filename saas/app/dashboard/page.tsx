"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BarChart3, Bell, Heart, TrendingDown, Package, ChevronRight,
  Plus, Search, Settings, LogOut, Home, Trash2
} from "lucide-react";
import { TRENDING_PRODUCTS } from "@/lib/mock-data";
import { formatPrice } from "@/lib/utils";

const MOCK_WATCHLIST = [
  {
    id: "1",
    name: "Apple iPhone 15 128GB Black",
    brand: "Apple",
    imageUrl: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=300",
    currentPrice: 67999,
    targetPrice: 65000,
    originalPrice: 79900,
    lowestEver: 64999,
    stores: 5,
    priceDropped: true,
  },
  {
    id: "2",
    name: "Sony WH-1000XM5 Wireless Headphones",
    brand: "Sony",
    imageUrl: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=300",
    currentPrice: 24990,
    targetPrice: 22000,
    originalPrice: 34990,
    lowestEver: 21999,
    stores: 3,
    priceDropped: false,
  },
  {
    id: "3",
    name: "Apple MacBook Air M3 13-inch",
    brand: "Apple",
    imageUrl: "https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=300",
    currentPrice: 114900,
    targetPrice: 110000,
    originalPrice: 134900,
    lowestEver: 109999,
    stores: 3,
    priceDropped: false,
  },
];

const MOCK_NOTIFICATIONS = [
  {
    id: "1",
    type: "PRICE_DROP",
    title: "Price Drop Alert!",
    message: "iPhone 15 dropped to ₹67,999 on Amazon — your target is ₹65,000",
    time: "2 hours ago",
    read: false,
  },
  {
    id: "2",
    type: "PRICE_ALERT",
    title: "Price Rising",
    message: "Sony WH-1000XM5 price increased by ₹2,000 on Flipkart",
    time: "1 day ago",
    read: true,
  },
  {
    id: "3",
    type: "BACK_IN_STOCK",
    title: "Back in Stock",
    message: "iPhone 15 is now available on Reliance Digital",
    time: "2 days ago",
    read: true,
  },
];

const NAV_ITEMS = [
  { icon: Home, label: "Home", href: "/" },
  { icon: BarChart3, label: "Dashboard", href: "/dashboard", active: true },
  { icon: Heart, label: "Watchlist", href: "/dashboard/watchlist" },
  { icon: Bell, label: "Alerts", href: "/dashboard/alerts" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"watchlist" | "notifications" | "trending">("watchlist");
  const [watchlist, setWatchlist] = useState(MOCK_WATCHLIST);

  const stats = [
    { label: "Saved Products", value: watchlist.length.toString(), icon: Heart, color: "text-red-500", bg: "bg-red-50" },
    { label: "Active Alerts", value: "3", icon: Bell, color: "text-yellow-500", bg: "bg-yellow-50" },
    { label: "Price Drops", value: "1", icon: TrendingDown, color: "text-emerald-500", bg: "bg-emerald-50" },
    { label: "Stores Tracked", value: "50+", icon: Package, color: "text-blue-500", bg: "bg-blue-50" },
  ];

  const removeFromWatchlist = (id: string) => {
    setWatchlist((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-100 fixed inset-y-0 left-0 z-40">
        <div className="p-6 border-b border-gray-100">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-emerald flex items-center justify-center">
              <Search className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900">PriceRadar</span>
          </Link>
        </div>

        <div className="flex-1 p-4">
          <div className="mb-6">
            <div className="w-10 h-10 rounded-full gradient-emerald flex items-center justify-center text-white font-bold text-sm mb-2">
              A
            </div>
            <p className="font-semibold text-gray-900 text-sm">Ansul</p>
            <p className="text-xs text-gray-400">ansul5658@gmail.com</p>
          </div>

          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  item.active
                    ? "gradient-emerald text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-gray-100">
          <button className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 w-full transition-colors">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64">
        {/* Mobile Header */}
        <header className="lg:hidden glass border-b border-gray-100 sticky top-0 z-30 px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg gradient-emerald flex items-center justify-center">
              <Search className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-gray-900">PriceRadar</span>
          </Link>
          <Link href="/" className="text-gray-500 text-sm">← Home</Link>
        </header>

        <div className="p-6 lg:p-8 max-w-5xl mx-auto">
          {/* Page Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
              <p className="text-gray-500 mt-1">Track your products and price alerts</p>
            </div>
            <Link
              href="/"
              className="gradient-emerald text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {stats.map((stat, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <div className={`w-10 h-10 ${stat.bg} ${stat.color} rounded-xl flex items-center justify-center mb-3`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
            {(["watchlist", "notifications", "trending"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
                  activeTab === tab
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab}
                {tab === "notifications" && (
                  <span className="ml-1.5 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">1</span>
                )}
              </button>
            ))}
          </div>

          {/* Watchlist */}
          {activeTab === "watchlist" && (
            <div className="space-y-3">
              {watchlist.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
                  <Heart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="font-semibold text-gray-900 mb-2">No products saved</h3>
                  <p className="text-gray-500 text-sm mb-6">Start comparing products and save them to track prices.</p>
                  <Link href="/" className="gradient-emerald text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity inline-block">
                    Find Products
                  </Link>
                </div>
              ) : (
                watchlist.map((item) => (
                  <div
                    key={item.id}
                    className={`bg-white rounded-2xl border shadow-sm p-4 flex gap-4 items-center transition-all ${
                      item.priceDropped ? "border-emerald-200 ring-1 ring-emerald-100" : "border-gray-100"
                    }`}
                  >
                    {item.priceDropped && (
                      <div className="absolute -top-2 left-4 bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        Price Dropped!
                      </div>
                    )}
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-gray-50 shrink-0">
                      <Image src={item.imageUrl} alt={item.name} fill className="object-cover" sizes="64px" unoptimized />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-400 font-medium">{item.brand}</p>
                          <h3 className="font-semibold text-gray-900 text-sm line-clamp-1">{item.name}</h3>
                        </div>
                        <button
                          onClick={() => removeFromWatchlist(item.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        <div>
                          <span className="text-lg font-bold text-gray-900">{formatPrice(item.currentPrice)}</span>
                          {item.originalPrice > item.currentPrice && (
                            <span className="text-xs text-gray-400 line-through ml-1">{formatPrice(item.originalPrice)}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          Target: <span className={item.currentPrice <= item.targetPrice ? "text-emerald-600 font-semibold" : "text-gray-900 font-medium"}>{formatPrice(item.targetPrice)}</span>
                        </div>
                        <div className="text-xs text-gray-400">Lowest ever: {formatPrice(item.lowestEver)}</div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                        <div
                          className={`h-1.5 rounded-full transition-all ${
                            item.currentPrice <= item.targetPrice ? "bg-emerald-500" : "bg-yellow-400"
                          }`}
                          style={{
                            width: `${Math.min(100, ((item.originalPrice - item.currentPrice) / (item.originalPrice - item.targetPrice)) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    <Link
                      href={`/compare?q=${encodeURIComponent(item.name)}`}
                      className="shrink-0 gradient-emerald text-white text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1"
                    >
                      View <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Notifications */}
          {activeTab === "notifications" && (
            <div className="space-y-3">
              {MOCK_NOTIFICATIONS.map((notif) => (
                <div
                  key={notif.id}
                  className={`bg-white rounded-2xl border p-4 shadow-sm transition-all ${
                    !notif.read ? "border-emerald-200 ring-1 ring-emerald-100" : "border-gray-100"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      notif.type === "PRICE_DROP" ? "bg-emerald-50 text-emerald-500" :
                      notif.type === "BACK_IN_STOCK" ? "bg-blue-50 text-blue-500" :
                      "bg-yellow-50 text-yellow-500"
                    }`}>
                      {notif.type === "PRICE_DROP" ? <TrendingDown className="w-4 h-4" /> :
                       notif.type === "BACK_IN_STOCK" ? <Package className="w-4 h-4" /> :
                       <Bell className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900 text-sm">{notif.title}</h4>
                        {!notif.read && <span className="w-2 h-2 bg-emerald-500 rounded-full" />}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{notif.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{notif.time}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trending */}
          {activeTab === "trending" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {TRENDING_PRODUCTS.map((product) => (
                <Link
                  key={product.id}
                  href={`/compare?q=${encodeURIComponent(product.name)}`}
                  className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all flex gap-4 items-center group"
                >
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-gray-50 shrink-0">
                    <Image src={product.imageUrl} alt={product.name} fill className="object-cover" sizes="64px" unoptimized />
                    <div className="absolute top-1 left-1 bg-red-500 text-white text-xs font-bold px-1 py-0.5 rounded-full">
                      -{product.discount}%
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400">{product.brand}</p>
                    <h3 className="font-semibold text-gray-900 text-sm line-clamp-1 group-hover:text-emerald-600 transition-colors">{product.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-bold text-gray-900">{formatPrice(product.lowestPrice)}</span>
                      <span className="text-xs text-gray-400 line-through">{formatPrice(product.originalPrice)}</span>
                    </div>
                    <p className="text-xs text-gray-400">{product.stores} stores</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-emerald-500 transition-colors" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
