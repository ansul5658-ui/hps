import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendDm } from '@/lib/instagram'
import { generateDmReply } from '@/lib/ai'
import { interpolateTemplate } from '@/lib/utils'

function getSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Webhook events
export async function POST(request: NextRequest) {
  const body = await request.json()
  const supabase = getSupabase()

  for (const entry of body.entry ?? []) {
    const igUserId = entry.id

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, instagram_access_token, plan')
      .eq('instagram_user_id', igUserId)
      .single()

    if (!profile?.instagram_access_token) continue

    for (const change of entry.changes ?? []) {
      if (change.field === 'messages') {
        await handleMessage(supabase, profile, change.value)
      }
      if (change.field === 'comments') {
        await handleComment(supabase, profile, change.value)
      }
    }

    for (const messaging of entry.messaging ?? []) {
      await handleMessage(supabase, profile, messaging)
    }
  }

  return NextResponse.json({ ok: true })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(supabase: any, profile: { id: string; instagram_access_token: string; plan: string }, event: Record<string, unknown>) {
  const senderId = (event.sender as { id?: string })?.id
  if (!senderId) return

  const { data: rules } = await supabase
    .from('dm_rules')
    .select('*')
    .eq('user_id', profile.id)
    .eq('trigger', 'dm_received')
    .eq('is_active', true)
    .limit(1)

  const rule = rules?.[0]
  if (!rule) return

  let message = interpolateTemplate(rule.message_template, { name: 'there' })

  if (rule.use_ai) {
    const incomingText = (event.message as { text?: string })?.text ?? ''
    message = await generateDmReply({
      incomingMessage: incomingText,
      tone: rule.ai_tone,
    })
  }

  const result = await sendDm(profile.instagram_access_token, senderId, message)

  await supabase.from('dm_logs').insert({
    user_id: profile.id,
    rule_id: rule.id,
    recipient_id: senderId,
    recipient_username: senderId,
    message,
    status: result.message_id ? 'sent' : 'failed',
  })

  if (result.message_id) {
    await supabase
      .from('dm_rules')
      .update({ sent_count: rule.sent_count + 1 })
      .eq('id', rule.id)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleComment(supabase: any, profile: { id: string; instagram_access_token: string }, event: Record<string, unknown>) {
  const commentText = (event.text as string) ?? ''
  const commentId = event.id as string
  const senderId = (event.from as { id?: string })?.id

  const { data: rules } = await supabase
    .from('dm_rules')
    .select('*')
    .eq('user_id', profile.id)
    .eq('trigger', 'comment_keyword')
    .eq('is_active', true)

  for (const rule of rules ?? []) {
    if (rule.keyword && commentText.toLowerCase().includes(rule.keyword.toLowerCase())) {
      let message = interpolateTemplate(rule.message_template, { name: 'there' })

      if (rule.use_ai) {
        message = await generateDmReply({
          incomingMessage: commentText,
          tone: rule.ai_tone,
        })
      }

      if (senderId) {
        await sendDm(profile.instagram_access_token, senderId, message)
      }

      await supabase.from('dm_logs').insert({
        user_id: profile.id,
        rule_id: rule.id,
        recipient_id: commentId,
        recipient_username: (event.from as { username?: string })?.username ?? 'unknown',
        message,
        status: 'sent',
      })

      await supabase
        .from('dm_rules')
        .update({ sent_count: rule.sent_count + 1 })
        .eq('id', rule.id)
    }
  }
}
