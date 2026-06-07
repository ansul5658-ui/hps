import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createSubscription, PLANS } from '@/lib/razorpay'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { planKey } = await request.json()
  const plan = PLANS[planKey as keyof typeof PLANS]
  if (!plan || !plan.planId) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const subscription = await createSubscription(plan.planId, user.id)

  return NextResponse.json({
    subscriptionId: subscription.id,
    keyId: process.env.RAZORPAY_KEY_ID,
  })
}
