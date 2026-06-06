import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function generateDmReply(params: {
  incomingMessage: string
  tone: 'friendly' | 'professional' | 'casual' | 'formal'
  influencerContext?: string
  senderUsername?: string
}): Promise<string> {
  const { incomingMessage, tone, influencerContext, senderUsername } = params

  const systemPrompt = `You are an AI assistant helping an Instagram influencer respond to DMs.
Tone: ${tone}.
${influencerContext ? `Context about the influencer: ${influencerContext}` : ''}
Write a short, natural reply (1-3 sentences). Do not use hashtags. Be genuine.`

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Message from ${senderUsername || 'a follower'}: "${incomingMessage}"\n\nWrite a reply:`,
      },
    ],
  })

  const block = msg.content[0]
  return block.type === 'text' ? block.text : ''
}

export async function generateCommentReply(params: {
  comment: string
  postContext?: string
  tone: 'friendly' | 'professional' | 'casual' | 'formal'
}): Promise<string> {
  const { comment, postContext, tone } = params

  const systemPrompt = `You are an AI assistant helping an Instagram influencer reply to comments.
Tone: ${tone}.
${postContext ? `Post context: ${postContext}` : ''}
Write a short reply (1-2 sentences). Be engaging and authentic.`

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Comment: "${comment}"\n\nReply:`,
      },
    ],
  })

  const block = msg.content[0]
  return block.type === 'text' ? block.text : ''
}

export async function generateDmTemplate(params: {
  trigger: string
  tone: 'friendly' | 'professional' | 'casual' | 'formal'
  influencerNiche?: string
}): Promise<string> {
  const { trigger, tone, influencerNiche } = params

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    messages: [
      {
        role: 'user',
        content: `Generate a DM template for an Instagram influencer.
Trigger: ${trigger}
Tone: ${tone}
Niche: ${influencerNiche || 'general'}

The template should feel personal, not spammy. Use {name} for the recipient's name. Keep it under 3 sentences.`,
      },
    ],
  })

  const block = msg.content[0]
  return block.type === 'text' ? block.text : ''
}
