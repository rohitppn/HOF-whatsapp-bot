import { parseHourlyReport } from '../../services/parser.js'
import {
  sheetBigBill,
  sheetHourly,
  sheetOpening
} from '../../services/sheets.js'
import {
  answerManagerAssistant,
  decideSmartReply,
  extractOperationalIntent,
  parseManagerCommand
} from '../../services/openai.js'
import { saveBigBill } from '../../services/bigBills.js'
import { getStoresFromEnv } from '../storeConfig.js'
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

export async function handleHourly(text, msgTs) {
  let parsed = parseHourlyReport(text)
  if (parsed.error) {
    const ai = await extractOperationalIntent({
      text,
      stores: getStoresFromEnv(),
      now: getPartsFromTimestamp(msgTs)
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

export async function handleOpening(text, msgTs) {
  let store = parseStoreFromText(text)
  if (!store) {
    const ai = await extractOperationalIntent({
      text,
      stores: getStoresFromEnv(),
      now: getPartsFromTimestamp(msgTs)
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

export async function handleBigBill(text, msgTs) {
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
