import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getOAuthUrl } from '@/lib/instagram'
import { PLANS } from '@/lib/stripe'
import { Camera, CreditCard, CheckCircle } from 'lucide-react'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const currentPlan = profile?.plan ?? 'free'
  const instagramOAuthUrl = getOAuthUrl()

  return (
    <div className="max-w-3xl space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your account, Instagram connection, and billing.</p>
      </div>

      {/* Instagram */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-pink-500" />
            Instagram Account
          </CardTitle>
          <CardDescription>Connect your Instagram Business or Creator account.</CardDescription>
        </CardHeader>
        <CardContent>
          {profile?.instagram_username ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-orange-400 rounded-full flex items-center justify-center text-white font-bold">
                  {profile.instagram_username[0]?.toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-gray-900">@{profile.instagram_username}</div>
                  <div className="text-sm text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Connected
                  </div>
                </div>
              </div>
              <a href={instagramOAuthUrl}>
                <Button variant="outline" size="sm">Reconnect</Button>
              </a>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">No Instagram account connected yet.</p>
              <a href={instagramOAuthUrl}>
                <Button variant="gradient" className="gap-2">
                  <Camera className="w-4 h-4" />
                  Connect Instagram
                </Button>
              </a>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4">
            Requires an Instagram Business or Creator account. Personal accounts are not supported by the Instagram API.
          </p>
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-violet-500" />
            Billing & Plan
          </CardTitle>
          <CardDescription>Your current plan and usage limits.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-6">
            <Badge variant="default" className="text-sm px-3 py-1">
              {PLANS[currentPlan as keyof typeof PLANS].name}
            </Badge>
            <span className="text-gray-500 text-sm">
              ${PLANS[currentPlan as keyof typeof PLANS].price}/month
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            {Object.entries(PLANS)
              .filter(([key]) => key !== 'free')
              .map(([key, plan]) => (
                <div
                  key={key}
                  className={`p-4 rounded-xl border ${currentPlan === key ? 'border-violet-400 bg-violet-50' : 'border-gray-200'}`}
                >
                  <div className="font-semibold text-gray-900 mb-1">{plan.name}</div>
                  <div className="text-lg font-bold text-gray-900 mb-3">${plan.price}<span className="text-xs font-normal text-gray-400">/mo</span></div>
                  {currentPlan !== key && (
                    <form action="/api/stripe/checkout" method="POST">
                      <input type="hidden" name="priceId" value={plan.priceId ?? ''} />
                      <Button size="sm" variant={key === 'pro' ? 'gradient' : 'outline'} className="w-full" type="submit">
                        Upgrade
                      </Button>
                    </form>
                  )}
                  {currentPlan === key && (
                    <div className="text-xs text-violet-600 font-medium">Current plan</div>
                  )}
                </div>
              ))}
          </div>

          {profile?.stripe_customer_id && (
            <form action="/api/stripe/portal" method="POST">
              <Button variant="outline" type="submit">Manage billing →</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-50">
              <span className="text-sm text-gray-500">Email</span>
              <span className="text-sm font-medium text-gray-900">{user.email}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-500">Name</span>
              <span className="text-sm font-medium text-gray-900">{profile?.full_name ?? '—'}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
