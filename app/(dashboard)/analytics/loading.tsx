export default function AnalyticsLoading() {
  return (
    <div className="max-w-5xl animate-pulse">
      <div className="mb-8 h-8 w-32 bg-gray-200 rounded-lg" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="w-10 h-10 bg-gray-100 rounded-lg mb-3" />
            <div className="h-7 w-16 bg-gray-200 rounded mb-1" />
            <div className="h-4 w-24 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="h-5 w-40 bg-gray-200 rounded mb-6" />
        <div className="h-48 bg-gray-50 rounded-lg" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="h-5 w-32 bg-gray-200 rounded mb-6" />
        <div className="h-4 bg-gray-100 rounded-full mb-4" />
        <div className="flex gap-6">
          <div className="h-4 w-20 bg-gray-100 rounded" />
          <div className="h-4 w-20 bg-gray-100 rounded" />
        </div>
      </div>
    </div>
  )
}
