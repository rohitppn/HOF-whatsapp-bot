import { canonicalStoreName } from '../storeConfig.js'

function normalizeText(text) {
  return String(text || '').trim()
}

function findStoreMention(text, stores) {
  const body = normalizeText(text).toLowerCase()
  for (const store of stores || []) {
    if (body.includes(String(store).toLowerCase())) {
      return canonicalStoreName(store, stores) || store
    }
  }
  return null
}

function buildFact(store, kind, fact) {
  return { store: store || null, kind, fact }
}

export function decideSmartReplyLocal({
  latestText,
  stores = []
}) {
  const text = normalizeText(latestText)
  if (!text) return { shouldReply: false, reply: null, facts: [] }

  const store = findStoreMention(text, stores)
  const facts = []

  if (/\bdelay|late|stuck|issue|problem|not working|down\b/i.test(text)) {
    if (store) {
      facts.push(buildFact(store, 'issue', `${store} reported an operational issue.`))
    }
    return {
      shouldReply: true,
      reply: 'Please share the exact issue and current status.',
      facts
    }
  }

  if (/\btarget achieved|done|completed|updated\b/i.test(text)) {
    if (store) {
      facts.push(buildFact(store, 'status', `${store} shared a status update.`))
    }
    return {
      shouldReply: false,
      reply: null,
      facts
    }
  }

  if (/\bwhat|when|how|why|can\b/i.test(text) && /\?/i.test(text)) {
    return {
      shouldReply: true,
      reply: 'Please share the exact store or report type.',
      facts
    }
  }

  return {
    shouldReply: false,
    reply: null,
    facts
  }
}
