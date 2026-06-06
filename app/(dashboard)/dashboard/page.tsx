import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Users, MessageSquare, Sparkles, TrendingUp, Link2, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const { data: dmRules } = await supabase
    .from('dm_rules')
    .select('id, name, is_active, sent_count')
    .eq('user_id', user.id)
    .limit(5)

  const { data: recentLogs } = await supabase
    .from('dm_logs')
    .select('id, recipient_username, message, status, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5)

  const totalDmsSent = dmRules?.reduce((sum, r) => sum + (r.sent_count || 0), 0) ?? 0
  const activeRules = dmRules?.filter(r => r.is_active).length ?? 0
  const isConnected = !!profile?.instagram_username

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}! 👋
          </h1>
          <p className="text-gray-500 mt-1">Here&apos;s what&apos;s happening with your account.</p>
        </div>
        {!isConnected && (
          <Link href="/settings">
            <Button variant="gradient" className="gap-2">
              <Link2 className="w-4 h-4" />
              Connect Instagram
            </Button>
          </Link>
        )}
      </div>

      {!isConnected && (
        <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
          <strong>Connect your Instagram account</strong> to start automating DMs and tracking analytics.{' '}
          <Link href="/settings" className="underline font-medium">Go to Settings →</Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'DMs Sent', value: totalDmsSent, icon: MessageSquare, color: 'text-violet-600', bg: 'bg-violet-50' },
          { label: 'Active Rules', value: activeRules, icon: Sparkles, color: 'text-pink-600', bg: 'bg-pink-50' },
          { label: 'Followers', value: profile?.followers_count ?? '—', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Eng. Rate', value: profile?.engagement_rate ? `${profile.engagement_rate}%` : '—', icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{value}</div>
              <div className="text-sm text-gray-500 mt-0.5">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DM Rules */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>DM Rules</CardTitle>
            <Link href="/auto-dm">
              <Button variant="ghost" size="sm" className="gap-1">
                Manage <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {dmRules && dmRules.length > 0 ? (
              <div className="space-y-3">
                {dmRules.map(rule => (
                  <div key={rule.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{rule.name}</div>
                      <div className="text-xs text-gray-400">{rule.sent_count} sent</div>
                    </div>
                    <Badge variant={rule.is_active ? 'success' : 'secondary'}>
                      {rule.is_active ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No DM rules yet.</p>
                <Link href="/auto-dm">
                  <Button size="sm" variant="outline" className="mt-3">Create your first rule</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent DMs */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent DMs</CardTitle>
            <Badge variant="secondary">{recentLogs?.length ?? 0} recent</Badge>
          </CardHeader>
          <CardContent>
            {recentLogs && recentLogs.length > 0 ? (
              <div className="space-y-3">
                {recentLogs.map(log => (
                  <div key={log.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                      {log.recipient_username[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">@{log.recipient_username}</div>
                      <div className="text-xs text-gray-400 truncate">{log.message}</div>
                    </div>
                    <Badge variant={log.status === 'sent' ? 'success' : 'destructive'} className="shrink-0">
                      {log.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <p className="text-sm">No DMs sent yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
