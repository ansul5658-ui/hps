import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getProfile } from '@/lib/instagram'

// Called by a cron job (e.g. Vercel Cron, Supabase pg_cron) every hour
// to snapshot follower counts for analytics

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, instagram_user_id, instagram_access_token')
    .not('instagram_access_token', 'is', null)

  let synced = 0
  let failed = 0

  for (const profile of profiles ?? []) {
    try {
      const igProfile = await getProfile(profile.instagram_access_token)

      const followersCount = igProfile.followers_count ?? 0
      const followsCount = igProfile.follows_count ?? 0
      const mediaCount = igProfile.media_count ?? 0

      // Update profile with latest counts
      await supabase
        .from('profiles')
        .update({ followers_count: followersCount, following_count: followsCount, media_count: mediaCount })
        .eq('id', profile.id)

      // Record snapshot
      await supabase.from('analytics_snapshots').insert({
        user_id: profile.id,
        followers_count: followersCount,
        following_count: followsCount,
        media_count: mediaCount,
      })

      synced++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ synced, failed })
}
