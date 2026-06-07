import Link from "next/link";
import Image from "next/image";
import { Search, BookOpen, ArrowLeft, Clock, ChevronRight } from "lucide-react";
import { BLOG_POSTS } from "@/lib/mock-data";

export default function BlogPage() {
  const featured = BLOG_POSTS[0];
  const rest = BLOG_POSTS.slice(1);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-50 glass border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center gap-4">
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
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full text-sm font-medium mb-4 border border-blue-100">
            <BookOpen className="w-4 h-4" />
            Expert Buying Guides
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Buying Guides & Reviews</h1>
          <p className="text-gray-500 text-lg">Expert advice to help you make smarter purchase decisions</p>
        </div>

        {/* Featured Post */}
        {featured && (
          <Link href={`/blog/${featured.slug}`} className="block bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl transition-all mb-8 group">
            <div className="grid md:grid-cols-2">
              <div className="relative h-64 md:h-auto">
                <Image src={featured.imageUrl} alt={featured.title} fill className="object-cover group-hover:scale-105 transition-transform duration-500" sizes="50vw" unoptimized />
              </div>
              <div className="p-8 flex flex-col justify-center">
                <div className="flex items-center gap-3 mb-4">
                  <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-emerald-100">
                    Featured
                  </span>
                  <span className="bg-gray-100 text-gray-600 text-xs font-medium px-3 py-1.5 rounded-full">
                    {featured.category}
                  </span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3 group-hover:text-emerald-600 transition-colors">
                  {featured.title}
                </h2>
                <p className="text-gray-500 mb-6 leading-relaxed">{featured.excerpt}</p>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Clock className="w-4 h-4" />
                  {featured.readTime}
                </div>
              </div>
            </div>
          </Link>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rest.map((post) => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl transition-all group"
            >
              <div className="relative h-52 overflow-hidden">
                <Image src={post.imageUrl} alt={post.title} fill className="object-cover group-hover:scale-105 transition-transform duration-300" sizes="50vw" unoptimized />
              </div>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="bg-emerald-50 text-emerald-700 text-xs font-medium px-2 py-1 rounded-full">{post.category}</span>
                  <span className="flex items-center gap-1 text-xs text-gray-400"><Clock className="w-3 h-3" />{post.readTime}</span>
                </div>
                <h3 className="font-bold text-gray-900 mb-2 group-hover:text-emerald-600 transition-colors text-lg">{post.title}</h3>
                <p className="text-sm text-gray-500 line-clamp-2 mb-4">{post.excerpt}</p>
                <div className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                  Read Guide <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
