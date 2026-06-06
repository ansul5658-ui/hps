export default function DashboardLoading() {
  return (
    <div className="max-w-6xl animate-pulse">
      <div className="mb-8 h-8 w-64 bg-gray-200 rounded-lg" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="w-10 h-10 bg-gray-100 rounded-lg mb-3" />
            <div className="h-7 w-16 bg-gray-200 rounded mb-1" />
            <div className="h-4 w-24 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[0, 1].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="h-5 w-24 bg-gray-200 rounded mb-6" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">
                <div className="space-y-1.5">
                  <div className="h-4 w-32 bg-gray-200 rounded" />
                  <div className="h-3 w-20 bg-gray-100 rounded" />
                </div>
                <div className="h-5 w-14 bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
