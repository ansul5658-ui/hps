import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, getLongLivedToken, getProfile } from '@/lib/instagram'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?error=instagram_denied`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`)

  const { access_token: shortToken, user_id } = await exchangeCodeForToken(code)
  const { access_token } = await getLongLivedToken(shortToken)
  const igProfile = await getProfile(access_token)

  await supabase.from('profiles').upsert({
    id: user.id,
    instagram_user_id: user_id,
    instagram_username: igProfile.username,
    instagram_access_token: access_token,
    followers_count: igProfile.followers_count ?? 0,
    following_count: igProfile.follows_count ?? 0,
    media_count: igProfile.media_count ?? 0,
  })

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?connected=true`)
}
