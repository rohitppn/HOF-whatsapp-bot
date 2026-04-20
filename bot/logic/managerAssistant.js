function normalizeText(text) {
  return String(text || '').trim()
}

function isGreeting(text) {
  return /\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(text)
}

function isStatusCheck(text) {
  return /\b(status|working|active|alive|running|online)\b/i.test(text)
}

function isHelpRequest(text) {
  return /\b(help|how to|what can you do|commands)\b/i.test(text)
}

function isSummaryRequest(text) {
  return /\b(summary|leaderboard|top performer|top bill|today update)\b/i.test(text)
}

export function answerManagerAssistantLocal({ text }) {
  const body = normalizeText(text)
  if (!body) return null

  if (isGreeting(body)) return 'Hello. I am here.'
  if (isStatusCheck(body)) return 'Bot is active.'
  if (isHelpRequest(body)) return 'Use /help for available commands.'
  if (isSummaryRequest(body)) return 'Please check Sheet3 leaderboard at 9:30 PM.'

  if (/\bthank(s| you)?\b/i.test(body)) return 'Always here.'

  return 'Please send a clear bot command.'
}
