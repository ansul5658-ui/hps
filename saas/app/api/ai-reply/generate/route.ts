import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDmReply, generateCommentReply } from '@/lib/ai'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { mode, input, context, tone } = await request.json()

  if (!input || !tone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  let reply: string
  if (mode === 'comment') {
    reply = await generateCommentReply({ comment: input, postContext: context, tone })
  } else {
    reply = await generateDmReply({ incomingMessage: input, tone, influencerContext: context })
  }

  return NextResponse.json({ reply })
}
