import Link from "next/link";
import { Search, Check } from "lucide-react";

export default function SignUpPage() {
  const benefits = [
    "Track price history across 50+ stores",
    "Get instant price drop alerts",
    "Save products to watchlists",
    "Free forever — no credit card needed",
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl gradient-emerald flex items-center justify-center">
              <Search className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-2xl text-gray-900">PriceRadar</span>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Start saving money today</h1>
          <p className="text-gray-500 mb-8">Join 500,000+ smart shoppers who never overpay.</p>
          <ul className="space-y-3">
            {benefits.map((b, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 gradient-emerald rounded-full flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </div>
                <span className="text-gray-700 text-sm">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Create your account</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">First Name</label>
                <input type="text" placeholder="John" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 transition-colors" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Last Name</label>
                <input type="text" placeholder="Doe" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 transition-colors" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Email</label>
              <input type="email" placeholder="your@email.com" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 transition-colors" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Password</label>
              <input type="password" placeholder="Min. 8 characters" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 transition-colors" />
            </div>
            <button className="w-full gradient-emerald text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Create Account
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 mt-4">
            By signing up, you agree to our{" "}
            <Link href="/terms" className="text-emerald-600">Terms</Link> and{" "}
            <Link href="/privacy" className="text-emerald-600">Privacy Policy</Link>
          </p>
          <p className="text-center text-sm text-gray-500 mt-4">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-emerald-600 font-medium hover:text-emerald-700">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
