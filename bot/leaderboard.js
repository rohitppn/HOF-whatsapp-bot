import { getSheetRows } from '../services/sheets.js'
import { formatINR, toNumber } from './messageUtils.js'
import { TIMEZONE } from './runtime.js'
import { canonicalStoreName, getStoresFromEnv } from './storeConfig.js'

function formatLeaderboardDate(dateText) {
  const [year, month, day] = String(dateText || '').split('-').map(Number)
  if (!year || !month || !day) return String(dateText || '')

  const date = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date)
}

function getBigBillPerformer(row) {
  const assistedBy = String(row?.[5] || '').trim()
  const helpedBy = String(row?.[6] || '').trim()

  if (assistedBy && helpedBy) return `${assistedBy} & ${helpedBy}`
  return assistedBy || helpedBy || 'Team'
}

function getBigBillStore(row, stores) {
  const rawStore = String(row?.[2] || '').trim()
  return canonicalStoreName(rawStore, stores) || rawStore
}

function buildLeaderboardValueText(values) {
  const numbers = values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0)

  if (!numbers.length) return '₹0'
  if (numbers.length === 1) return `₹${formatINR(numbers[0])}`

  const total = numbers.reduce((sum, value) => sum + value, 0)
  return `${numbers.map(value => `₹${formatINR(value)}`).join(' + ')} = ₹${formatINR(total)}`
}

function buildBigBillLeaderboard(rows, stores) {
  const aggregate = new Map()

  for (const row of rows) {
    const store = getBigBillStore(row, stores)
    const performer = getBigBillPerformer(row)
    const billValue = toNumber(row?.[3])
    if (!store || !billValue) continue

    const key = `${performer}|||${store}`
    const previous = aggregate.get(key) || {
      performer,
      store,
      values: [],
      total: 0
    }

    previous.values.push(billValue)
    previous.total += billValue
    aggregate.set(key, previous)
  }

  return [...aggregate.values()].sort((a, b) => b.total - a.total)
}

function buildLeaderboardMessage(dateText, leaders) {
  const medals = ['🥇', '🥈', '🥉']
  const topThree = leaders.slice(0, 3)
  if (!topThree.length) return null

  const lines = topThree.map(
    (entry, index) =>
      `${medals[index] || '🏅'} ${entry.performer} | ${entry.store} – ${buildLeaderboardValueText(entry.values)}`
  )

  return (
    `🏆 Today’s Leaderboard – Store Performance\n\n` +
    `📅 ${formatLeaderboardDate(dateText)}\n\n` +
    `${lines.join('\n\n')}\n\n\n` +
    `🏆${topThree[0].performer} declared as top performer for today!`
  )
}

export async function buildDailyBigBillLeaderboardMessage(dateText) {
  const rows = await getSheetRows(process.env.BIG_BILL_SHEET_NAME || 'Sheet3')
  const todayRows = rows
    .slice(1)
    .filter(row => String(row?.[0] || '').trim() === dateText)

  if (!todayRows.length) return null

  const leaders = buildBigBillLeaderboard(todayRows, getStoresFromEnv())
  if (!leaders.length) return null

  return buildLeaderboardMessage(dateText, leaders)
}
