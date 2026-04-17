import P from 'pino'

const ANTHROPIC_URL =
  process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL ||
  process.env.OPENAI_MODEL ||
  'claude-3-5-sonnet-latest'
const log = P({ level: process.env.LOG_LEVEL || 'info' })

function jsonBlock(content) {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map(item => item?.text || '').join('\n')
        : ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  return text.slice(start, end + 1)
}

function getAnthropicApiKey() {
  return (
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  ).trim()
}

async function requestAnthropicJson({
  system,
  user,
  temperature = 0,
  maxTokens = 900,
  failureLabel
}) {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) return null

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      temperature,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn(
      { status: res.status, bodyPreview: body.slice(0, 300) },
      failureLabel
    )
    return null
  }

  const data = await res.json()
  const raw = (data?.content || [])
    .map(item => (item?.type === 'text' ? item.text : ''))
    .join('\n')
  const parsed = jsonBlock(raw)
  if (!parsed) return null

  try {
    return JSON.parse(parsed)
  } catch {
    return null
  }
}

export async function decideSmartReply({
  latestText,
  senderName,
  stores,
  recentMessages,
  recentKnowledge,
  now
}) {
  const system = [
    'You are a retail operations WhatsApp bot.',
    'You read recent group context and decide whether the bot should reply.',
    'Reply only when helpful and action-oriented.',
    'Do not reply to casual chatter, acknowledgements, or messages already handled by structured workflows.',
    'If a store issue, escalation, question, delay, confusion, or important operational instruction appears, you may reply.',
    'Keep replies concise, respectful, professional, and useful.',
    'Also extract durable facts that should be stored as bot knowledge.',
    'Return JSON only.'
  ].join(' ')

  const user = JSON.stringify(
    {
      now,
      senderName,
      allowedStores: stores,
      latestMessage: latestText,
      recentMessages,
      recentKnowledge,
      outputFormat: {
        shouldReply: 'boolean',
        reply: 'string | null',
        facts: [
          {
            store: 'string | null',
            kind: 'instruction | issue | status | policy | performance | note',
            fact: 'string'
          }
        ]
      }
    },
    null,
    2
  )

  const result = await requestAnthropicJson({
    system,
    user,
    temperature: 0.2,
    maxTokens: 900,
    failureLabel: 'anthropic decideSmartReply failed'
  })

  if (!result) return null

  return {
    shouldReply: Boolean(result?.shouldReply),
    reply: typeof result?.reply === 'string' ? result.reply.trim() : null,
    facts: Array.isArray(result?.facts) ? result.facts : []
  }
}

export async function extractOperationalIntent({ text, stores, now }) {
  if (!text?.trim()) return null

  const user = JSON.stringify(
    {
      now,
      allowedStores: stores,
      message: text,
      outputFormat: {
        kind: 'hourly | opening | big_bill | none',
        shouldAskClarification: 'boolean',
        clarification: 'string | null',
        data: {
          store: 'string | null',
          openingTime: 'string | null',
          target: 'number | null',
          achieved: 'number | null',
          walkIns: 'number | null',
          hour: 'string | null',
          billValue: 'number | null',
          quantity: 'number | null',
          assistedBy: 'string | null',
          helpedBy: 'string | null'
        }
      }
    },
    null,
    2
  )

  return requestAnthropicJson({
    system:
      'Extract structured retail-ops intent from WhatsApp messages. Use kind=none if the message is not an operational report. Ask clarification only when the user clearly intends to report operational data but key fields are missing. Return JSON only.',
    user,
    temperature: 0,
    maxTokens: 800,
    failureLabel: 'anthropic extractOperationalIntent failed'
  })
}

export async function parseManagerCommand({ text, stores, allowedSheets, storeGroups }) {
  if (!text?.trim()) return null

  const user = JSON.stringify(
    {
      stores,
      allowedSheets,
      storeGroups,
      message: text,
      outputFormat: {
        action: 'send_group_message | update_sheet | none',
        message: 'string | null',
        targetGroups: ['group jid strings'],
        sheetName: 'string | null',
        range: 'A1 range string or null',
        values: [['2D array of cell values']],
        appendRow: 'boolean'
      }
    },
    null,
    2
  )

  return requestAnthropicJson({
    system:
      'Parse manager instructions. Only return an action if the message is a direct bot command to send a message to store groups or update Google Sheets. Return JSON only. The reply must be valid JSON.',
    user,
    temperature: 0,
    maxTokens: 800,
    failureLabel: 'anthropic parseManagerCommand failed'
  })
}

export async function answerManagerAssistant({
  text,
  stores,
  recentMessages,
  recentKnowledge,
  now
}) {
  if (!text?.trim()) return null

  const user = JSON.stringify(
    {
      now,
      stores,
      latestMessage: text,
      recentMessages,
      recentKnowledge,
      outputFormat: {
        reply: 'string'
      }
    },
    null,
    2
  )

  const result = await requestAnthropicJson({
    system:
      'You are the HOF retail operations assistant replying inside the manager WhatsApp group. Reply like a human, usually under 10 words unless a summary is requested. Be warm, short, and clear. If you do not understand, ask one short follow-up question. Do not invent figures or status. If the manager greets you, respond warmly and briefly. Return JSON only. The reply must be valid JSON.',
    user,
    temperature: 0.3,
    maxTokens: 300,
    failureLabel: 'anthropic answerManagerAssistant failed'
  })

  return typeof result?.reply === 'string' ? result.reply.trim() : null
}
