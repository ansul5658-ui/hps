import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyWebhookSignature } from '@/lib/razorpay'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''

  if (!verifyWebhookSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = JSON.parse(body)
  const supabase = getSupabase()

  if (event.event === 'subscription.activated' || event.event === 'subscription.charged') {
    const subscription = event.payload.subscription.entity
    const userId = subscription.notes?.userId

    if (userId) {
      const planId = subscription.plan_id
      // Map plan ID to plan key
      const planMap: Record<string, string> = {
        [process.env.RAZORPAY_PLAN_STARTER ?? '']: 'starter',
        [process.env.RAZORPAY_PLAN_PRO ?? '']: 'pro',
        [process.env.RAZORPAY_PLAN_AGENCY ?? '']: 'agency',
      }
      const plan = planMap[planId] ?? 'free'

      await supabase
        .from('profiles')
        .update({ plan, stripe_subscription_id: subscription.id })
        .eq('id', userId)
    }
  }

  if (event.event === 'subscription.cancelled' || event.event === 'subscription.expired') {
    const subscription = event.payload.subscription.entity
    const userId = subscription.notes?.userId
    if (userId) {
      await supabase.from('profiles').update({ plan: 'free' }).eq('id', userId)
    }
  }

  return NextResponse.json({ ok: true })
}
