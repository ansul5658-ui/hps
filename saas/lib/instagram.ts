const GRAPH_API = 'https://graph.instagram.com/v21.0'

export function getOAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/auth/callback`,
    scope: 'instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_show_list,pages_read_engagement',
    response_type: 'code',
  })
  return `https://api.instagram.com/oauth/authorize?${params}`
}

export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string
  user_id: string
}> {
  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/auth/callback`,
      code,
    }),
  })
  return res.json()
}

export async function getLongLivedToken(shortToken: string): Promise<{
  access_token: string
  token_type: string
  expires_in: number
}> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: process.env.INSTAGRAM_APP_SECRET!,
    access_token: shortToken,
  })
  const res = await fetch(`https://graph.instagram.com/access_token?${params}`)
  return res.json()
}

export async function getProfile(accessToken: string) {
  const params = new URLSearchParams({
    fields: 'id,username,account_type,media_count,followers_count,follows_count',
    access_token: accessToken,
  })
  const res = await fetch(`${GRAPH_API}/me?${params}`)
  return res.json()
}

export async function sendDm(
  accessToken: string,
  recipientId: string,
  message: string
) {
  const res = await fetch(`${GRAPH_API}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message },
      access_token: accessToken,
    }),
  })
  return res.json()
}

export async function getConversations(accessToken: string, userId: string) {
  const params = new URLSearchParams({
    fields: 'participants,messages{message,from,created_time}',
    access_token: accessToken,
  })
  const res = await fetch(`${GRAPH_API}/${userId}/conversations?${params}`)
  return res.json()
}

export async function getInsights(accessToken: string, userId: string) {
  const params = new URLSearchParams({
    metric: 'impressions,reach,follower_count',
    period: 'day',
    access_token: accessToken,
  })
  const res = await fetch(`${GRAPH_API}/${userId}/insights?${params}`)
  return res.json()
}

export async function replyToComment(
  accessToken: string,
  commentId: string,
  message: string
) {
  const res = await fetch(`${GRAPH_API}/${commentId}/replies`, {
    method: 'POST',
    body: new URLSearchParams({ message, access_token: accessToken }),
  })
  return res.json()
}
