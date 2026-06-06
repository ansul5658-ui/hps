'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Sparkles, Copy, RefreshCw } from 'lucide-react'

const TONES = ['friendly', 'professional', 'casual', 'formal'] as const
type Tone = typeof TONES[number]

export default function AiRepliesPage() {
  const [mode, setMode] = useState<'dm' | 'comment'>('dm')
  const [input, setInput] = useState('')
  const [context, setContext] = useState('')
  const [tone, setTone] = useState<Tone>('friendly')
  const [reply, setReply] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    if (!input.trim()) return
    setGenerating(true)
    setReply('')
    try {
      const res = await fetch('/api/ai-reply/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, input, context, tone }),
      })
      const data = await res.json()
      setReply(data.reply)
    } finally {
      setGenerating(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(reply)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">AI Reply Generator</h1>
        <p className="text-gray-500 mt-1">Generate authentic, on-brand replies to DMs and comments instantly.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate a reply</CardTitle>
          <CardDescription>Paste the message or comment you want to reply to.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Mode toggle */}
          <div className="inline-flex bg-gray-100 p-1 rounded-lg">
            {(['dm', 'comment'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {m === 'dm' ? 'DM Reply' : 'Comment Reply'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {mode === 'dm' ? 'Incoming DM' : 'Comment to reply to'}
            </label>
            <textarea
              className="w-full h-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              placeholder={mode === 'dm' ? 'Hey! Love your content, how do I start?' : 'This is amazing! Where can I get one?'}
              value={input}
              onChange={e => setInput(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Your context (optional)</label>
              <Input
                placeholder="e.g. fitness coach, sell online courses"
                value={context}
                onChange={e => setContext(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Tone</label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                value={tone}
                onChange={e => setTone(e.target.value as Tone)}
              >
                {TONES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <Button
            variant="gradient"
            onClick={generate}
            disabled={!input.trim() || generating}
            className="gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {generating ? 'Generating...' : 'Generate reply'}
          </Button>
        </CardContent>
      </Card>

      {(reply || generating) && (
        <Card className="mt-6 border-violet-200">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Generated reply</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={generate} disabled={generating} className="gap-1">
                <RefreshCw className="w-3 h-3" />
                Regenerate
              </Button>
              {reply && (
                <Button variant="ghost" size="sm" onClick={copy} className="gap-1">
                  <Copy className="w-3 h-3" />
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {generating ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                Writing your reply...
              </div>
            ) : (
              <p className="text-gray-800 leading-relaxed">{reply}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tips */}
      <div className="mt-8 p-5 bg-violet-50 rounded-xl">
        <h3 className="text-sm font-semibold text-violet-800 mb-2">Tips for better replies</h3>
        <ul className="text-sm text-violet-700 space-y-1 list-disc list-inside">
          <li>Add your niche/context for more relevant responses</li>
          <li>Use &quot;casual&quot; tone for comments, &quot;friendly&quot; for DMs</li>
          <li>Always review before sending — add personal touches</li>
        </ul>
      </div>
    </div>
  )
}
