import cron from 'node-cron'
import { getSheetRows } from '../services/sheets.js'
import { getTopBigBillForDate } from '../services/bigBills.js'
import { TIMEZONE } from './runtime.js'
import { isBotPaused } from './state.js'
import {
  ALLOWED_GROUPS,
  MANAGERS_GROUP_ID,
  buildStoreReminderPayload,
  canonicalStoreName,
  getStoresFromEnv
} from './storeConfig.js'
import {
  buildBigBillCelebrationMessage,
  formatINR,
  toNumber
} from './messageUtils.js'
import {
  getNowParts,
  hourBlockFromHour,
  normalizeHourLabel,
  randomGapMs,
  sleep
} from './time.js'

function buildReportedStoreSet(storeValues, stores) {
  const reported = new Set()

  for (const value of storeValues) {
    const raw = (value || '').toString().trim()
    if (!raw) continue
    const canonical = canonicalStoreName(raw, stores) || raw
    reported.add(canonical.toLowerCase())
  }

  return reported
}

function buildHourlyReportedStoreSet(rows, now, stores, expectedHourBlock) {
  const reported = new Set()

  for (const row of rows.slice(1)) {
    if (row[0] !== now.date) continue

    const rowHourBlock = normalizeHourLabel(row[3], now.time)
    if (rowHourBlock !== expectedHourBlock) continue

    const rawStore = (row[2] || '').toString().trim()
    if (!rawStore) continue

    const canonical = canonicalStoreName(rawStore, stores) || rawStore
    reported.add(canonical.toLowerCase())
  }

  return reported
}

export function registerScheduledJobs({ state, sendAndRemember }) {
  cron.schedule(
    '30 10 * * *',
    async () => {
      if (isBotPaused(state)) return

      const stores = getStoresFromEnv()
      if (stores.length === 0) return

      const now = getNowParts()
      const rows = await getSheetRows(process.env.OPENING_SHEET_NAME || 'Sheet2')
      const reported = buildReportedStoreSet(
        rows
          .slice(1)
          .filter(r => r[0] === now.date)
          .map(r => r[2]),
        stores
      )

      const missing = stores.filter(
        s => !reported.has((canonicalStoreName(s, stores) || s).toLowerCase())
      )
      if (missing.length === 0) return

      const msg = buildStoreReminderPayload(
        missing,
        'Kindly send your opening update immediately.'
      )
      for (const group of ALLOWED_GROUPS) {
        await sendAndRemember(group, msg)
        await sleep(randomGapMs())
      }
    },
    { timezone: TIMEZONE }
  )

  cron.schedule(
    '0 15,17,19 * * *',
    async () => {
      if (isBotPaused(state)) return

      const stores = getStoresFromEnv()
      if (stores.length === 0) return

      const now = getNowParts()
      const reminderHours = {
        15: '2-3 PM',
        17: '4-5 PM',
        19: '6-7 PM'
      }
      const hourBlock =
        reminderHours[Number(now.time.split(':')[0])] ||
        hourBlockFromHour(Number(now.time.split(':')[0]))
      const rows = await getSheetRows(process.env.HOURLY_SHEET_NAME || 'Sheet1')
      const reported = buildHourlyReportedStoreSet(rows, now, stores, hourBlock)

      const missing = stores.filter(
        s => !reported.has((canonicalStoreName(s, stores) || s).toLowerCase())
      )
      if (missing.length === 0) return

      const msg = buildStoreReminderPayload(
        missing,
        `please send your hourly sales report for ${hourBlock}.`
      )
      for (const group of ALLOWED_GROUPS) {
        await sendAndRemember(group, msg)
        await sleep(randomGapMs())
      }
    },
    { timezone: TIMEZONE }
  )

  cron.schedule(
    '0 20 * * *',
    async () => {
      if (isBotPaused(state)) return

      const now = getNowParts()
      const rows = await getSheetRows(process.env.HOURLY_SHEET_NAME || 'Sheet1')
      const todayRows = rows.slice(1).filter(r => r[0] === now.date)
      if (todayRows.length === 0) return

      const aggregate = new Map()
      for (const row of todayRows) {
        const store = (row[2] || '').toString().trim()
        if (!store) continue

        const achieved = toNumber(row[5])
        const qty = toNumber(row[6])
        const previous = aggregate.get(store) || { achieved: 0, qty: 0 }
        aggregate.set(store, {
          achieved: previous.achieved + achieved,
          qty: previous.qty + qty
        })
      }

      const rankedStores = [...aggregate.entries()].sort(
        (a, b) => b[1].achieved - a[1].achieved
      )
      const [topStore, top] = rankedStores[0] || []
      if (!topStore) return

      const msg =
        `Let’s make some noise\n` +
        `${topStore} store\n` +
        `🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥\n\n` +
        `🛍️🎊🛍️🎉🛍️🎊🛍️🎉\n\n` +
        `Shop Of The Day\n` +
        `🛍️ ${topStore} store 🛍️\n\n` +
        `*Achievement – ${formatINR(top.achieved)}*\n\n` +
        `Walk-ins – ${top.qty}\n\n` +
        `👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻👏🏻\n\n` +
        `Outstanding work team.\n` +
        `Many more strong bills and conversions to come!\n\n` +
        `🧿🧿🧿🧿🧿🧿🧿🧿🧿🧿🧿🧿`

      for (const group of ALLOWED_GROUPS) {
        await sendAndRemember(group, msg)
        await sleep(randomGapMs())
      }

      if (!MANAGERS_GROUP_ID) return

      const openingRows = await getSheetRows(process.env.OPENING_SHEET_NAME || 'Sheet2')
      const todayOpenings = openingRows.slice(1).filter(r => r[0] === now.date)
      const lateOpenings = todayOpenings
        .filter(r => String(r[4] || '').trim().toUpperCase() === 'YES')
        .map(r => (r[2] || '').toString().trim())
        .filter(Boolean)

      const allStoreLines = rankedStores
        .map(
          ([store, stats], index) =>
            `${index + 1}. ${store} - ${formatINR(stats.achieved)} | Walk-ins: ${stats.qty}`
        )
        .join('\n')

      const topThreeLines = rankedStores
        .slice(0, 3)
        .map(
          ([store, stats], index) =>
            `${index + 1}. ${store} - ${formatINR(stats.achieved)}`
        )
        .join('\n')

      const managerMsg =
        `Daily HOF manager update - ${now.date}\n\n` +
        `Highest sales store:\n` +
        `${topStore} - ${formatINR(top.achieved)} | Walk-ins: ${top.qty}\n\n` +
        `Top 3 performers today:\n${topThreeLines}\n\n` +
        `All store sales today:\n${allStoreLines}\n\n` +
        `Late openings:\n${lateOpenings.length ? lateOpenings.join(', ') : 'No late openings recorded'}\n\n` +
        `Store-group appreciation status: shared`

      await sendAndRemember(MANAGERS_GROUP_ID, managerMsg)
    },
    { timezone: TIMEZONE }
  )

  cron.schedule(
    '5 20 * * *',
    async () => {
      if (isBotPaused(state)) return

      const now = getNowParts()
      const topBill = await getTopBigBillForDate(now.date)
      if (!topBill) return

      const storeMsg = buildBigBillCelebrationMessage(topBill)
      for (const group of ALLOWED_GROUPS) {
        await sendAndRemember(group, storeMsg)
        await sleep(randomGapMs())
      }

      if (MANAGERS_GROUP_ID && !ALLOWED_GROUPS.includes(MANAGERS_GROUP_ID)) {
        await sendAndRemember(MANAGERS_GROUP_ID, storeMsg)
      }
    },
    { timezone: TIMEZONE }
  )
}
