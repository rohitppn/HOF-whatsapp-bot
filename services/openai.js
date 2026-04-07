import P from 'pino'

const OPENAI_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || OPENAI_MODEL
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

export async function decideSmartReply({
  latestText,
  senderName,
  stores,
  recentMessages,
  recentKnowledge,
  now
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const system = [
    'You are a retail operations WhatsApp bot.',
    'You read recent group context and decide whether the bot should reply.',
    'Reply only when helpful and action-oriented.',
    'Do not reply to casual chatter, acknowledgements, or messages already handled by structured workflows.',
    'If a store issue, escalation, question, delay, confusion, or important operational instruction appears, you may reply.',
    'Keep replies concise, respectful, professional, and useful.',
    'Also extract durable facts that should be stored as bot knowledge.'
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

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn({ status: res.status, bodyPreview: body.slice(0, 300) }, 'openai decideSmartReply failed')
    return null
  }
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  const parsed = jsonBlock(raw)
  if (!parsed) return null

  try {
    const result = JSON.parse(parsed)
    return {
      shouldReply: Boolean(result?.shouldReply),
      reply: typeof result?.reply === 'string' ? result.reply.trim() : null,
      facts: Array.isArray(result?.facts) ? result.facts : []
    }
  } catch {
    return null
  }
}

export async function analyzeDressImage({ imageBuffer, storeName = null, caption = '' }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !imageBuffer) return null

  const prompt = [
    'You are checking retail staff dress compliance from a store photo.',
    'Decide whether the visible staff are wearing an all-black uniform.',
    'Treat mostly-black tops and bottoms as compliant even if shoes, watches, or small accessories are not black.',
    'Return JSON only with keys: compliant, confidence, summary, guidance.',
    'compliant: boolean',
    'confidence: number from 0 to 1',
    'summary: short explanation of what you see',
    'guidance: short corrective guidance if not compliant, otherwise null',
    `Store: ${storeName || 'unknown'}`,
    `Caption: ${caption || ''}`
  ].join(' ')

  const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a strict visual compliance checker.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn({ status: res.status, bodyPreview: body.slice(0, 300) }, 'openai analyzeDressImage failed')
    return null
  }
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  const parsed = jsonBlock(raw)
  if (!parsed) return null

  try {
    const result = JSON.parse(parsed)
    return {
      compliant: Boolean(result?.compliant),
      confidence: Number(result?.confidence || 0),
      summary: typeof result?.summary === 'string' ? result.summary.trim() : '',
      guidance: typeof result?.guidance === 'string' ? result.guidance.trim() : null
    }
  } catch {
    return null
  }
}

export async function extractOperationalIntent({ text, stores, now }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !text?.trim()) return null

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

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Extract structured retail-ops intent from WhatsApp messages. Use kind=none if the message is not an operational report. Ask clarification only when the user clearly intends to report operational data but key fields are missing.'
        },
        { role: 'user', content: user }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn({ status: res.status, bodyPreview: body.slice(0, 300) }, 'openai extractOperationalIntent failed')
    return null
  }
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  const parsed = jsonBlock(raw)
  if (!parsed) return null

  try {
    return JSON.parse(parsed)
  } catch {
    return null
  }
}

export async function parseManagerCommand({ text, stores, allowedSheets, storeGroups }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !text?.trim()) return null

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

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Parse manager instructions. Only return an action if the message is a direct bot command to send a message to store groups or update Google Sheets.'
        },
        { role: 'user', content: user }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn({ status: res.status, bodyPreview: body.slice(0, 300) }, 'openai parseManagerCommand failed')
    return null
  }
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  const parsed = jsonBlock(raw)
  if (!parsed) return null

  try {
    return JSON.parse(parsed)
  } catch {
    return null
  }
}

export async function answerManagerAssistant({ text, stores, recentMessages, recentKnowledge, now }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || !text?.trim()) return null

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

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are the HOF retail operations assistant replying inside the manager WhatsApp group. Reply briefly, clearly, and helpfully. Answer manager questions, summarize store operations, and guide next steps when useful. Do not invent figures or status. If the manager greets you, respond warmly and briefly.'
        },
        { role: 'user', content: user }
      ]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn({ status: res.status, bodyPreview: body.slice(0, 300) }, 'openai answerManagerAssistant failed')
    return null
  }
  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  const parsed = jsonBlock(raw)
  if (!parsed) return null

  try {
    const result = JSON.parse(parsed)
    return typeof result?.reply === 'string' ? result.reply.trim() : null
  } catch {
    return null
  }
}
