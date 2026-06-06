'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Sparkles, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import type { DmRule } from '@/types'

const TRIGGERS = [
  { value: 'new_follower', label: 'New Follower' },
  { value: 'story_reply', label: 'Story Reply' },
  { value: 'comment_keyword', label: 'Comment Keyword' },
  { value: 'dm_received', label: 'DM Received' },
]

const TONES = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
]

export default function AutoDmPage() {
  const supabase = createClient()
  const [rules, setRules] = useState<DmRule[]>([])
  const [showForm, setShowForm] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    trigger: 'new_follower' as DmRule['trigger'],
    keyword: '',
    message_template: '',
    use_ai: false,
    ai_tone: 'friendly' as DmRule['ai_tone'],
  })

  useEffect(() => {
    loadRules()
  }, [])

  async function loadRules() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('dm_rules')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setRules(data ?? [])
  }

  async function generateTemplate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/ai-reply/generate-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: form.trigger, tone: form.ai_tone }),
      })
      const { template } = await res.json()
      setForm(f => ({ ...f, message_template: template }))
    } finally {
      setGenerating(false)
    }
  }

  async function saveRule() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('dm_rules').insert({
      user_id: user.id,
      name: form.name,
      trigger: form.trigger,
      keyword: form.trigger === 'comment_keyword' ? form.keyword : null,
      message_template: form.message_template,
      use_ai: form.use_ai,
      ai_tone: form.ai_tone,
      is_active: true,
      sent_count: 0,
    })

    setForm({ name: '', trigger: 'new_follower', keyword: '', message_template: '', use_ai: false, ai_tone: 'friendly' })
    setShowForm(false)
    setSaving(false)
    await loadRules()
  }

  async function toggleRule(id: string, current: boolean) {
    await supabase.from('dm_rules').update({ is_active: !current }).eq('id', id)
    setRules(r => r.map(rule => rule.id === id ? { ...rule, is_active: !current } : rule))
  }

  async function deleteRule(id: string) {
    await supabase.from('dm_rules').delete().eq('id', id)
    setRules(r => r.filter(rule => rule.id !== id))
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Auto DM</h1>
          <p className="text-gray-500 mt-1">Create rules to automatically send personalized DMs.</p>
        </div>
        <Button variant="gradient" onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Rule
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6 border-violet-200">
          <CardHeader>
            <CardTitle>Create DM Rule</CardTitle>
            <CardDescription>Set up when and what to send automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Rule name</label>
              <Input
                placeholder="e.g. Welcome new followers"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Trigger</label>
                <select
                  className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  value={form.trigger}
                  onChange={e => setForm(f => ({ ...f, trigger: e.target.value as DmRule['trigger'] }))}
                >
                  {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">AI Tone</label>
                <select
                  className="w-full h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  value={form.ai_tone}
                  onChange={e => setForm(f => ({ ...f, ai_tone: e.target.value as DmRule['ai_tone'] }))}
                >
                  {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            {form.trigger === 'comment_keyword' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Keyword</label>
                <Input
                  placeholder="e.g. link, price, collab"
                  value={form.keyword}
                  onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">Message template</label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={generateTemplate}
                  disabled={generating}
                  className="gap-1 text-violet-600"
                >
                  <Sparkles className="w-3 h-3" />
                  {generating ? 'Generating...' : 'AI Generate'}
                </Button>
              </div>
              <textarea
                className="w-full h-28 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                placeholder="Hey {name}! Thanks for following — I share tips every week, so stay tuned! 🙌"
                value={form.message_template}
                onChange={e => setForm(f => ({ ...f, message_template: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">Use {'{name}'} to personalize with the recipient&apos;s name.</p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="use_ai"
                checked={form.use_ai}
                onChange={e => setForm(f => ({ ...f, use_ai: e.target.checked }))}
                className="rounded accent-violet-600"
              />
              <label htmlFor="use_ai" className="text-sm text-gray-700">
                Use AI to personalize each message based on context
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="gradient" onClick={saveRule} disabled={!form.name || !form.message_template || saving}>
                {saving ? 'Saving...' : 'Save rule'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg font-medium text-gray-500 mb-2">No rules yet</p>
            <p className="text-sm">Create your first DM rule to start automating.</p>
          </div>
        ) : rules.map(rule => (
          <Card key={rule.id}>
            <CardContent className="p-5 flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-900">{rule.name}</span>
                  <Badge variant={rule.is_active ? 'success' : 'secondary'}>
                    {rule.is_active ? 'Active' : 'Paused'}
                  </Badge>
                  {rule.use_ai && <Badge variant="default"><Sparkles className="w-3 h-3 mr-1" />AI</Badge>}
                </div>
                <div className="text-sm text-gray-500">
                  Trigger: <span className="font-medium">{TRIGGERS.find(t => t.value === rule.trigger)?.label}</span>
                  {rule.keyword && <> · Keyword: <span className="font-medium">&quot;{rule.keyword}&quot;</span></>}
                  <span className="ml-3 text-gray-400">{rule.sent_count} sent</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleRule(rule.id, rule.is_active)} className="text-gray-400 hover:text-violet-600 transition-colors">
                  {rule.is_active ? <ToggleRight className="w-6 h-6 text-violet-600" /> : <ToggleLeft className="w-6 h-6" />}
                </button>
                <button onClick={() => deleteRule(rule.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
