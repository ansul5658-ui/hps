import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, TrendingUp, MessageSquare, Heart } from 'lucide-react'
import { formatNumber } from '@/lib/utils'
import { FollowerChart } from '@/components/dashboard/follower-chart'

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: snapshots } = await supabase
    .from('analytics_snapshots')
    .select('*')
    .eq('user_id', user.id)
    .order('recorded_at', { ascending: true })
    .limit(30)

  const { data: dmStats } = await supabase
    .from('dm_logs')
    .select('status')
    .eq('user_id', user.id)

  const dmSent = dmStats?.filter(d => d.status === 'sent').length ?? 0
  const dmFailed = dmStats?.filter(d => d.status === 'failed').length ?? 0
  const dmTotal = dmStats?.length ?? 0
  const successRate = dmTotal > 0 ? Math.round((dmSent / dmTotal) * 100) : 0

  const latestSnapshot = snapshots?.[snapshots.length - 1]
  const prevSnapshot = snapshots?.[snapshots.length - 8]

  const followerGrowth = latestSnapshot && prevSnapshot
    ? latestSnapshot.followers_count - prevSnapshot.followers_count
    : null

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-500 mt-1">Track your growth and automation performance.</p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Followers',
            value: latestSnapshot ? formatNumber(latestSnapshot.followers_count) : (profile?.followers_count ? formatNumber(profile.followers_count) : '—'),
            sub: followerGrowth !== null ? `${followerGrowth >= 0 ? '+' : ''}${followerGrowth} this week` : 'Connect Instagram',
            icon: Users,
            color: 'text-violet-600',
            bg: 'bg-violet-50',
          },
          {
            label: 'Engagement Rate',
            value: latestSnapshot ? `${latestSnapshot.engagement_rate}%` : '—',
            sub: 'Average per post',
            icon: Heart,
            color: 'text-pink-600',
            bg: 'bg-pink-50',
          },
          {
            label: 'DMs Sent',
            value: formatNumber(dmSent),
            sub: `${dmFailed} failed`,
            icon: MessageSquare,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
          },
          {
            label: 'DM Success Rate',
            value: `${successRate}%`,
            sub: `${dmTotal} total attempts`,
            icon: TrendingUp,
            color: 'text-green-600',
            bg: 'bg-green-50',
          },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{value}</div>
              <div className="text-sm text-gray-500 mt-0.5">{label}</div>
              <div className="text-xs text-gray-400 mt-1">{sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Follower Growth (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshots && snapshots.length > 1 ? (
            <FollowerChart data={snapshots} />
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              Data will appear once your Instagram is connected and syncing.
            </div>
          )}
        </CardContent>
      </Card>

      {/* DM performance */}
      <Card>
        <CardHeader>
          <CardTitle>DM Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-green-500 rounded-full transition-all"
                style={{ width: `${successRate}%` }}
              />
            </div>
            <div className="text-sm font-medium text-gray-700 w-16 text-right">{successRate}% success</div>
          </div>
          <div className="flex gap-6 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-400 rounded-full" />
              <span className="text-gray-600">{dmSent} sent</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-400 rounded-full" />
              <span className="text-gray-600">{dmFailed} failed</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
