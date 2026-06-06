import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`)

  const formData = await request.formData()
  const priceId = formData.get('priceId') as string

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  const session = await createCheckoutSession(
    priceId,
    profile?.stripe_customer_id ?? null,
    user.id,
    user.email!
  )

  return NextResponse.redirect(session.url!, { status: 303 })
}
