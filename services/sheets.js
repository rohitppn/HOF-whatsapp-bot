import fs from 'fs'
import { google } from 'googleapis'
import P from 'pino'

const log = P({ level: process.env.LOG_LEVEL || 'info' })

let sheetsPromise

function getConfig() {
  return {
    serviceAccount: process.env.GS_SERVICE_ACCOUNT_JSON || '',
    spreadsheetId: process.env.GS_SPREADSHEET_ID || '',
    hourlySheet: process.env.HOURLY_SHEET_NAME || 'Sheet1',
    openingSheet: process.env.OPENING_SHEET_NAME || 'Sheet2',
    bigBillSheet: process.env.BIG_BILL_SHEET_NAME || 'Sheet3',
    memorySheet: process.env.MEMORY_SHEET_NAME || 'Sheet4'
  }
}

async function loadServiceAccount(rawValue) {
  const raw = String(rawValue || '').trim()
  if (!raw) return null

  const candidates = [raw]
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    candidates.push(raw.slice(1, -1))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && parsed.client_email && parsed.private_key) {
        return parsed
      }
    } catch {
      // fall through to the next candidate or file-path handling
    }
  }

  const fileContents = await fs.promises.readFile(raw, 'utf8')
  return JSON.parse(fileContents)
}

async function getClient() {
  if (sheetsPromise) return sheetsPromise
  const cfg = getConfig()
  if (!cfg.serviceAccount || !cfg.spreadsheetId) return null
  sheetsPromise = (async () => {
    const creds = await loadServiceAccount(cfg.serviceAccount)
    const auth = new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    )
    await auth.authorize()
    log.info(
      {
        sheet: cfg.spreadsheetId,
        hourlySheet: cfg.hourlySheet,
        openingSheet: cfg.openingSheet,
        bigBillSheet: cfg.bigBillSheet,
        memorySheet: cfg.memorySheet,
        serviceAccountSource: cfg.serviceAccount.includes('client_email') ? 'env_json' : 'file_path'
      },
      'sheets auth ok'
    )
    return google.sheets({ version: 'v4', auth })
  })()
  return sheetsPromise
}

async function appendRow(sheetName, values) {
  const cfg = getConfig()
  const sheets = await getClient()
  if (!sheets) return
  const range = `${sheetName}!A:Z`
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  })
  log.info({ updatedRange: res.data.updates?.updatedRange, sheet: sheetName }, 'sheet append ok')
}

export async function appendSheetRow(sheetName, row) {
  await appendRow(sheetName, row)
}

export async function sheetHourly(row) {
  const cfg = getConfig()
  await appendRow(cfg.hourlySheet, row)
}

export async function sheetOpening(row) {
  const cfg = getConfig()
  await appendRow(cfg.openingSheet, row)
}

export async function sheetBigBill(row) {
  const cfg = getConfig()
  await appendRow(cfg.bigBillSheet, row)
}

export async function sheetMemory(row) {
  const cfg = getConfig()
  await appendRow(cfg.memorySheet, row)
}

export async function getSheetRows(sheetName) {
  const cfg = getConfig()
  const sheets = await getClient()
  if (!sheets) return []
  const range = `${sheetName}!A:Z`
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range
  })
  return res.data.values || []
}

function getColumnValue(row, index) {
  return (row?.[index] || '').toString().trim()
}

export async function getMemoryContext() {
  const cfg = getConfig()
  const rows = await getSheetRows(cfg.memorySheet)
  if (!rows.length) {
    return {
      aboutHof: [],
      totalStores: [],
      memory: [],
      promptTasks: [],
      memoryWriter: []
    }
  }

  const dataRows = rows.slice(1)
  return {
    aboutHof: dataRows.map(row => getColumnValue(row, 0)).filter(Boolean),
    totalStores: dataRows.map(row => getColumnValue(row, 1)).filter(Boolean),
    memory: dataRows.map(row => getColumnValue(row, 2)).filter(Boolean),
    promptTasks: dataRows.map(row => getColumnValue(row, 3)).filter(Boolean),
    memoryWriter: dataRows.map(row => getColumnValue(row, 4)).filter(Boolean)
  }
}

export async function appendMemoryEntry(note, source = 'bot') {
  if (!String(note || '').trim()) return false
  await sheetMemory(['', '', String(note).trim(), '', source])
  return true
}

export async function updateStaffDress(sheetName, date, store, value) {
  const cfg = getConfig()
  const sheets = await getClient()
  if (!sheets) return false
  const rows = await getSheetRows(sheetName)
  if (rows.length === 0) return false

  // Find first row with matching date + store (columns A and C)
  let targetRow = -1
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]
    const rowDate = (row[0] || '').toString().trim()
    const rowStore = (row[2] || '').toString().trim().toLowerCase()
    if (rowDate === date && rowStore === store.toLowerCase()) {
      targetRow = i + 1 // 1-based row index in sheet
      break
    }
  }
  if (targetRow === -1) return false

  // Staff Dress column is H
  const range = `${sheetName}!H${targetRow}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] }
  })
  return true
}

export async function updateSheetRange(sheetName, rangeA1, values) {
  const cfg = getConfig()
  const sheets = await getClient()
  if (!sheets) return false
  const range = `${sheetName}!${rangeA1}`
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  })
  return true
}
