import Link from "next/link";
import { Search } from "lucide-react";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl gradient-emerald flex items-center justify-center">
              <Search className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-2xl text-gray-900">PriceRadar</span>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
          <p className="text-gray-500 mt-1">Sign in to track prices and get alerts</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
          <p className="text-center text-gray-500 text-sm mb-6">
            Configure Clerk authentication to enable sign-in.
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Email</label>
              <input type="email" placeholder="your@email.com" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 transition-colors" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Password</label>
              <input type="password" placeholder="••••••••" className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-emerald-400 transition-colors" />
            </div>
            <button className="w-full gradient-emerald text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Sign In
            </button>
          </div>
          <p className="text-center text-sm text-gray-500 mt-6">
            {"Don't have an account?"}{" "}
            <Link href="/sign-up" className="text-emerald-600 font-medium hover:text-emerald-700">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
