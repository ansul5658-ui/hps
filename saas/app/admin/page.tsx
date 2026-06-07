"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart3, Users, Package, MousePointer, DollarSign,
  Store, Bell, Settings, Search, LogOut, ChevronRight, ArrowUpRight,
  ArrowDownRight, Activity
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";
import { formatPrice, formatNumber } from "@/lib/utils";

const REVENUE_DATA = [
  { month: "Jan", revenue: 42000, clicks: 1240 },
  { month: "Feb", revenue: 58000, clicks: 1890 },
  { month: "Mar", revenue: 51000, clicks: 1650 },
  { month: "Apr", revenue: 74000, clicks: 2340 },
  { month: "May", revenue: 89000, clicks: 2890 },
  { month: "Jun", revenue: 112000, clicks: 3420 },
  { month: "Jul", revenue: 134000, clicks: 4120 },
];

const STORE_DATA = [
  { name: "Amazon", revenue: 45000, clicks: 1840, commission: 4.0, color: "#FF9900" },
  { name: "Flipkart", revenue: 38000, clicks: 1560, commission: 6.0, color: "#2874F0" },
  { name: "Myntra", revenue: 22000, clicks: 980, commission: 8.0, color: "#FF3F6C" },
  { name: "Croma", revenue: 15000, clicks: 620, commission: 2.5, color: "#6CC04A" },
  { name: "Nykaa", revenue: 14000, clicks: 580, commission: 5.0, color: "#FC2779" },
];

const PIE_COLORS = ["#FF9900", "#2874F0", "#FF3F6C", "#6CC04A", "#FC2779"];

const RECENT_CLICKS = [
  { id: "1", product: "iPhone 15 128GB", store: "Amazon", price: 67999, time: "2 min ago", converted: true },
  { id: "2", product: "Sony WH-1000XM5", store: "Flipkart", price: 24990, time: "5 min ago", converted: false },
  { id: "3", product: "MacBook Air M3", store: "Croma", price: 114900, time: "12 min ago", converted: true },
  { id: "4", product: "Samsung S24 Ultra", store: "Amazon", price: 109999, time: "18 min ago", converted: false },
  { id: "5", product: "OnePlus 12", store: "Myntra", price: 53999, time: "25 min ago", converted: true },
];

const NAV_ITEMS = [
  { icon: BarChart3, label: "Overview", id: "overview" },
  { icon: Package, label: "Products", id: "products" },
  { icon: Users, label: "Users", id: "users" },
  { icon: Store, label: "Stores", id: "stores" },
  { icon: MousePointer, label: "Clicks", id: "clicks" },
  { icon: DollarSign, label: "Revenue", id: "revenue" },
  { icon: Bell, label: "Alerts", id: "alerts" },
  { icon: Settings, label: "Settings", id: "settings" },
];

export default function AdminPage() {
  const [activeSection, setActiveSection] = useState("overview");

  const kpis = [
    {
      title: "Total Revenue",
      value: "₹5.58L",
      change: "+23.4%",
      up: true,
      icon: DollarSign,
      color: "text-emerald-500",
      bg: "bg-emerald-50",
      sub: "This month: ₹1.34L",
    },
    {
      title: "Total Clicks",
      value: "17.1K",
      change: "+18.7%",
      up: true,
      icon: MousePointer,
      color: "text-blue-500",
      bg: "bg-blue-50",
      sub: "Conversion: 32%",
    },
    {
      title: "Active Users",
      value: "4,891",
      change: "+12.1%",
      up: true,
      icon: Users,
      color: "text-purple-500",
      bg: "bg-purple-50",
      sub: "500K total users",
    },
    {
      title: "Products Tracked",
      value: "10.2M",
      change: "+5.3%",
      up: true,
      icon: Package,
      color: "text-orange-500",
      bg: "bg-orange-50",
      sub: "Across 50+ stores",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Admin Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-gray-900 fixed inset-y-0 left-0 z-40">
        <div className="p-6 border-b border-gray-800">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-emerald flex items-center justify-center">
              <Search className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-white text-sm">PriceRadar</span>
              <div className="text-xs text-gray-400">Admin Panel</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === item.id
                  ? "gradient-emerald text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <Link href="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors w-full">
            <LogOut className="w-4 h-4" />
            Exit Admin
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64">
        <header className="bg-white border-b border-gray-100 sticky top-0 z-30 px-6 h-16 flex items-center justify-between">
          <div>
            <h1 className="font-bold text-gray-900 capitalize">{activeSection}</h1>
            <p className="text-xs text-gray-400">Last updated: just now</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
              <Activity className="w-3.5 h-3.5" />
              Live
            </div>
            <div className="w-8 h-8 rounded-full gradient-emerald flex items-center justify-center text-white font-bold text-xs">
              A
            </div>
          </div>
        </header>

        <div className="p-6 lg:p-8">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
            {kpis.map((kpi, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-10 h-10 ${kpi.bg} ${kpi.color} rounded-xl flex items-center justify-center`}>
                    <kpi.icon className="w-5 h-5" />
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-semibold ${kpi.up ? "text-emerald-600" : "text-red-500"}`}>
                    {kpi.up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                    {kpi.change}
                  </div>
                </div>
                <div className="text-2xl font-extrabold text-gray-900 mb-1">{kpi.value}</div>
                <div className="text-xs text-gray-500 font-medium">{kpi.title}</div>
                <div className="text-xs text-gray-400 mt-1">{kpi.sub}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
            {/* Revenue Chart */}
            <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-gray-900">Revenue & Clicks</h3>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />Revenue</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />Clicks</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={REVENUE_DATA} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#9ca3af" }} tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                  <Tooltip
                    formatter={(v: number, name: string) => [name === "revenue" ? formatPrice(v) : formatNumber(v), name === "revenue" ? "Revenue" : "Clicks"]}
                    contentStyle={{ borderRadius: "12px", border: "1px solid #e5e7eb" }}
                  />
                  <Bar yAxisId="left" dataKey="revenue" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Bar yAxisId="right" dataKey="clicks" fill="#60a5fa" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Store Breakdown Pie */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-6">Revenue by Store</h3>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={STORE_DATA}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    dataKey="revenue"
                    paddingAngle={3}
                  >
                    {STORE_DATA.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [formatPrice(v), "Revenue"]} contentStyle={{ borderRadius: "8px" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 mt-4">
                {STORE_DATA.map((store, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i] }} />
                      <span className="text-gray-600">{store.name}</span>
                    </div>
                    <span className="font-semibold text-gray-900">{formatPrice(store.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Store Performance Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-6">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Affiliate Performance</h3>
              <button className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1">
                Export <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-50">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Store</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Revenue</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Clicks</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Commission</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">RPM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {STORE_DATA.map((store, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: store.color }}>
                            {store.name.substring(0, 2)}
                          </div>
                          <span className="font-medium text-gray-900 text-sm">{store.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-900 text-sm">{formatPrice(store.revenue)}</td>
                      <td className="px-6 py-4 text-right text-gray-600 text-sm">{formatNumber(store.clicks)}</td>
                      <td className="px-6 py-4 text-right">
                        <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-1 rounded-full">
                          {store.commission}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-gray-600 text-sm">
                        {formatPrice(Math.round(store.revenue / store.clicks * 1000))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Clicks */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Recent Clicks</h3>
              <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                <Activity className="w-3 h-3" />
                Live feed
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {RECENT_CLICKS.map((click) => (
                <div key={click.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${click.converted ? "bg-emerald-500" : "bg-gray-300"}`} />
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{click.product}</p>
                      <p className="text-xs text-gray-400">{click.store} · {click.time}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900 text-sm">{formatPrice(click.price)}</span>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      click.converted
                        ? "bg-emerald-50 text-emerald-600 border border-emerald-100"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {click.converted ? "Converted" : "Clicked"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
