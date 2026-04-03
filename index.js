import fs from 'fs'
import dotenv from 'dotenv'
import { Jimp, intToRGBA } from 'jimp'

const DOTENV_PATH = '/Users/rohitsharma/Desktop/arunavclothingbot/hof-ops-bot/.env'
const dotenvResult = dotenv.config({ path: DOTENV_PATH, override: true })
if (dotenvResult.error) {
  console.error('dotenv load error', dotenvResult.error)
} else {
  console.log('dotenv loaded from', DOTENV_PATH)
}
import express from 'express'
import cron from 'node-cron'
import P from 'pino'
import qrcodeTerminal from 'qrcode-terminal'
import QRCode from 'qrcode'
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  isJidGroup,
  downloadMediaMessage
} from '@whiskeysockets/baileys'

import { parseHourlyReport } from './services/parser.js'
import { appendSheetRow, sheetHourly, sheetOpening, getSheetRows, updateSheetRange, updateStaffDress } from './services/sheets.js'
import { initDb } from './config/db.js'
import { addKnowledge, getRecentKnowledge, getRecentMessages, saveGroupMessage } from './services/memory.js'
import { analyzeDressImage, decideSmartReply, extractOperationalIntent, parseManagerCommand } from './services/openai.js'
import { getTopBigBillForDate, saveBigBill } from './services/bigBills.js'
import { isOpenClawEnabled, sendManagerEventToOpenClaw, sendOpsEventToOpenClaw } from './services/openclaw.js'

const log = P({ level: process.env.LOG_LEVEL || 'info' })
const HANDLER_VERSION = 'v5-openai-smart-ops'
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata'
const OPENCLAW_CALLBACK_TOKEN = (process.env.OPENCLAW_CALLBACK_TOKEN || '').trim()

const app = express()
app.use(express.json({ limit: '2mb' }))
const port = process.env.PORT || 3000
let latestQrText = null
let latestQrImageUrl = null
let latestQrUpdatedAt = null
let latestWaStatus = 'starting'

function getAppBaseUrl() {
  const explicit = (process.env.APP_BASE_URL || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim()
  if (railwayDomain) return `https://${railwayDomain}`
  return `http://127.0.0.1:${port}`
}

app.get('/health', (req, res) => res.json({ ok: true }))
app.get('/qr', (req, res) => {
  const qrReady = Boolean(latestQrImageUrl)
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="10" />
    <title>HOF Bot QR</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#111827; color:#f9fafb; margin:0; padding:24px; }
      .card { max-width:520px; margin:40px auto; background:#1f2937; border-radius:16px; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,.35); }
      h1 { margin:0 0 12px; font-size:28px; }
      p { color:#d1d5db; line-height:1.5; }
      .meta { font-size:14px; color:#9ca3af; margin-top:12px; }
      img { display:block; width:100%; max-width:320px; margin:24px auto; background:#fff; padding:16px; border-radius:12px; }
      .status { display:inline-block; padding:6px 10px; border-radius:999px; background:#374151; font-size:13px; margin-top:8px; }
      code { background:#111827; padding:2px 6px; border-radius:6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>HOF WhatsApp QR</h1>
      <div class="status">WA status: ${latestWaStatus}</div>
      ${
        qrReady
          ? `<p>Scan this QR with WhatsApp Linked Devices. This page refreshes every 10 seconds.</p>
             <img src="${latestQrImageUrl}" alt="WhatsApp QR Code" />
             <div class="meta">Last updated: ${latestQrUpdatedAt || 'unknown'}</div>`
          : `<p>No active QR is available right now.</p>
             <p>If the bot is already connected, that is expected. If you need a fresh QR, restart the bot session and reopen this page.</p>
             <div class="meta">Last QR update: ${latestQrUpdatedAt || 'never'}</div>`
      }
      <div class="meta">Health check: <code>/health</code></div>
    </div>
  </body>
</html>`)
})

app.get('/qr.json', (req, res) =>
  res.json({
    ok: true,
    connected: latestWaStatus === 'open',
    status: latestWaStatus,
    qrAvailable: Boolean(latestQrImageUrl),
    updatedAt: latestQrUpdatedAt
  })
)
log.info({ HANDLER_VERSION }, 'boot')

const ALLOWED_GROUPS = (process.env.ALLOWED_GROUPS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const MANAGERS_GROUP_ID = (process.env.MANAGERS_GROUP_ID || '').trim()

log.info(
  {
    LOG_LEVEL: process.env.LOG_LEVEL,
    TIMEZONE,
    ALLOWED_GROUPS,
    STORES_COUNT: getStoresFromEnv().length,
    OPENCLAW_ENABLED: isOpenClawEnabled()
  },
  'boot config'
)

function isAllowedGroup(jid) {
  if (!isJidGroup(jid)) return false
  const allowed = new Set(ALLOWED_GROUPS)
  if (MANAGERS_GROUP_ID) allowed.add(MANAGERS_GROUP_ID)
  if (allowed.size === 0) return true
  return allowed.has(jid)
}

function isAllowedSender(jid) {
  if (ALLOWED_SENDERS.length === 0) return true
  return ALLOWED_SENDERS.includes(jid)
}

function isAuthorizedCallback(req) {
  if (!OPENCLAW_CALLBACK_TOKEN) return false
  const auth = req.headers.authorization || ''
  return auth === `Bearer ${OPENCLAW_CALLBACK_TOKEN}`
}

function getStoresFromEnv() {
  const list = (process.env.STORES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (list.length) return list

  const stores = Object.keys(process.env)
    .filter(k => /^store_\d+$/i.test(k))
    .map(k => (process.env[k] || '').trim())
    .filter(Boolean)
  if (stores.length) return stores

  try {
    const raw = fs.readFileSync(DOTENV_PATH, 'utf8')
    const fromFile = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^store_\d+=/i.test(line))
      .map(line => line.split('=').slice(1).join('=').trim())
      .filter(Boolean)
    return fromFile
  } catch {
    return []
  }
}

function getPartsFromDate(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const fmtTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const dateStr = fmt.format(date)
  const timeStr = fmtTime.format(date)
  return { date: dateStr, time: timeStr.slice(0, 5), recordedAt: `${dateStr} ${timeStr}` }
}

function getPartsFromTimestamp(tsSeconds) {
  const date = new Date(Number(tsSeconds) * 1000)
  return getPartsFromDate(date)
}

function hourBlockFromHour(hour24) {
  const h = Number(hour24)
  const start = h % 12 === 0 ? 12 : h % 12
  const end = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${start}-${end} ${suffix}`
}

function getNowParts() {
  return getPartsFromDate(new Date())
}

function parseStoreFromText(text) {
  const match = text.match(/STORE:\s*(.+)/i)
  if (!match) return null
  return match[1].trim()
}

function parseStoreFromLooseText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
  if (lines.length === 0) return null

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

function parseOpeningTimeFromText(text) {
  const match = text.match(/OPENING\s*TIME:\s*(\d{1,2}:\d{2})/i) || text.match(/TIME:\s*(\d{1,2}:\d{2})/i)
  if (!match) return null
  return match[1].trim()
}

function isLateOpening(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const minutes = h * 60 + m
  return minutes > 10 * 60 + 30
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function randomGapMs() {
  const min = 60 * 1000
  const max = 3 * 60 * 1000
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function storeListText(stores) {
  return stores.join(', ')
}

function toNumber(val) {
  if (val == null) return 0
  const n = Number(String(val).replace(/[₹,\s]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

function formatINR(val) {
  return Number(val || 0).toLocaleString('en-IN')
}

function normalizeHourLabel(raw, fallbackTime) {
  const value = String(raw || '').trim()
  if (!value) return hourBlockFromHour(Number(fallbackTime.split(':')[0]))
  if (/\d+\s*-\s*\d+\s*(AM|PM)/i.test(value)) return value.replace(/\s+/g, ' ').trim()
  const timeMatch = value.match(/(\d{1,2})[:.](\d{2})/)
  if (!timeMatch) return value
  const hour = Number(timeMatch[1])
  const minutes = Number(timeMatch[2])
  let hour24 = hour
  if (/PM/i.test(value) && hour < 12) hour24 += 12
  if (/AM/i.test(value) && hour === 12) hour24 = 0
  if (!/AM|PM/i.test(value) && fallbackTime) {
    const currentHour = Number(fallbackTime.split(':')[0])
    if (currentHour >= 12 && hour < 12) hour24 = hour + 12
  }
  return hourBlockFromHour(minutes >= 0 ? hour24 : hour24)
}

function looksLikeManagerCommand(text) {
  return /@assis?t(?:a|e)nt|\bassis?t(?:a|e)nt\b|send .*group|update .*sheet|fill .*sheet/i.test(text)
}

function looksLikeManagerAssistantChat(text) {
  return /@assis?t(?:a|e)nt|\bassis?t(?:a|e)nt\b/i.test(text)
}

function parseBigBillFromText(text) {
  const store =
    text.match(/(?:store|🛍️)\s*[:\-]?\s*([^\n\r*]+)/i) ||
    text.match(/([A-Za-z][A-Za-z\s]+?)\s+store/i)
  const billValue = text.match(/(?:value|bill)\s*[-–:]\s*\*?\s*([₹\d,./-]+)/i)
  const quantity = text.match(/quantity\s*[-–:]\s*\*?\s*(\d+)/i)
  const assistedBy = text.match(/assisted by\s*[-–:]?\s*([^\n\r*]+)/i)
  const helpedBy = text.match(/with the help of\s*([^\n\r*]+)/i)
  if (!store || !billValue) return null
  const cleanValue = toNumber(String(billValue[1]).replace(/[\/-]+$/g, ''))
  if (!cleanValue) return null
  return {
    store: store[1].replace(/\s+store$/i, '').trim(),
    billValue: cleanValue,
    quantity: quantity ? Number(quantity[1]) : null,
    assistedBy: assistedBy ? assistedBy[1].trim() : null,
    helpedBy: helpedBy ? helpedBy[1].trim() : null
  }
}

async function evaluateDressCode(buffer) {
  const image = await Jimp.read(buffer)
  const width = image.bitmap.width
  const height = image.bitmap.height
  const x0 = Math.floor(width * 0.2)
  const y0 = Math.floor(height * 0.2)
  const x1 = Math.max(x0 + 1, Math.floor(width * 0.8))
  const y1 = Math.max(y0 + 1, Math.floor(height * 0.8))
  const stepX = Math.max(1, Math.floor((x1 - x0) / 64))
  const stepY = Math.max(1, Math.floor((y1 - y0) / 64))
  let darkCount = 0
  let total = 0
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const { r, g, b } = intToRGBA(image.getPixelColor(x, y))
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b
      if (luminance < 70) darkCount += 1
      total += 1
    }
  }
  const darkRatio = total === 0 ? 0 : darkCount / total
  return darkRatio >= 0.45
}

async function handleHourly(text, msgTs) {
  let parsed = parseHourlyReport(text)
  if (parsed.error) {
    const ai = await extractOperationalIntent({
      text,
      stores: getStoresFromEnv(),
      now: getPartsFromTimestamp(msgTs)
    })
    if (ai?.kind === 'hourly' && ai.data?.store && ai.data?.target != null && ai.data?.achieved != null && ai.data?.walkIns != null) {
      parsed = {
        store: String(ai.data.store).trim(),
        target: Number(ai.data.target),
        achieved: Number(ai.data.achieved),
        walkIns: Number(ai.data.walkIns),
        hour: ai.data.hour ? String(ai.data.hour).trim() : null
      }
    } else {
      return { error: 'Invalid hourly report format' }
    }
  }

  const parts = getPartsFromTimestamp(msgTs)
  const hourBlock = parsed.hour || hourBlockFromHour(Number(parts.time.split(':')[0]))
  const row = [
    parts.date,
    parts.time,
    parsed.store,
    hourBlock,
    parsed.target,
    parsed.achieved,
    parsed.walkIns,
    text,
    parts.recordedAt
  ]
  await sheetHourly(row)
  return { ok: true, store: parsed.store, hourBlock }
}

async function handleOpening(text, msgTs, staffDress) {
  let store = parseStoreFromText(text)
  if (!store) {
    const ai = await extractOperationalIntent({
      text,
      stores: getStoresFromEnv(),
      now: getPartsFromTimestamp(msgTs)
    })
    if (ai?.kind === 'opening' && ai.data?.store) store = String(ai.data.store).trim()
  }
  if (!store) return { error: 'Missing store name in opening report' }

  const parts = getPartsFromTimestamp(msgTs)
  const openingTime = parseOpeningTimeFromText(text) || parts.time
  const late = isLateOpening(openingTime)
  const row = [
    parts.date,
    parts.time,
    store,
    openingTime,
    late ? 'YES' : 'NO',
    text,
    parts.recordedAt,
    staffDress || ''
  ]
  await sheetOpening(row)
  return { ok: true, late, store }
}

async function handleDressOnly(text, msgTs, staffDress) {
  const store = parseStoreFromText(text) || parseStoreFromLooseText(text)
  if (!store) return { error: 'Missing store name in dress photo' }
  const parts = getPartsFromTimestamp(msgTs)
  const sheetName = process.env.OPENING_SHEET_NAME || 'Sheet2'
  const updated = await updateStaffDress(sheetName, parts.date, store, staffDress)
  if (updated) return { ok: true, store, updated: true }

  const row = [parts.date, parts.time, store, '', '', text, parts.recordedAt, staffDress]
  await sheetOpening(row)
  return { ok: true, store, updated: false }
}

async function handleBigBill(text, msgTs) {
  const parts = getPartsFromTimestamp(msgTs)
  let parsed = parseBigBillFromText(text)
  if (!parsed) {
    const ai = await extractOperationalIntent({
      text,
      stores: getStoresFromEnv(),
      now: parts
    })
    if (!ai || ai.kind !== 'big_bill' || !ai.data?.store || !ai.data?.billValue) {
      return { error: 'Invalid big bill format' }
    }
    parsed = {
      store: String(ai.data.store).trim(),
      billValue: Number(ai.data.billValue),
      quantity: ai.data.quantity != null ? Number(ai.data.quantity) : null,
      assistedBy: ai.data.assistedBy ? String(ai.data.assistedBy).trim() : null,
      helpedBy: ai.data.helpedBy ? String(ai.data.helpedBy).trim() : null
    }
  }

  await saveBigBill({
    store: parsed.store,
    billValue: parsed.billValue,
    quantity: parsed.quantity,
    assistedBy: parsed.assistedBy,
    helpedBy: parsed.helpedBy,
    date: parts.date
  })

  return { ok: true, ...parsed, date: parts.date }
}

async function startSock() {
  let memoryReady = false
  let waConnectionState = 'starting'
  try {
    await initDb()
    memoryReady = true
    log.info('smart memory db ready')
  } catch (err) {
    log.warn({ err }, 'smart memory db unavailable, continuing without db memory')
  }
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: log,
    browser: ['HOF Ops Bot', 'Chrome', '1.0.0']
  })

  sock.ev.on('creds.update', saveCreds)

  async function rememberMessage(payload) {
    if (!memoryReady) return
    try {
      await saveGroupMessage(payload)
    } catch (err) {
      log.warn({ err }, 'saveGroupMessage failed')
    }
  }

  async function rememberKnowledge(payload) {
    if (!memoryReady) return
    try {
      await addKnowledge(payload)
    } catch (err) {
      log.warn({ err }, 'addKnowledge failed')
    }
  }

  async function loadRecentMessages(groupJid, limit) {
    if (!memoryReady) return []
    try {
      return await getRecentMessages(groupJid, limit)
    } catch (err) {
      log.warn({ err }, 'getRecentMessages failed')
      return []
    }
  }

  async function loadRecentKnowledge(groupJid, limit) {
    if (!memoryReady) return []
    try {
      return await getRecentKnowledge(groupJid, limit)
    } catch (err) {
      log.warn({ err }, 'getRecentKnowledge failed')
      return []
    }
  }

  async function sendAndRemember(groupJid, text) {
    if (waConnectionState !== 'open') {
      const err = new Error(`whatsapp not connected (${waConnectionState})`)
      err.code = 'WA_NOT_CONNECTED'
      throw err
    }
    await sock.sendMessage(groupJid, { text })
    await rememberMessage({
      groupJid,
      direction: 'outbound',
      messageType: 'text',
      textContent: text
    })
  }

  async function executeOpenClawAction(action) {
    log.info({ action }, 'openclaw action received')
    if (!action || typeof action !== 'object') {
      return { ok: false, error: 'invalid action payload' }
    }

    const type = String(action.action || '').trim()
    const message = typeof action.message === 'string' ? action.message.trim() : ''
    const allowedSheets = new Set([
      process.env.HOURLY_SHEET_NAME || 'Sheet1',
      process.env.OPENING_SHEET_NAME || 'Sheet2'
    ])

    if (!type) return { ok: false, error: 'missing action' }
    if (!message && ['send_group_message', 'ask_clarification', 'notify_manager'].includes(type)) {
      return { ok: false, error: 'missing message' }
    }

    if (type === 'send_group_message') {
      const groups = Array.isArray(action.targetGroups) && action.targetGroups.length ? action.targetGroups : ALLOWED_GROUPS
      let sent = 0
      for (const group of groups) {
        if (!ALLOWED_GROUPS.includes(group)) continue
        await sendAndRemember(group, message)
        sent += 1
        await sleep(randomGapMs())
      }
      log.info({ action: type, sent, groups }, 'openclaw action executed')
      return { ok: true, action: type, sent }
    }

    if (type === 'ask_clarification') {
      const targetGroup = typeof action.groupJid === 'string' && isAllowedGroup(action.groupJid) ? action.groupJid : null
      if (!targetGroup) return { ok: false, error: 'invalid clarification group' }
      await sendAndRemember(targetGroup, message)
      log.info({ action: type, targetGroup }, 'openclaw action executed')
      return { ok: true, action: type, sent: 1 }
    }

    if (type === 'notify_manager') {
      if (!MANAGERS_GROUP_ID) return { ok: false, error: 'manager group not configured' }
      await sendAndRemember(MANAGERS_GROUP_ID, message)
      log.info({ action: type, managerGroup: MANAGERS_GROUP_ID }, 'openclaw action executed')
      return { ok: true, action: type, sent: 1 }
    }

    if (type === 'update_sheet') {
      const sheetName = typeof action.sheetName === 'string' ? action.sheetName.trim() : ''
      const values = Array.isArray(action.values) ? action.values : []
      const appendRow = Boolean(action.appendRow)
      const range = typeof action.range === 'string' ? action.range.trim() : ''

      if (!sheetName) return { ok: false, error: 'missing sheetName' }
      if (!allowedSheets.has(sheetName)) return { ok: false, error: `sheet not allowed: ${sheetName}` }
      if (!values.length) return { ok: false, error: 'missing values' }

      if (appendRow) {
        for (const row of values) {
          if (!Array.isArray(row)) return { ok: false, error: 'appendRow values must be 2D array' }
          await appendSheetRow(sheetName, row)
        }
      } else {
        if (!range) return { ok: false, error: 'missing range' }
        await updateSheetRange(sheetName, range, values)
      }

      log.info({ action: type, sheetName, appendRow, range, rows: values.length }, 'openclaw action executed')
      return { ok: true, action: type, sheetName, updated: values.length }
    }

    return { ok: false, error: `unsupported action: ${type}` }
  }

  async function pushOpsEvent(event) {
    if (!isOpenClawEnabled()) return
    try {
      await sendOpsEventToOpenClaw(event)
    } catch (err) {
      log.warn({ err }, 'openclaw ops event failed')
    }
  }

  async function pushManagerEvent(event) {
    if (!isOpenClawEnabled()) return
    try {
      await sendManagerEventToOpenClaw(event)
    } catch (err) {
      log.warn({ err }, 'openclaw manager event failed')
    }
  }

  app.post('/openclaw/callback', async (req, res) => {
    try {
      if (!isAuthorizedCallback(req)) {
        log.warn({ headers: req.headers }, 'openclaw callback unauthorized')
        return res.status(401).json({ ok: false, error: 'unauthorized' })
      }

      const actions = Array.isArray(req.body?.actions) ? req.body.actions : [req.body]
      log.info({ actionsCount: actions.length, body: req.body }, 'openclaw callback accepted')
      const results = []

      for (const action of actions) {
        const result = await executeOpenClawAction(action)
        results.push(result)
      }

      log.info({ results }, 'openclaw callback completed')
      return res.json({ ok: true, results })
    } catch (err) {
      log.error({ err }, 'openclaw callback failed')
      return res.status(500).json({
        ok: false,
        error: 'callback failed',
        detail: err?.message || 'unknown error'
      })
    }
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (connection) {
      waConnectionState = connection
      latestWaStatus = connection
    }
    if (qr) {
      latestQrText = qr
      latestQrUpdatedAt = new Date().toISOString()
      qrcodeTerminal.generate(qr, { small: true })
      QRCode.toDataURL(qr, { margin: 1, width: 320 })
        .then(url => {
          latestQrImageUrl = url
          log.info({ qrUrl: `${getAppBaseUrl()}/qr` }, 'scan WhatsApp QR in browser')
        })
        .catch(err => log.warn({ err }, 'qr image generation failed'))
    }
    if (connection === 'open') {
      latestQrText = null
      latestQrImageUrl = null
      log.info({ waConnectionState }, 'connected')
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      log.warn({ code, waConnectionState }, 'connection closed')
      if (shouldReconnect) startSock().catch(err => log.error({ err }, 'reconnect failed'))
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    log.info({ type, count: messages.length }, 'messages.upsert')
    if (type !== 'notify' && type !== 'append') return
    for (const msg of messages) {
      try {
        const jid = msg.key.remoteJid
        log.info(
          { jid, fromMe: msg.key.fromMe, hasText: Boolean(msg.message) },
          'incoming message'
        )
        if (!jid || !isAllowedGroup(jid)) continue
        if (msg.key.fromMe) continue

        const sender = msg.key.participant || msg.key.remoteJid
        if (!isAllowedSender(sender)) continue

        let content = msg.message
        if (content?.ephemeralMessage?.message) content = content.ephemeralMessage.message
        if (content?.viewOnceMessage?.message) content = content.viewOnceMessage.message
        if (content?.viewOnceMessageV2?.message) content = content.viewOnceMessageV2.message

        const text =
          content?.conversation ||
          content?.extendedTextMessage?.text ||
          content?.imageMessage?.caption ||
          content?.documentMessage?.caption ||
          ''

        const upper = text.toUpperCase()
        const msgTs = Number(msg.messageTimestamp)
        const parts = getPartsFromTimestamp(msgTs)
        let staffDress = null
        const senderName = msg.pushName || null
        const isManagerGroup = Boolean(MANAGERS_GROUP_ID && jid === MANAGERS_GROUP_ID)
        const sessionKey = `${jid}:${parts.date}`

        await rememberMessage({
          groupJid: jid,
          senderJid: sender,
          senderName,
          direction: 'inbound',
          messageType: content?.imageMessage ? 'image' : 'text',
          textContent: text || '[media]'
        })

        if (!text) continue

        if (isManagerGroup && looksLikeManagerCommand(text)) {
          const managerAssistantChat = looksLikeManagerAssistantChat(text)
          await pushManagerEvent({
            groupJid: jid,
            senderJid: sender,
            senderName,
            timestamp: parts.recordedAt,
            text,
            eventType: managerAssistantChat ? 'manager_assistant_chat' : 'manager_command',
            allowedSheets: [process.env.HOURLY_SHEET_NAME || 'Sheet1', process.env.OPENING_SHEET_NAME || 'Sheet2'],
            storeGroups: ALLOWED_GROUPS,
            stores: getStoresFromEnv(),
            sessionKey
          })

          const cmd = await parseManagerCommand({
            text,
            stores: getStoresFromEnv(),
            allowedSheets: [process.env.HOURLY_SHEET_NAME || 'Sheet1', process.env.OPENING_SHEET_NAME || 'Sheet2'],
            storeGroups: ALLOWED_GROUPS
          })

          if (cmd?.action === 'send_group_message' && cmd.message) {
            const groups = Array.isArray(cmd.targetGroups) && cmd.targetGroups.length ? cmd.targetGroups : ALLOWED_GROUPS
            for (const group of groups) {
              if (!ALLOWED_GROUPS.includes(group)) continue
              await sendAndRemember(group, cmd.message)
              await sleep(randomGapMs())
            }
            await sendAndRemember(jid, 'Message sent to the store group successfully.')
            continue
          }

          if (cmd?.action === 'update_sheet' && cmd.sheetName && Array.isArray(cmd.values) && cmd.values.length) {
            const allowedSheets = new Set([
              process.env.HOURLY_SHEET_NAME || 'Sheet1',
              process.env.OPENING_SHEET_NAME || 'Sheet2'
            ])
            if (allowedSheets.has(cmd.sheetName)) {
              if (cmd.appendRow) {
                for (const row of cmd.values) {
                  await appendSheetRow(cmd.sheetName, row)
                }
              } else if (cmd.range) {
                await updateSheetRange(cmd.sheetName, cmd.range, cmd.values)
              }
              await sendAndRemember(jid, `Sheet update completed for ${cmd.sheetName}.`)
              continue
            }
          }

          if (managerAssistantChat) {
            log.info({ jid, text }, 'manager assistant chat handed to openclaw')
            continue
          }
        }

        if (content?.imageMessage) {
          try {
            const buffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              { logger: log, reuploadRequest: sock.updateMediaMessage }
            )
            const storeName = parseStoreFromText(text) || parseStoreFromLooseText(text) || 'Store'
            const aiDress = await analyzeDressImage({
              imageBuffer: buffer,
              storeName,
              caption: text
            })
            const isOk =
              aiDress && aiDress.confidence >= 0.55
                ? aiDress.compliant
                : await evaluateDressCode(buffer)
            staffDress = isOk ? 'uniform ok' : 'uniform not ok'
            if (!isOk) {
              await sendAndRemember(jid, `${storeName}: Uniform standard not met. Kindly correct and maintain dress policy.`)
              if (aiDress?.guidance) {
                await sendAndRemember(
                  jid,
                  `${storeName}: Please wear a proper all-black uniform. ${aiDress.guidance}`
                )
              }
            } else {
              await sendAndRemember(jid, `${storeName}: Appearance standards met. Keep up this professional standard.`)
            }
            await pushOpsEvent({
              eventType: 'dress_check',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: staffDress,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
          } catch (err) {
            log.error({ err }, 'dress check failed')
            staffDress = 'check failed'
          }
        }

        let handled = false

        if (/big\s*bill/i.test(text) || /assisted by/i.test(text) || /with the help of/i.test(text)) {
          const result = await handleBigBill(text, msgTs)
          if (!result.error) {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'performance',
              factText: `Big bill recorded for ${result.store}: ${result.billValue}.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              `Excellent work, ${result.store}. Big bill of ${formatINR(result.billValue)} has been recorded. Many more strong conversions to come.`
            )
            await pushOpsEvent({
              eventType: 'big_bill',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `big_bill:${result.store}:${result.billValue}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
            continue
          }
        }

        if (
          /STORE\s*[:\-]/i.test(text) &&
          /(TARGET|TODAY'?S\s*TARGET)\s*[:\-]/i.test(text) &&
          /ACHIEVED(\s*TILL\s*NOW)?\s*[:\-]/i.test(text) &&
          /WALK[\s\u2010-\u2015-]*INS/i.test(text)
        ) {
          const result = await handleHourly(text, msgTs)
          if (result.error) {
            await sendAndRemember(jid, 'Could not process this update. Please resend in the required format.')
          } else {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'performance',
              factText: `Hourly report recorded for ${result.store} for ${result.hourBlock}.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              `Thank you, ${result.store}. Your hourly report for ${result.hourBlock} has been recorded. Keep the momentum going.`
            )
            await pushOpsEvent({
              eventType: 'hourly_report',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `hourly:${result.store}:${result.hourBlock}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
          }
          handled = true
          continue
        }

        if (upper.includes('OPENING')) {
          const result = await handleOpening(text, msgTs, staffDress)
          if (result.error) {
            await sendAndRemember(jid, 'Could not process this update. Please resend in the required format.')
          } else if (result.late) {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'status',
              factText: `${result.store} opening was recorded late.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              `${result.store}, opening has been recorded after 10:30 AM. Please ensure timely opening from tomorrow.`
            )
          } else {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'status',
              factText: `${result.store} opening was recorded on time.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              `Good morning, ${result.store}. Opening is recorded on time. Wishing you a productive day ahead.`
            )
          }
          await pushOpsEvent({
            eventType: 'opening_report',
            groupJid: jid,
            senderJid: sender,
            senderName,
            timestamp: parts.recordedAt,
            text,
            structuredResult: `opening:${result.store}:${result.late ? 'late' : 'on_time'}`,
            stores: getStoresFromEnv(),
            recentKnowledge: await loadRecentKnowledge(jid, 8),
            sessionKey
          })
          handled = true
          continue
        }

        if (staffDress) {
          const result = await handleDressOnly(text, msgTs, staffDress)
          if (result.error) {
            await sendAndRemember(jid, 'Could not process this update. Please resend in the required format.')
          } else {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'status',
              factText: `${result.store} dress check result: ${staffDress}.`,
              sourceMessageId: msg.key.id || null
            })
          }
          handled = true
        }

        if (!handled && text.trim()) {
          const extracted = await extractOperationalIntent({
            text,
            stores: getStoresFromEnv(),
            now: getPartsFromTimestamp(msgTs)
          })

          if (extracted?.kind === 'hourly' && extracted.data?.store && extracted.data?.target != null && extracted.data?.achieved != null && extracted.data?.walkIns != null) {
            const parts = getPartsFromTimestamp(msgTs)
            const store = String(extracted.data.store).trim()
            const hourBlock = normalizeHourLabel(extracted.data.hour, parts.time)
            await sheetHourly([
              parts.date,
              parts.time,
              store,
              hourBlock,
              Number(extracted.data.target),
              Number(extracted.data.achieved),
              Number(extracted.data.walkIns),
              text,
              parts.recordedAt
            ])
            await rememberKnowledge({
              groupJid: jid,
              storeName: store,
              kind: 'performance',
              factText: `Hourly report recorded for ${store} for ${hourBlock}.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              `Thank you, ${store}. Your hourly report for ${hourBlock} has been recorded. Keep the momentum going.`
            )
            await pushOpsEvent({
              eventType: 'hourly_report_ai_extracted',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `hourly:${store}:${hourBlock}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
          } else if (extracted?.kind === 'opening' && extracted.data?.store) {
            const parts = getPartsFromTimestamp(msgTs)
            const store = String(extracted.data.store).trim()
            const openingTime = extracted.data.openingTime ? String(extracted.data.openingTime).trim() : parts.time
            const late = isLateOpening(openingTime)
            await sheetOpening([
              parts.date,
              parts.time,
              store,
              openingTime,
              late ? 'YES' : 'NO',
              text,
              parts.recordedAt,
              ''
            ])
            await rememberKnowledge({
              groupJid: jid,
              storeName: store,
              kind: 'status',
              factText: `${store} opening was recorded ${late ? 'late' : 'on time'}.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              late
                ? `${store}, opening has been recorded after 10:30 AM. Please ensure timely opening from tomorrow.`
                : `Good morning, ${store}. Opening is recorded on time. Wishing you a productive day ahead.`
            )
            await pushOpsEvent({
              eventType: 'opening_report_ai_extracted',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `opening:${store}:${late ? 'late' : 'on_time'}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
          } else if (extracted?.kind === 'big_bill' && extracted.data?.store && extracted.data?.billValue != null) {
            const result = await handleBigBill(text, msgTs)
            if (!result.error) {
              await rememberKnowledge({
                groupJid: jid,
                storeName: result.store,
                kind: 'performance',
                factText: `Big bill recorded for ${result.store}: ${result.billValue}.`,
                sourceMessageId: msg.key.id || null
              })
              await sendAndRemember(
                jid,
                `Excellent work, ${result.store}. Big bill of ${formatINR(result.billValue)} has been recorded. Many more strong conversions to come.`
              )
              await pushOpsEvent({
                eventType: 'big_bill_ai_extracted',
                groupJid: jid,
                senderJid: sender,
                senderName,
                timestamp: parts.recordedAt,
                text,
                structuredResult: `big_bill:${result.store}:${result.billValue}`,
                stores: getStoresFromEnv(),
                recentKnowledge: await loadRecentKnowledge(jid, 8),
                sessionKey
              })
              handled = true
            }
          } else if (extracted?.shouldAskClarification && extracted.clarification) {
            await sendAndRemember(jid, extracted.clarification)
            await pushOpsEvent({
              eventType: 'clarification_requested',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: 'clarification',
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
          }
        }

        if (!handled && text.trim()) {
          const smart = await decideSmartReply({
            latestText: text,
            senderName,
            stores: getStoresFromEnv(),
            recentMessages: await loadRecentMessages(jid, 25),
            recentKnowledge: await loadRecentKnowledge(jid, 15),
            now: getNowParts()
          })

          if (smart?.facts?.length) {
            for (const fact of smart.facts) {
              if (!fact?.fact) continue
              await rememberKnowledge({
                groupJid: jid,
                storeName: typeof fact.store === 'string' ? fact.store.trim() || null : null,
                kind: typeof fact.kind === 'string' ? fact.kind : 'note',
                factText: String(fact.fact).trim(),
                sourceMessageId: msg.key.id || null
              })
            }
          }

          if (smart?.shouldReply && smart.reply) {
            await sendAndRemember(jid, smart.reply)
          }

          await pushOpsEvent({
            eventType: 'unhandled_group_message',
            groupJid: jid,
            senderJid: sender,
            senderName,
            timestamp: parts.recordedAt,
            text,
            structuredResult: smart?.shouldReply ? 'smart_reply' : 'no_action',
            stores: getStoresFromEnv(),
            recentKnowledge: await loadRecentKnowledge(jid, 8),
            sessionKey
          })
        }
      } catch (err) {
        log.error({ err }, 'message handler error')
      }
    }
  })

  // Opening reminder at 10:30 AM IST
  cron.schedule(
    '30 10 * * *',
    async () => {
      const stores = getStoresFromEnv()
      if (stores.length === 0) return

      const now = getNowParts()
      const rows = await getSheetRows(process.env.OPENING_SHEET_NAME || 'Sheet2')
      const reported = new Set(
        rows
          .slice(1)
          .filter(r => r[0] === now.date)
          .map(r => (r[2] || '').toString().trim().toLowerCase())
      )

      const missing = stores.filter(s => !reported.has(s.toLowerCase()))
      if (missing.length === 0) return
      const storesText = storeListText(missing)
      for (const group of ALLOWED_GROUPS) {
        const msg = `Pending opening report: ${storesText}. Kindly send your opening update immediately.`
        await sendAndRemember(group, msg)
        await sleep(randomGapMs())
      }
    },
    { timezone: TIMEZONE }
  )

  // Hourly reminder at :45 from 2 PM to 7 PM
  cron.schedule(
    '45 14-19 * * *',
    async () => {
      const stores = getStoresFromEnv()
      if (stores.length === 0) return

      const now = getNowParts()
      const hourBlock = hourBlockFromHour(Number(now.time.split(':')[0]))
      const rows = await getSheetRows(process.env.HOURLY_SHEET_NAME || 'Sheet1')
      const reported = new Set(
        rows
          .slice(1)
          .filter(r => r[0] === now.date && (r[3] || '').toString().trim() === hourBlock)
          .map(r => (r[2] || '').toString().trim().toLowerCase())
      )

      const missing = stores.filter(s => !reported.has(s.toLowerCase()))
      if (missing.length === 0) return
      const storesText = storeListText(missing)
      for (const group of ALLOWED_GROUPS) {
        const msg = `${storesText}, please send your hourly sales report for ${hourBlock}.`
        await sendAndRemember(group, msg)
        await sleep(randomGapMs())
      }
    },
    { timezone: TIMEZONE }
  )

  // Warning at :55 for still-missing hourly reports
  cron.schedule(
    '55 14-19 * * *',
    async () => {
      const stores = getStoresFromEnv()
      if (stores.length === 0) return

      const now = getNowParts()
      const hourBlock = hourBlockFromHour(Number(now.time.split(':')[0]))
      const rows = await getSheetRows(process.env.HOURLY_SHEET_NAME || 'Sheet1')
      const reported = new Set(
        rows
          .slice(1)
          .filter(r => r[0] === now.date && (r[3] || '').toString().trim() === hourBlock)
          .map(r => (r[2] || '').toString().trim().toLowerCase())
      )

      const missing = stores.filter(s => !reported.has(s.toLowerCase()))
      if (missing.length === 0) return
      const storesText = storeListText(missing)

      for (const group of ALLOWED_GROUPS) {
        const msg = `${storesText} have not submitted ${hourBlock} report. Kindly update immediately.`
        await sendAndRemember(group, msg)
        await sleep(randomGapMs())
      }
    },
    { timezone: TIMEZONE }
  )

  // Daily top store celebration at 7:00 PM IST (based on Sheet1 achieved totals)
  cron.schedule(
    '0 19 * * *',
    async () => {
      const now = getNowParts()
      const rows = await getSheetRows(process.env.HOURLY_SHEET_NAME || 'Sheet1')
      const todayRows = rows.slice(1).filter(r => r[0] === now.date)
      if (todayRows.length === 0) return

      const agg = new Map()
      for (const r of todayRows) {
        const store = (r[2] || '').toString().trim()
        if (!store) continue
        const achieved = toNumber(r[5])
        const qty = toNumber(r[6])
        const prev = agg.get(store) || { achieved: 0, qty: 0 }
        agg.set(store, { achieved: prev.achieved + achieved, qty: prev.qty + qty })
      }
      if (agg.size === 0) return

      let topStore = null
      let top = { achieved: -1, qty: 0 }
      for (const [store, stats] of agg.entries()) {
        if (stats.achieved > top.achieved) {
          topStore = store
          top = stats
        }
      }
      if (!topStore) return

      const msg =
        `Let’s make some noise\n` +
        `Wow Bill\n` +
        `🤩🤩🤩🤩🤩🤩🤩🤩\n` +
        `🛍️🎊🛍️🎉🛍️🎊🛍️🎉\n\n` +
        `${topStore} store*\n\n` +
        `Value - *${formatINR(top.achieved)}*\n\n` +
        `Quantity - *${top.qty}*\n\n` +
        `👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻\n\n` +
        `Many more to come\n\n` +
        `So proud of you\n\n` +
        `🙏🙏🙏🙏🙏🙏\n` +
        `🧿🧿🧿🧿🧿🧿\n` +
        `💯💯💯💯💯💯`

      for (const group of ALLOWED_GROUPS) {
        await sendAndRemember(group, msg)
        await sleep(randomGapMs())
      }
    },
    { timezone: TIMEZONE }
  )

  // Daily top big bill summary at 8:00 PM IST
  cron.schedule(
    '0 20 * * *',
    async () => {
      const now = getNowParts()
      const topBill = await getTopBigBillForDate(now.date)
      if (!topBill) return

      const storeMsg =
        `Let’s make some noise\n` +
        `Big Bill Store Of The Day\n\n` +
        `${topBill.store} store\n\n` +
        `Value - *${formatINR(topBill.billValue)}*\n` +
        `${topBill.assistedBy ? `Assisted by - ${topBill.assistedBy}\n` : ''}` +
        `${topBill.helpedBy ? `Supported by - ${topBill.helpedBy}\n` : ''}\n` +
        `Outstanding effort from the team. Many more strong bills to come.`

      for (const group of ALLOWED_GROUPS) {
        await sendAndRemember(group, storeMsg)
        await sleep(randomGapMs())
      }

      if (MANAGERS_GROUP_ID) {
        const managerMsg =
          `Daily big bill update:\n` +
          `Top store: ${topBill.store}\n` +
          `Bill value: ${formatINR(topBill.billValue)}\n` +
          `${topBill.assistedBy ? `Assisted by: ${topBill.assistedBy}\n` : ''}` +
          `${topBill.helpedBy ? `Supported by: ${topBill.helpedBy}\n` : ''}` +
          `Status: shared with store group.`
        await sendAndRemember(MANAGERS_GROUP_ID, managerMsg)
      }
    },
    { timezone: TIMEZONE }
  )
}

app.listen(port, () =>
  log.info(
    {
      port,
      healthUrl: `${getAppBaseUrl()}/health`,
      qrUrl: `${getAppBaseUrl()}/qr`
    },
    'server on'
  )
)

startSock().catch(err => log.error({ err }, 'fatal error'))
