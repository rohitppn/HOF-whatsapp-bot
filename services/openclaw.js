import P from 'pino'

const log = P({ level: process.env.LOG_LEVEL || 'info' })

function getConfig() {
  return {
    baseUrl: (process.env.OPENCLAW_BASE_URL || '').replace(/\/+$/, ''),
    hookPath: process.env.OPENCLAW_HOOK_PATH || '/hooks',
    hookToken: process.env.OPENCLAW_HOOK_TOKEN || '',
    agentId: process.env.OPENCLAW_AGENT_ID || 'hooks',
    model: process.env.OPENCLAW_MODEL || '',
    thinking: process.env.OPENCLAW_THINKING || '',
    timeoutSeconds: Number(process.env.OPENCLAW_TIMEOUT_SECONDS || 120)
  }
}

function isEnabled() {
  const cfg = getConfig()
  return process.env.OPENCLAW_ENABLED === '1' && Boolean(cfg.baseUrl && cfg.hookToken)
}

function buildUrl(endpoint) {
  const cfg = getConfig()
  return `${cfg.baseUrl}${cfg.hookPath}${endpoint}`
}

async function post(endpoint, body) {
  if (!isEnabled()) return { ok: false, disabled: true }
  const cfg = getConfig()

  log.info(
    {
      endpoint,
      url: buildUrl(endpoint),
      hasAgentId: Boolean(body?.agentId),
      wakeMode: body?.wakeMode || body?.mode || null,
      name: body?.name || null,
      sessionKey: body?.sessionKey || null
    },
    'openclaw request'
  )

  const res = await fetch(buildUrl(endpoint), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.hookToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const text = await res.text().catch(() => '')
  log.info(
    {
      endpoint,
      status: res.status,
      ok: res.ok,
      bodyPreview: text ? text.slice(0, 300) : ''
    },
    'openclaw response'
  )
  return {
    ok: res.ok,
    status: res.status,
    body: text
  }
}

export function isOpenClawEnabled() {
  return isEnabled()
}

export async function sendOpenClawWake(text, mode = 'now') {
  return post('/wake', { text, mode })
}

export async function sendOpenClawAgent(message, options = {}) {
  const cfg = getConfig()
  const payload = {
    message,
    name: options.name || 'HOF Ops Bot',
    agentId: options.agentId || cfg.agentId,
    wakeMode: options.wakeMode || 'now',
    deliver: Boolean(options.deliver),
    timeoutSeconds: options.timeoutSeconds || cfg.timeoutSeconds
  }

  if (options.channel) payload.channel = options.channel
  if (options.to) payload.to = options.to
  if (options.sessionKey) payload.sessionKey = options.sessionKey
  if (options.model || cfg.model) payload.model = options.model || cfg.model
  if (options.thinking || cfg.thinking) payload.thinking = options.thinking || cfg.thinking

  return post('/agent', payload)
}

export async function sendOpsEventToOpenClaw(event) {
  const summary =
    `Retail ops event from WhatsApp.\n` +
    `Type: ${event.eventType}\n` +
    `Group: ${event.groupJid}\n` +
    `Sender: ${event.senderName || event.senderJid || 'unknown'}\n` +
    `Time: ${event.timestamp}\n` +
    `Text: ${event.text || '[no text]'}\n` +
    `Structured result: ${event.structuredResult || 'none'}\n` +
    `Stores: ${(event.stores || []).join(', ')}\n` +
    `Recent knowledge: ${JSON.stringify(event.recentKnowledge || [])}`

  return sendOpenClawAgent(summary, {
    name: 'RetailOpsEvent',
    sessionKey: event.sessionKey,
    wakeMode: 'next-heartbeat',
    deliver: false
  })
}

export async function sendManagerEventToOpenClaw(event) {
  const message =
    `Manager command/event from WhatsApp.\n` +
    `Event type: ${event.eventType || 'manager_command'}\n` +
    `Group: ${event.groupJid}\n` +
    `Sender: ${event.senderName || event.senderJid || 'unknown'}\n` +
    `Time: ${event.timestamp}\n` +
    `Message: ${event.text}\n` +
    `Allowed sheets: ${(event.allowedSheets || []).join(', ')}\n` +
    `Store groups: ${(event.storeGroups || []).join(', ')}\n` +
    `Stores: ${(event.stores || []).join(', ')}`

  return sendOpenClawAgent(message, {
    name: 'RetailManagerCommand',
    sessionKey: event.sessionKey,
    wakeMode: 'now',
    deliver: false
  })
}
