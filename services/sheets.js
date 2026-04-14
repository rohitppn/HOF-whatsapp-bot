import fs from 'fs'
import { google } from 'googleapis'
import P from 'pino'

const log = P({ level: process.env.LOG_LEVEL || 'info' })

let sheetsPromise
let sheetsDisabledReasonLogged = false

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

function looksLikePlaceholder(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return true
  return (
    normalized.includes('/absolute/path/to/') ||
    normalized.includes('your_google_sheet_id') ||
    normalized.includes('your_openai_api_key') ||
    normalized === 'changeme'
  )
}

function logSheetsDisabled(reason, extra = {}) {
  if (sheetsDisabledReasonLogged) return
  sheetsDisabledReasonLogged = true
  log.warn({ reason, ...extra }, 'google sheets disabled; bot will continue without sheet writes')
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
  if (!cfg.serviceAccount || !cfg.spreadsheetId) {
    logSheetsDisabled('missing GS_SERVICE_ACCOUNT_JSON or GS_SPREADSHEET_ID')
    return null
  }
  if (looksLikePlaceholder(cfg.serviceAccount) || looksLikePlaceholder(cfg.spreadsheetId)) {
    logSheetsDisabled('placeholder Google Sheets config detected')
    return null
  }
  sheetsPromise = (async () => {
    try {
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
    } catch (err) {
      sheetsPromise = null
      logSheetsDisabled(err?.code === 'ENOENT' ? 'service account file not found' : 'sheets auth failed', {
        error: err?.message || 'unknown error'
      })
      return null
    }
  })()
  return sheetsPromise
}

async function appendRow(sheetName, values) {
  const cfg = getConfig()
  const sheets = await getClient()
  if (!sheets) return false
  const range = `${sheetName}!A:Z`
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  })
  log.info({ updatedRange: res.data.updates?.updatedRange, sheet: sheetName }, 'sheet append ok')
  return true
}

export async function appendSheetRow(sheetName, row) {
  return appendRow(sheetName, row)
}

export async function sheetHourly(row) {
  const cfg = getConfig()
  return appendRow(cfg.hourlySheet, row)
}

export async function sheetOpening(row) {
  const cfg = getConfig()
  return appendRow(cfg.openingSheet, row)
}

export async function sheetBigBill(row) {
  const cfg = getConfig()
  return appendRow(cfg.bigBillSheet, row)
}

export async function sheetMemory(row) {
  const cfg = getConfig()
  return appendRow(cfg.memorySheet, row)
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
  return sheetMemory(['', '', String(note).trim(), '', source])
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
