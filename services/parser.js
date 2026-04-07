const numberClean = val =>
  val
    .replace(/[₹,\s]/g, '')
    .trim()

const parseAmount = raw => {
  const lower = String(raw || '').toLowerCase()
  const trimmed = lower.trim()
  if (['nil', 'nill', 'na', 'n/a', 'none', '-', '--'].includes(trimmed)) return 0
  const cleaned = numberClean(lower)
  if (!cleaned) return NaN

  const n = Number(cleaned)
  if (Number.isNaN(n)) return NaN

  if (lower.includes('lakh') || lower.includes('lac')) return Math.round(n * 100000)
  if (/\bk\b/.test(lower) || /[0-9]k\b/.test(lower)) return Math.round(n * 1000)
  // Common shorthand from stores: "1.10" means 1.10 lakh (110000)
  if (cleaned.includes('.') && n > 0 && n <= 20) return Math.round(n * 100000)

  return Math.round(n)
}

const extractLineValue = (text, patterns) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    for (const pattern of patterns) {
      const m = line.match(pattern)
      if (m?.[1]) return m[1].trim()
    }
  }

  return null
}

export function parseHourlyReport(text) {
  const store = extractLineValue(text, [
    /^store\s*[:.\-]\s*(.+)$/i,
    /^store\s+(.+)$/i
  ])
  const target = extractLineValue(text, [
    /^(?:today'?s?\s*)?target\s*[:.\-]\s*([^\n\r]+)$/i,
    /^today\s+target\s*[:.\-]?\s*([^\n\r]+)$/i
  ])
  const achieved = extractLineValue(text, [
    /^ach(?:ieved)?(?:\s+till\s+now)?\s*[:.\-]\s*([^\n\r]+)$/i,
    /^achieved(?:\s+till\s+now)?\s*[:.\-]\s*([^\n\r]+)$/i,
    /^ach\s*[:.\-]\s*([^\n\r]+)$/i
  ])
  const walkIns = extractLineValue(text, [
    /^walk(?:[\s\u2010-\u2015-]*ins?|in)\s*[:.\-]?\s*(\d+)$/i,
    /^waking\s*[:.\-]?\s*(\d+)$/i,
    /^walkin'?s?\s*[:.\-]?\s*(\d+)$/i
  ])
  const hour = extractLineValue(text, [
    /^(?:hour|time)\s*[:.\-]\s*([^\n\r]+)$/i
  ])

  if (!store || !target || !achieved) {
    return { error: 'Invalid hourly report format' }
  }

  const targetVal = parseAmount(target)
  const achievedVal = parseAmount(achieved)
  if (Number.isNaN(targetVal) || Number.isNaN(achievedVal)) {
    return { error: 'Invalid target/achieved value' }
  }

  return {
    store,
    target: targetVal,
    achieved: achievedVal,
    walkIns: walkIns != null ? Number(walkIns) : 0,
    hour: hour || null
  }
}

export function parseBigBill(text) {
  const store = text.match(/STORE:\s*(.+)/i)
  const fcName = text.match(/FC:\s*(.+)/i)
  const billValue = text.match(/BILL:\s*([₹\d,\.]+)/i)
  const billType = text.match(/TYPE:\s*(.+)/i)
  const date = text.match(/DATE:\s*(.+)/i)

  if (!store || !fcName || !billValue || !billType || !date) {
    return { error: 'Invalid big bill format' }
  }

  return {
    store: store[1].trim(),
    fcName: fcName[1].trim(),
    billValue: Number(numberClean(billValue[1])),
    billType: billType[1].trim(),
    date: date[1].trim()
  }
}

export function parseGrooming(text) {
  const store = text.match(/STORE:\s*(.+)/i)
  const status = text.match(/GROOMING STATUS:\s*(.+)/i)
  const date = text.match(/DATE:\s*(.+)/i)

  if (!store || !status || !date) {
    return { error: 'Invalid grooming format' }
  }

  return {
    store: store[1].trim(),
    status: status[1].trim(),
    date: date[1].trim()
  }
}

export function parseDSR(text) {
  const store = text.match(/STORE:\s*(.+)/i)
  const date = text.match(/DATE:\s*(.+)/i)
  const totalSales = text.match(/TOTAL SALES:\s*([₹\d,\.]+)/i)
  const totalBills = text.match(/TOTAL BILLS:\s*(\d+)/i)
  const totalWalkins = text.match(/TOTAL WALK-INS:\s*(\d+)/i)

  if (!store || !date || !totalSales || !totalBills || !totalWalkins) {
    return { error: 'Invalid DSR format' }
  }

  return {
    store: store[1].trim(),
    date: date[1].trim(),
    totalSales: Number(numberClean(totalSales[1])),
    totalBills: Number(totalBills[1]),
    totalWalkins: Number(totalWalkins[1])
  }
}
