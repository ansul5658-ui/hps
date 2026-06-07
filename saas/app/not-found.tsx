import Link from "next/link";
import { Search, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 gradient-emerald rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl">
          <Search className="w-10 h-10 text-white" />
        </div>
        <div className="text-8xl font-black text-gray-100 mb-4">404</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Page Not Found</h1>
        <p className="text-gray-500 mb-8 leading-relaxed">
          {"The page you're looking for doesn't exist. Try searching for a product instead."}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="gradient-emerald text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity flex items-center gap-2 justify-center">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <Link href="/compare" className="border-2 border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:border-emerald-300 transition-colors text-center">
            Compare a Product
          </Link>
        </div>
      </div>
    </div>
  );
}
