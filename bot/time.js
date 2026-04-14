import { TIMEZONE } from './runtime.js'

export function getPartsFromDate(date) {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })

  const dateStr = dateFormatter.format(date)
  const timeStr = timeFormatter.format(date)

  return {
    date: dateStr,
    time: timeStr.slice(0, 5),
    recordedAt: `${dateStr} ${timeStr}`
  }
}

export function getPartsFromTimestamp(tsSeconds) {
  return getPartsFromDate(new Date(Number(tsSeconds) * 1000))
}

export function hourBlockFromHour(hour24) {
  const h = Number(hour24)
  const start = h % 12 === 0 ? 12 : h % 12
  const end = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${start}-${end} ${suffix}`
}

export function getNowParts() {
  return getPartsFromDate(new Date())
}

export function isLateOpening(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m > 10 * 60 + 30
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function randomGapMs() {
  const min = 60 * 1000
  const max = 3 * 60 * 1000
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function normalizeHourLabel(raw, fallbackTime) {
  const value = String(raw || '').trim()
  if (!value) return hourBlockFromHour(Number(fallbackTime.split(':')[0]))
  if (/\d+\s*-\s*\d+\s*(AM|PM)/i.test(value)) {
    return value.replace(/\s+/g, ' ').trim()
  }

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
