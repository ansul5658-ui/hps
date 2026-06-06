import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PLAN_BY_PRICE: Record<string, string> = {
  [process.env.STRIPE_PRICE_STARTER ?? '']: 'starter',
  [process.env.STRIPE_PRICE_PRO ?? '']: 'pro',
  [process.env.STRIPE_PRICE_AGENCY ?? '']: 'agency',
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const subscription = event.data.object as Stripe.Subscription

  if (event.type === 'checkout.session.completed') {
    const userId = session.metadata?.userId
    const customerId = session.customer as string
    const subId = session.subscription as string

    if (userId) {
      await supabase.from('profiles').update({
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
      }).eq('id', userId)
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
    const priceId = subscription.items.data[0]?.price.id
    const plan = PLAN_BY_PRICE[priceId] ?? 'free'
    const customerId = subscription.customer as string

    await supabase.from('profiles').update({ plan }).eq('stripe_customer_id', customerId)
  }

  if (event.type === 'customer.subscription.deleted') {
    const customerId = subscription.customer as string
    await supabase.from('profiles').update({ plan: 'free', stripe_subscription_id: null }).eq('stripe_customer_id', customerId)
  }

  return NextResponse.json({ received: true })
}
