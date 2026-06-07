import Razorpay from 'razorpay'
import crypto from 'crypto'

export function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  })
}

export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceInr: 0,
    planId: null,
    limits: { dmRules: 1, dmPerDay: 10, aiReplies: 20 },
    features: ['1 DM rule', '10 DMs/day', '20 AI replies/month', 'Basic analytics'],
  },
  starter: {
    name: 'Starter',
    price: 999,
    priceInr: 999,
    planId: process.env.RAZORPAY_PLAN_STARTER,
    limits: { dmRules: 5, dmPerDay: 100, aiReplies: 200 },
    features: ['5 DM rules', '100 DMs/day', '200 AI replies/month', 'Full analytics', 'Comment auto-reply'],
  },
  pro: {
    name: 'Pro',
    price: 2499,
    priceInr: 2499,
    planId: process.env.RAZORPAY_PLAN_PRO,
    limits: { dmRules: 20, dmPerDay: 500, aiReplies: 1000 },
    features: ['20 DM rules', '500 DMs/day', '1000 AI replies/month', 'Priority support', 'Custom AI tone'],
  },
  agency: {
    name: 'Agency',
    price: 5999,
    priceInr: 5999,
    planId: process.env.RAZORPAY_PLAN_AGENCY,
    limits: { dmRules: 999, dmPerDay: 2000, aiReplies: 5000 },
    features: ['Unlimited DM rules', '2000 DMs/day', '5000 AI replies/month', 'Multiple accounts', 'White label'],
  },
} as const

export async function createSubscription(planId: string, userId: string) {
  const razorpay = getRazorpay()
  return razorpay.subscriptions.create({
    plan_id: planId,
    total_count: 12,
    quantity: 1,
    notes: { userId },
  })
}

export function verifyWebhookSignature(body: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET!
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')
  return expectedSignature === signature
}
