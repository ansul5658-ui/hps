export interface User {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  instagram_user_id: string | null
  instagram_username: string | null
  instagram_access_token: string | null
  plan: 'free' | 'starter' | 'pro' | 'agency'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  created_at: string
}

export interface DmRule {
  id: string
  user_id: string
  name: string
  trigger: 'new_follower' | 'story_reply' | 'comment_keyword' | 'dm_received'
  keyword: string | null
  message_template: string
  use_ai: boolean
  ai_tone: 'friendly' | 'professional' | 'casual' | 'formal'
  is_active: boolean
  sent_count: number
  created_at: string
}

export interface DmLog {
  id: string
  user_id: string
  rule_id: string | null
  recipient_id: string
  recipient_username: string
  message: string
  status: 'sent' | 'failed' | 'pending'
  created_at: string
}

export interface AnalyticsSnapshot {
  id: string
  user_id: string
  followers_count: number
  following_count: number
  media_count: number
  engagement_rate: number
  dm_sent_today: number
  recorded_at: string
}

export interface AiReplyTemplate {
  id: string
  user_id: string
  name: string
  context: string
  tone: 'friendly' | 'professional' | 'casual' | 'formal'
  example_input: string
  example_output: string
  created_at: string
}
