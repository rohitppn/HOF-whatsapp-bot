function normalizeText(text) {
  return String(text || '').trim()
}

function extractTargetGroups(message, storeGroups) {
  const text = normalizeText(message).toLowerCase()
  if (/\ball stores\b|\ball groups\b|\bstores\b/.test(text)) {
    return storeGroups
  }
  return []
}

function parseSendGroupMessage(text, storeGroups) {
  const body = normalizeText(text)
  const match =
    body.match(/send\s+(?:this\s+)?to\s+(?:all\s+)?(?:stores|groups?)\s*[:\-]?\s*([\s\S]+)/i) ||
    body.match(/broadcast\s+to\s+(?:all\s+)?(?:stores|groups?)\s*[:\-]?\s*([\s\S]+)/i)

  if (!match?.[1]) return null

  const message = match[1].trim()
  if (!message) return null

  return {
    action: 'send_group_message',
    message,
    targetGroups: extractTargetGroups(body, storeGroups)
  }
}

function parseSheetUpdate(text, allowedSheets) {
  const body = normalizeText(text)
  const match = body.match(
    /update\s+(sheet1|sheet2|sheet3|[a-z0-9 _-]+)\s+range\s+([a-z]+\d+(?::[a-z]+\d+)?)\s+with\s+(.+)/i
  )
  if (!match) return null

  const sheetNameRaw = match[1].trim()
  const sheetName =
    allowedSheets.find(sheet => sheet.toLowerCase() === sheetNameRaw.toLowerCase()) ||
    sheetNameRaw

  if (!allowedSheets.includes(sheetName)) return null

  return {
    action: 'update_sheet',
    message: null,
    targetGroups: [],
    sheetName,
    range: match[2].trim(),
    values: [[match[3].trim()]],
    appendRow: false
  }
}

export function parseManagerCommandLocal({ text, allowedSheets = [], storeGroups = [] }) {
  const body = normalizeText(text)
  if (!body) return null

  const sendCommand = parseSendGroupMessage(body, storeGroups)
  if (sendCommand) return sendCommand

  const sheetCommand = parseSheetUpdate(body, allowedSheets)
  if (sheetCommand) return sheetCommand

  return {
    action: 'none',
    message: null,
    targetGroups: [],
    sheetName: null,
    range: null,
    values: [],
    appendRow: false
  }
}
