import Stripe from 'stripe'

export function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-05-27.dahlia',
  })
}

export const stripe = {
  webhooks: {
    constructEvent(body: string, sig: string, secret: string) {
      return getStripe().webhooks.constructEvent(body, sig, secret)
    },
  },
}

export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceId: null,
    limits: { dmRules: 1, dmPerDay: 10, aiReplies: 20 },
    features: ['1 DM rule', '10 DMs/day', '20 AI replies/month', 'Basic analytics'],
  },
  starter: {
    name: 'Starter',
    price: 29,
    priceId: process.env.STRIPE_PRICE_STARTER,
    limits: { dmRules: 5, dmPerDay: 100, aiReplies: 200 },
    features: ['5 DM rules', '100 DMs/day', '200 AI replies/month', 'Full analytics', 'Comment auto-reply'],
  },
  pro: {
    name: 'Pro',
    price: 79,
    priceId: process.env.STRIPE_PRICE_PRO,
    limits: { dmRules: 20, dmPerDay: 500, aiReplies: 1000 },
    features: ['20 DM rules', '500 DMs/day', '1000 AI replies/month', 'Priority support', 'Custom AI tone'],
  },
  agency: {
    name: 'Agency',
    price: 199,
    priceId: process.env.STRIPE_PRICE_AGENCY,
    limits: { dmRules: 999, dmPerDay: 2000, aiReplies: 5000 },
    features: ['Unlimited DM rules', '2000 DMs/day', '5000 AI replies/month', 'Multiple accounts', 'White label'],
  },
} as const

export async function createCheckoutSession(
  priceId: string,
  customerId: string | null,
  userId: string,
  userEmail: string
) {
  return getStripe().checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer: customerId || undefined,
    customer_email: customerId ? undefined : userEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing`,
    metadata: { userId },
  })
}

export async function createPortalSession(customerId: string) {
  return getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing`,
  })
}
