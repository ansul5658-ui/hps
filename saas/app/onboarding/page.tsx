import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getOAuthUrl } from '@/lib/instagram'
import { Button } from '@/components/ui/button'
import { Camera, MessageSquare, BarChart3, Sparkles, CheckCircle, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const steps = [
  { icon: Camera, title: 'Connect Instagram', description: 'Link your Business or Creator account via Instagram OAuth.' },
  { icon: MessageSquare, title: 'Create a DM rule', description: 'Set a trigger and write (or AI-generate) your first message.' },
  { icon: Sparkles, title: 'AI does the rest', description: 'GrowKarle sends personalized DMs and tracks every result.' },
  { icon: BarChart3, title: 'Watch the numbers', description: 'See follower growth, engagement rate, and DM stats in one place.' },
]

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('instagram_username')
    .eq('id', user.id)
    .single()

  // Already connected — skip onboarding
  if (profile?.instagram_username) redirect('/dashboard')

  const oauthUrl = getOAuthUrl()

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-pink-50 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Welcome to GrowKarle!</h1>
          <p className="text-gray-500 text-lg">You&apos;re one step away from automating your Instagram presence.</p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-2 gap-4 mb-10">
          {steps.map(({ icon: Icon, title, description }, i) => (
            <div key={title} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex gap-4">
              <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-violet-400">STEP {i + 1}</span>
                </div>
                <h3 className="font-semibold text-gray-900 text-sm mb-1">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-orange-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Camera className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Connect your Instagram</h2>
          <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
            Requires an Instagram Business or Creator account. Takes about 30 seconds.
          </p>

          <div className="flex flex-col items-center gap-3">
            <a href={oauthUrl} className="w-full max-w-xs">
              <Button variant="gradient" size="lg" className="w-full gap-2">
                <Camera className="w-5 h-5" />
                Connect Instagram
                <ArrowRight className="w-4 h-4" />
              </Button>
            </a>
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Skip for now →
            </Link>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-50">
            <ul className="flex flex-col gap-1.5 text-left max-w-xs mx-auto">
              {['Read-only access to your profile stats', 'Send DMs only to users who message first', 'You can revoke access any time'].map(t => (
                <li key={t} className="flex items-center gap-2 text-xs text-gray-500">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
