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
  // Common shorthand from stores: "1.10" means 1.10 lakh (110000)
  if (cleaned.includes('.') && n > 0 && n <= 20) return Math.round(n * 100000)

  return Math.round(n)
}

export function parseHourlyReport(text) {
  const store = text.match(/STORE\s*[:\-]\s*(.+)/i)
  const target = text.match(/(?:TODAY'?S\s*)?TARGET\s*[:\-]\s*([^\n\r]+)/i)
  const achieved = text.match(/(?:ACHIEVED(?:\s*TILL\s*NOW)?)\s*[:\-]\s*([^\n\r]+)/i)
  const walkIns = text.match(/WALK[\s\u2010-\u2015-]*INS\s*[:\-]?\s*(\d+)/i)
  const hour = text.match(/(?:HOUR|TIME)\s*[:\-]\s*([^\n\r]+)/i)

  if (!store || !target || !achieved || !walkIns) {
    return { error: 'Invalid hourly report format' }
  }

  const targetVal = parseAmount(target[1])
  const achievedVal = parseAmount(achieved[1])
  if (Number.isNaN(targetVal) || Number.isNaN(achievedVal)) {
    return { error: 'Invalid target/achieved value' }
  }

  return {
    store: store[1].trim(),
    target: targetVal,
    achieved: achievedVal,
    walkIns: Number(walkIns[1]),
    hour: hour ? hour[1].trim() : null
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
