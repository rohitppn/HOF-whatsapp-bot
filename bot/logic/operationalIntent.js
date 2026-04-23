import { parseHourlyReport } from '../../services/parser.js'
import {
  parseBigBillFromText,
  parseOpeningTimeFromText,
  parseStoreFromLooseText,
  parseStoreFromText
} from '../messageUtils.js'
import { canonicalStoreName, getStoreFromSenderJid } from '../storeConfig.js'

function normalizeNumber(value) {
  if (value == null || value === '') return null
  const digits = String(value).replace(/[^\d.]/g, '')
  if (!digits) return null
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanPerson(value) {
  const cleaned = String(value || '')
    .replace(/^[^\p{L}\p{N}]+/gu, '')
    .replace(/[^\p{L}\p{N}\s.&'-]+$/gu, '')
    .trim()
  return cleaned || null
}

function detectBigBill(text, stores, senderJid) {
  const parsed = parseBigBillFromText(text)
  const inferredStore = getStoreFromSenderJid(senderJid, stores)

  if (!parsed?.billValue) return null

  const store =
    canonicalStoreName(parsed.store || inferredStore, stores) ||
    parsed.store ||
    inferredStore

  if (!store) return null

  return {
    kind: 'big_bill',
    shouldAskClarification: false,
    clarification: null,
    data: {
      store,
      openingTime: null,
      target: null,
      achieved: null,
      walkIns: null,
      hour: null,
      billValue: normalizeNumber(parsed.billValue),
      quantity: parsed.quantity != null ? Number(parsed.quantity) : null,
      assistedBy: cleanPerson(parsed.assistedBy),
      helpedBy: cleanPerson(parsed.helpedBy)
    }
  }
}

function detectHourly(text, stores, senderJid) {
  const parsed = parseHourlyReport(text)
  if (parsed.error) return null

  const inferredStore = getStoreFromSenderJid(senderJid, stores)
  const store =
    canonicalStoreName(parsed.store || inferredStore, stores) ||
    parsed.store ||
    inferredStore

  if (!store) {
    return {
      kind: 'hourly',
      shouldAskClarification: true,
      clarification: 'Please mention the store name in the sales update.',
      data: {
        store: null,
        openingTime: null,
        target: parsed.target,
        achieved: parsed.achieved,
        walkIns: parsed.walkIns,
        hour: parsed.hour || null,
        billValue: null,
        quantity: null,
        assistedBy: null,
        helpedBy: null
      }
    }
  }

  return {
    kind: 'hourly',
    shouldAskClarification: false,
    clarification: null,
    data: {
      store,
      openingTime: null,
      target: parsed.target,
      achieved: parsed.achieved,
      walkIns: parsed.walkIns,
      hour: parsed.hour || null,
      billValue: null,
      quantity: null,
      assistedBy: null,
      helpedBy: null
    }
  }
}

function detectOpening(text, stores, senderJid) {
  const explicitStore = parseStoreFromText(text) || parseStoreFromLooseText(text)
  const inferredStore = getStoreFromSenderJid(senderJid, stores)
  const store =
    canonicalStoreName(explicitStore || inferredStore, stores) ||
    explicitStore ||
    inferredStore
  const openingTime = parseOpeningTimeFromText(text)

  if (!/\bopening\b/i.test(text) && !openingTime) return null

  if (!store) {
    return {
      kind: 'opening',
      shouldAskClarification: true,
      clarification: 'Please mention the store name in the opening update.',
      data: {
        store: null,
        openingTime: openingTime || null,
        target: null,
        achieved: null,
        walkIns: null,
        hour: null,
        billValue: null,
        quantity: null,
        assistedBy: null,
        helpedBy: null
      }
    }
  }

  return {
    kind: 'opening',
    shouldAskClarification: false,
    clarification: null,
    data: {
      store,
      openingTime: openingTime || null,
      target: null,
      achieved: null,
      walkIns: null,
      hour: null,
      billValue: null,
      quantity: null,
      assistedBy: null,
      helpedBy: null
    }
  }
}

export function extractOperationalIntentLocal({ text, stores = [], senderJid = null }) {
  const body = String(text || '').trim()
  if (!body) return null

  const hourly = detectHourly(body, stores, senderJid)
  if (hourly) return hourly

  const bigBill = detectBigBill(body, stores, senderJid)
  if (bigBill) return bigBill

  const opening = detectOpening(body, stores, senderJid)
  if (opening) return opening

  return {
    kind: 'none',
    shouldAskClarification: false,
    clarification: null,
    data: {
      store: null,
      openingTime: null,
      target: null,
      achieved: null,
      walkIns: null,
      hour: null,
      billValue: null,
      quantity: null,
      assistedBy: null,
      helpedBy: null
    }
  }
}
