import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { MessageSquare, BarChart3, Sparkles, Zap, CheckCircle } from 'lucide-react'

const features = [
  {
    icon: MessageSquare,
    title: 'Auto DM Rules',
    description: 'Send personalized DMs automatically when someone follows you, replies to your story, or uses a keyword in comments.',
  },
  {
    icon: Sparkles,
    title: 'AI-Powered Replies',
    description: 'Generate authentic, on-brand replies to DMs and comments with Claude AI — no more spending hours in your inbox.',
  },
  {
    icon: BarChart3,
    title: 'Growth Analytics',
    description: 'Track followers, engagement rate, DM stats, and post performance in one clean dashboard.',
  },
]

const plans = [
  { name: 'Free', price: '$0', features: ['1 DM rule', '10 DMs/day', '20 AI replies/month'] },
  { name: 'Starter', price: '$29', features: ['5 DM rules', '100 DMs/day', '200 AI replies/month', 'Comment replies'], highlight: true },
  { name: 'Pro', price: '$79', features: ['20 DM rules', '500 DMs/day', '1000 AI replies/month', 'Custom AI tone'] },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-pink-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-gray-900 text-lg">GrowKarle</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login"><Button variant="ghost">Log in</Button></Link>
          <Link href="/signup"><Button variant="gradient">Get started free</Button></Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-violet-50 text-violet-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          <Sparkles className="w-4 h-4" />
          AI-powered Instagram automation
        </div>
        <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-6">
          Grow your Instagram on<br />
          <span className="bg-gradient-to-r from-violet-600 to-pink-600 bg-clip-text text-transparent">autopilot</span>
        </h1>
        <p className="text-xl text-gray-500 mb-10 max-w-2xl mx-auto">
          Auto DMs, AI-written replies, and growth analytics — everything an influencer needs to scale engagement without burning out.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/signup"><Button size="lg" variant="gradient">Start for free</Button></Link>
          <Link href="#features"><Button size="lg" variant="outline">See features</Button></Link>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Everything you need</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="p-6 rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="w-12 h-12 bg-violet-50 rounded-xl flex items-center justify-center mb-4">
                <Icon className="w-6 h-6 text-violet-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Simple pricing</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map(({ name, price, features, highlight }) => (
            <div key={name} className={`p-6 rounded-2xl border ${highlight ? 'border-violet-500 shadow-lg shadow-violet-100' : 'border-gray-200'} bg-white`}>
              {highlight && <div className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-3">Most popular</div>}
              <div className="text-2xl font-bold text-gray-900 mb-1">{price}<span className="text-sm font-normal text-gray-500">/mo</span></div>
              <div className="font-semibold text-gray-700 mb-4">{name}</div>
              <ul className="space-y-2 mb-6">
                {features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />{f}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <Button className="w-full" variant={highlight ? 'gradient' : 'outline'}>Get started</Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} GrowKarle. Built for creators.
      </footer>
    </div>
  )
}
