import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDmTemplate } from '@/lib/ai'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trigger, tone, niche } = await request.json()
  const template = await generateDmTemplate({ trigger, tone, influencerNiche: niche })
  return NextResponse.json({ template })
}
