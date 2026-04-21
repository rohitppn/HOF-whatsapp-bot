import P from 'pino'

const log = P({ level: process.env.LOG_LEVEL || 'info' })

const BIG_BILL_AI_URL =
  process.env.BIG_BILL_AI_BASE_URL ||
  process.env.ANTHROPIC_BASE_URL ||
  'https://api.anthropic.com/v1/messages'

const BIG_BILL_AI_MODEL =
  process.env.BIG_BILL_AI_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-3-5-haiku-latest'

function getApiKey() {
  return (
    process.env.BIG_BILL_AI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    ''
  ).trim()
}

function isEnabled() {
  return process.env.BIG_BILL_AI_ENABLED !== '0'
}

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

export async function extractBigBillWithCheapModel({
  text,
  stores = [],
  senderStore = null,
  now = null
}) {
  if (!isEnabled()) return null

  const apiKey = getApiKey()
  if (!apiKey || !String(text || '').trim()) return null

  const prompt = JSON.stringify(
    {
      now,
      senderStore,
      allowedStores: stores,
      rawMessage: text,
      outputFormat: {
        store: 'string | null',
        billValue: 'number | null',
        quantity: 'number | null',
        assistedBy: 'string | null',
        helpedBy: 'string | null'
      }
    },
    null,
    2
  )

  const res = await fetch(BIG_BILL_AI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: BIG_BILL_AI_MODEL,
      temperature: 0,
      max_tokens: 250,
      system:
        'Extract only big bill fields from WhatsApp raw text. Return JSON only. Use senderStore when the store is implied but not written clearly.',
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn(
      { status: res.status, bodyPreview: body.slice(0, 300) },
      'big bill cheap model extraction failed'
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
