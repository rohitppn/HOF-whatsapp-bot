import { areJidsSameUser, jidNormalizedUser } from '@whiskeysockets/baileys'

export function parseStoreFromText(text) {
  const match = text.match(/STORE:\s*(.+)/i)
  return match ? match[1].trim() : null
}

export function parseStoreFromLooseText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)

  for (const line of lines) {
    const cleaned = line.replace(/^store\s*[:\-]\s*/i, '').trim()
    if (!cleaned) continue
    if (
      /^(opening|date|time|hour|today'?s target|target|achieved(\s+till\s+now)?|walk[\s\u2010-\u2015-]*ins|fc|bill|type|grooming|total|dsr)\b/i.test(
        cleaned
      )
    ) {
      continue
    }
    if (!/[a-z]/i.test(cleaned)) continue
    return cleaned
  }

  return null
}

export function parseOpeningTimeFromText(text) {
  const match =
    text.match(/OPENING\s*TIME:\s*(\d{1,2}:\d{2})/i) ||
    text.match(/TIME:\s*(\d{1,2}:\d{2})/i)
  return match ? match[1].trim() : null
}

export function buildHelpMessage() {
  return (
    `HOF Bot commands\n\n` +
    `Trigger words in manager group:\n` +
    `- @bot\n` +
    `- @assistant\n` +
    `- actual WhatsApp mention of the bot\n\n` +
    `Commands:\n` +
    `- @bot ON? : check bot status\n` +
    `- @bot /help : show commands and features\n` +
    `- @bot send this to stores ... : send message to store groups\n` +
    `- @bot update sheet ... : update Sheet1 / Sheet2 / Sheet3\n\n` +
    `Features:\n` +
    `- Records hourly sales reports\n` +
    `- Records opening timings and flags late openings\n` +
    `- Records big bills in Sheet3 and shares appreciation\n` +
    `- Sends 8 PM manager summary with late openings and top 3 sales stores\n` +
    `- Sends store-group shop-of-the-day appreciation and big bill celebration\n` +
    `- Uses Claude to understand flexible report wording when regex parsing misses\n\n` +
    `Owner self-chat command:\n` +
    `- STOP : pause bot automations and replies for 12 hours`
  )
}

export function storeListText(stores) {
  return stores.join(', ')
}

export function toNumber(val) {
  if (val == null) return 0
  const n = Number(String(val).replace(/[₹,\s]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

function normalizeKeycapDigits(text) {
  return String(text || '')
    .replace(/0️⃣/g, '0')
    .replace(/1️⃣/g, '1')
    .replace(/2️⃣/g, '2')
    .replace(/3️⃣/g, '3')
    .replace(/4️⃣/g, '4')
    .replace(/5️⃣/g, '5')
    .replace(/6️⃣/g, '6')
    .replace(/7️⃣/g, '7')
    .replace(/8️⃣/g, '8')
    .replace(/9️⃣/g, '9')
    .replace(/[#*]️⃣/g, '')
}

export function formatINR(val) {
  return Number(val || 0).toLocaleString('en-IN')
}

export function looksLikeManagerCommand(text) {
  return /\b(send|share|broadcast|announce|message)\b.*\b(store|stores|group|groups|shop|shops)\b|\b(update|fill|append|write)\b.*\bsheet\b|\b(sheet1|sheet2|sheet3)\b|\b(store data|all store data|summary now|get data|show data)\b/i.test(
    text
  )
}

export function looksLikeManagerAssistantChat(text) {
  return /@assis?t(?:a|e)nt|\bassis?t(?:a|e)nt\b|@bot\b|\bbot\b/i.test(text)
}

export function getMentionedJids(content) {
  return (
    content?.extendedTextMessage?.contextInfo?.mentionedJid ||
    content?.imageMessage?.contextInfo?.mentionedJid ||
    content?.videoMessage?.contextInfo?.mentionedJid ||
    content?.documentMessage?.contextInfo?.mentionedJid ||
    content?.buttonsResponseMessage?.contextInfo?.mentionedJid ||
    content?.listResponseMessage?.contextInfo?.mentionedJid ||
    []
  )
}

export function isBotMentioned({ sock, content }) {
  const botJid = jidNormalizedUser(sock.user?.id || '')
  if (!botJid) return false

  return getMentionedJids(content).some(jid =>
    areJidsSameUser(jidNormalizedUser(jid), botJid)
  )
}

export function parseBigBillFromText(text) {
  const normalizedText = normalizeKeycapDigits(text)
  const lines = String(normalizedText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const store =
    normalizedText.match(/store\s*[:\-]?\s*([^\n\r*]+)/i) ||
    normalizedText.match(/([A-Za-z][A-Za-z\s]+?)\s+store/i) ||
    lines.find(line => {
      if (!/[a-z]/i.test(line)) return false
      if (
        /(wow\s*bill|value|bill|quantity|done\s*by|assisted\s*by|with the help of)/i.test(
          line
        )
      ) {
        return false
      }
      return !/^[^\w]*$/u.test(line)
    })

  const billValue = normalizedText.match(
    /(?:value|bill)\s*[-–:]\s*\*?\s*([₹\d\s,./-]+)/i
  )
  const quantity = normalizedText.match(/quantity\s*[-–:]\s*\*?\s*(\d+)/i)
  const assistedBy = normalizedText.match(
    /(?:assisted by|done by)\s*[-–:]?\s*([^\n\r*]+)/i
  )
  const helpedBy = normalizedText.match(/with the help of\s*([^\n\r*]+)/i)

  if (!store || !billValue) return null

  const cleanValue = toNumber(
    String(billValue[1]).replace(/[\/-]+$/g, '').replace(/\s+/g, '')
  )
  if (!cleanValue) return null

  return {
    store: String(Array.isArray(store) ? store[1] : store)
      .replace(/\s+store$/i, '')
      .trim(),
    billValue: cleanValue,
    quantity: quantity ? Number(quantity[1]) : null,
    assistedBy: assistedBy
      ? assistedBy[1].replace(/[^\p{L}\p{N}\s.&'-]+$/gu, '').trim()
      : null,
    helpedBy: helpedBy ? helpedBy[1].trim() : null
  }
}

export function buildWowBillShortMessage(store = '') {
  const prefix = store ? `${store} ` : ''
  return `${prefix}wow bill spotted. Great job team. Keep the momentum going.`
}

export function buildBigBillCelebrationMessage({
  store,
  billValue,
  quantity,
  assistedBy,
  helpedBy
}) {
  const storeLabel = String(store || '').trim() || 'the store'
  const personLabel = String(assistedBy || helpedBy || '').trim() || 'team'
  const valueLabel = `₹${formatINR(billValue)}/-`
  const templates = [
    `Well done, ${personLabel} amazing bill of ${valueLabel}\nGreat to see ${storeLabel} Store picking up the numbers.\nAdded to the leaderboard.`,
    `Amazing job, ${personLabel} superb bill of ${valueLabel}\nGood to see ${storeLabel} Store picking up strongly.\nThis has been added to the leaderboard.`,
    `Well done, ${personLabel} amazing bill of ${valueLabel}\nGood to see ${storeLabel} Store picking up.\nAdded to the leaderboard.`
  ]

  return templates[Math.floor(Math.random() * templates.length)]
}
