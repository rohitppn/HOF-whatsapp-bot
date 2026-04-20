import { parseHourlyReport } from '../../services/parser.js'
import {
  getSheetRows,
  sheetBigBill,
  sheetHourly,
  sheetOpening,
  updateSheetRange
} from '../../services/sheets.js'
import {
  canonicalStoreName,
  getStoreFromSenderJid,
  getStoresFromEnv
} from '../storeConfig.js'
import {
  answerManagerAssistant,
  decideSmartReply,
  extractOperationalIntent,
  parseManagerCommand
} from '../../services/openai.js'
import { saveBigBill } from '../../services/bigBills.js'
import {
  parseBigBillFromText,
  parseOpeningTimeFromText,
  parseStoreFromText
} from '../messageUtils.js'
import {
  getNowParts,
  getPartsFromTimestamp,
  hourBlockFromHour,
  isLateOpening
} from '../time.js'

function coerceBigBillValue(value) {
  if (value == null || value === '') return ''
  const digits = String(value).replace(/[^\d.]/g, '')
  if (!digits) return ''
  const num = Number(digits)
  return Number.isFinite(num) ? Math.round(num) : ''
}

function normalizeBigBillExtract(parsed) {
  if (!parsed) return null

  const store = canonicalStoreName(parsed.store, getStoresFromEnv()) || String(parsed.store || '').trim()
  const billValue = coerceBigBillValue(parsed.billValue)
  const quantity =
    parsed.quantity == null || parsed.quantity === ''
      ? ''
      : Number.isFinite(Number(parsed.quantity))
        ? Number(parsed.quantity)
        : ''

  return {
    store: store || '',
    billValue,
    quantity,
    assistedBy: String(parsed.assistedBy || '').trim(),
    helpedBy: String(parsed.helpedBy || '').trim()
  }
}

function rowNeedsBigBillBackfill(row) {
  const rawMessage = String(row?.[7] || '').trim()
  if (!rawMessage) return false

  return [2, 3, 4, 5, 6].some(index => !String(row?.[index] || '').trim())
}

async function extractBigBillFromRawMessage(rawMessage, now, senderJid = null) {
  const regexParsed = normalizeBigBillExtract(parseBigBillFromText(rawMessage))
  if (regexParsed?.store && regexParsed.billValue) return regexParsed

  const inferredStoreFromSender = getStoreFromSenderJid(senderJid, getStoresFromEnv())

  const ai = await extractOperationalIntent({
    text: rawMessage,
    stores: getStoresFromEnv(),
    now,
    senderJid
  })

  if (
    !ai ||
    ai.kind !== 'big_bill' ||
    (!ai.data?.store && !inferredStoreFromSender) ||
    ai.data?.billValue == null
  ) {
    return regexParsed
  }

  return normalizeBigBillExtract({
    store: ai.data.store || inferredStoreFromSender,
    billValue: ai.data.billValue,
    quantity: ai.data.quantity,
    assistedBy: ai.data.assistedBy,
    helpedBy: ai.data.helpedBy
  })
}

export async function syncBigBillSheetFromRawMessages({ maxRows = 100 } = {}) {
  const sheetName = process.env.BIG_BILL_SHEET_NAME || 'Sheet3'
  const rows = await getSheetRows(sheetName)
  if (rows.length <= 1) return 0

  const headerOffset = 2
  const dataRows = rows.slice(1)
  const startIndex = Math.max(0, dataRows.length - maxRows)
  let updatedCount = 0

  for (let i = startIndex; i < dataRows.length; i += 1) {
    const row = dataRows[i]
    if (!rowNeedsBigBillBackfill(row)) continue

    const rawMessage = String(row?.[7] || '').trim()
    if (!rawMessage) continue

    const extracted = await extractBigBillFromRawMessage(rawMessage, {
      date: String(row?.[0] || '').trim(),
      time: String(row?.[1] || '').trim(),
      recordedAt: String(row?.[8] || '').trim()
    })

    if (!extracted?.store || !extracted.billValue) continue

    const current = {
      store: String(row?.[2] || '').trim(),
      billValue: coerceBigBillValue(row?.[3]),
      quantity: String(row?.[4] || '').trim(),
      assistedBy: String(row?.[5] || '').trim(),
      helpedBy: String(row?.[6] || '').trim()
    }

    const next = [
      current.store || extracted.store || '',
      current.billValue || extracted.billValue || '',
      current.quantity || extracted.quantity || '',
      current.assistedBy || extracted.assistedBy || '',
      current.helpedBy || extracted.helpedBy || ''
    ]

    const changed =
      String(current.store || '') !== String(next[0] || '') ||
      String(current.billValue || '') !== String(next[1] || '') ||
      String(current.quantity || '') !== String(next[2] || '') ||
      String(current.assistedBy || '') !== String(next[3] || '') ||
      String(current.helpedBy || '') !== String(next[4] || '')

    if (!changed) continue

    await updateSheetRange(sheetName, `C${headerOffset + i}:G${headerOffset + i}`, [next])
    updatedCount += 1
  }

  return updatedCount
}

export async function handleHourly(text, msgTs, senderJid = null) {
  let parsed = parseHourlyReport(text)
  if (parsed.error) {
    const ai = await extractOperationalIntent({
      text,
      stores: getStoresFromEnv(),
      now: getPartsFromTimestamp(msgTs),
      senderJid
    })
    if (
      ai?.kind === 'hourly' &&
      ai.data?.store &&
      ai.data?.target != null &&
      ai.data?.achieved != null &&
      ai.data?.walkIns != null
    ) {
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
  const savedToSheets = await sheetHourly([
    parts.date,
    parts.time,
    parsed.store,
    hourBlock,
    parsed.target,
    parsed.achieved,
    parsed.walkIns,
    text,
    parts.recordedAt
  ])

  return { ok: true, store: parsed.store, hourBlock, savedToSheets }
}

export async function handleOpening(text, msgTs, senderJid = null) {
  let store = parseStoreFromText(text)
  if (!store) {
    const ai = await extractOperationalIntent({
      text,
      stores: getStoresFromEnv(),
      now: getPartsFromTimestamp(msgTs),
      senderJid
    })
    if (ai?.kind === 'opening' && ai.data?.store) {
      store = String(ai.data.store).trim()
    }
  }

  if (!store) return { error: 'Missing store name in opening report' }

  const parts = getPartsFromTimestamp(msgTs)
  const openingTime = parseOpeningTimeFromText(text) || parts.time
  const late = isLateOpening(openingTime)
  const savedToSheets = await sheetOpening([
    parts.date,
    parts.time,
    store,
    openingTime,
    late ? 'YES' : 'NO',
    text,
    parts.recordedAt,
    ''
  ])

  return { ok: true, late, store, savedToSheets }
}

export async function handleBigBill(text, msgTs, senderJid = null) {
  const parts = getPartsFromTimestamp(msgTs)
  let parsed = parseBigBillFromText(text)
  const inferredStoreFromSender = getStoreFromSenderJid(senderJid, getStoresFromEnv())

  if (parsed && !parsed.store && inferredStoreFromSender) {
    parsed = { ...parsed, store: inferredStoreFromSender }
  }

  if (!parsed) {
    const extracted = await extractBigBillFromRawMessage(text, parts, senderJid)
    if (!extracted?.store || !extracted.billValue) {
      return { error: 'Invalid big bill format' }
    }
    parsed = extracted
  } else {
    parsed = normalizeBigBillExtract({
      ...parsed,
      store: parsed.store || inferredStoreFromSender
    })
    if (!parsed?.store || !parsed.billValue) {
      return { error: 'Invalid big bill format' }
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

  const savedToSheets = await sheetBigBill([
    parts.date,
    parts.time,
    parsed.store,
    parsed.billValue,
    parsed.quantity ?? '',
    parsed.assistedBy || '',
    parsed.helpedBy || '',
    text,
    parts.recordedAt
  ])

  if (savedToSheets) {
    await syncBigBillSheetFromRawMessages({ maxRows: 100 })
  }

  return { ok: true, ...parsed, date: parts.date, savedToSheets }
}

export {
  answerManagerAssistant,
  decideSmartReply,
  extractOperationalIntent,
  getNowParts,
  getPartsFromTimestamp,
  parseManagerCommand
}
