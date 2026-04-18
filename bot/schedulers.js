import cron from 'node-cron'
import { getSheetRows } from '../services/sheets.js'
import { syncBigBillSheetFromRawMessages } from './handlers/operations.js'
import { buildDailyBigBillLeaderboardMessage } from './leaderboard.js'
import { TIMEZONE } from './runtime.js'
import { isBotPaused } from './state.js'
import {
  ALLOWED_GROUPS,
  buildStoreReminderPayload,
  canonicalStoreName,
  getStoresFromEnv
} from './storeConfig.js'
import {
  getNowParts,
  hourBlockFromHour,
  normalizeHourLabel,
  randomGapMs,
  sleep
} from './time.js'

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
    '30 21 * * *',
    async () => {
      if (isBotPaused(state)) return

      await syncBigBillSheetFromRawMessages({ maxRows: 500 })

      const now = getNowParts()
      const leaderboardMessage = await buildDailyBigBillLeaderboardMessage(now.date)
      if (!leaderboardMessage) return

      for (const group of ALLOWED_GROUPS) {
        await sendAndRemember(group, leaderboardMessage)
        await sleep(randomGapMs())
      }
    },
    { timezone: TIMEZONE }
  )
}
