import { appendSheetRow, updateSheetRange } from '../services/sheets.js'
import { isOpenClawEnabled } from '../services/openclaw.js'
import { isAuthorizedCallback, log } from './runtime.js'
import {
  ALLOWED_GROUPS,
  MANAGERS_GROUP_ID,
  getStoresFromEnv,
  isAllowedGroup
} from './storeConfig.js'
import { sleep, randomGapMs } from './time.js'

export function registerOpenClawCallback(app, { sendAndRemember }) {
  async function executeOpenClawAction(action) {
    log.info({ action }, 'openclaw action received')
    if (!action || typeof action !== 'object') {
      return { ok: false, error: 'invalid action payload' }
    }

    const type = String(action.action || '').trim()
    const message =
      typeof action.message === 'string' ? action.message.trim() : ''
    const allowedSheets = new Set([
      process.env.HOURLY_SHEET_NAME || 'Sheet1',
      process.env.OPENING_SHEET_NAME || 'Sheet2'
    ])

    if (!type) return { ok: false, error: 'missing action' }
    if (
      !message &&
      ['send_group_message', 'ask_clarification', 'notify_manager'].includes(type)
    ) {
      return { ok: false, error: 'missing message' }
    }

    if (type === 'send_group_message') {
      const groups =
        Array.isArray(action.targetGroups) && action.targetGroups.length
          ? action.targetGroups
          : ALLOWED_GROUPS
      let sent = 0

      for (const group of groups) {
        if (!ALLOWED_GROUPS.includes(group)) continue
        await sendAndRemember(group, message)
        sent += 1
        await sleep(randomGapMs())
      }

      log.info({ action: type, sent, groups }, 'openclaw action executed')
      return { ok: true, action: type, sent }
    }

    if (type === 'ask_clarification') {
      const targetGroup =
        typeof action.groupJid === 'string' && isAllowedGroup(action.groupJid)
          ? action.groupJid
          : null
      if (!targetGroup) {
        return { ok: false, error: 'invalid clarification group' }
      }
      await sendAndRemember(targetGroup, message)
      log.info({ action: type, targetGroup }, 'openclaw action executed')
      return { ok: true, action: type, sent: 1 }
    }

    if (type === 'notify_manager') {
      if (!MANAGERS_GROUP_ID) {
        return { ok: false, error: 'manager group not configured' }
      }
      await sendAndRemember(MANAGERS_GROUP_ID, message)
      log.info(
        { action: type, managerGroup: MANAGERS_GROUP_ID },
        'openclaw action executed'
      )
      return { ok: true, action: type, sent: 1 }
    }

    if (type === 'update_sheet') {
      const sheetName =
        typeof action.sheetName === 'string' ? action.sheetName.trim() : ''
      const values = Array.isArray(action.values) ? action.values : []
      const appendRow = Boolean(action.appendRow)
      const range = typeof action.range === 'string' ? action.range.trim() : ''

      if (!sheetName) return { ok: false, error: 'missing sheetName' }
      if (!allowedSheets.has(sheetName)) {
        return { ok: false, error: `sheet not allowed: ${sheetName}` }
      }
      if (!values.length) return { ok: false, error: 'missing values' }

      if (appendRow) {
        for (const row of values) {
          if (!Array.isArray(row)) {
            return { ok: false, error: 'appendRow values must be 2D array' }
          }
          await appendSheetRow(sheetName, row)
        }
      } else {
        if (!range) return { ok: false, error: 'missing range' }
        await updateSheetRange(sheetName, range, values)
      }

      log.info(
        { action: type, sheetName, appendRow, range, rows: values.length },
        'openclaw action executed'
      )
      return { ok: true, action: type, sheetName, updated: values.length }
    }

    return { ok: false, error: `unsupported action: ${type}` }
  }

  app.post('/openclaw/callback', async (req, res) => {
    try {
      if (!isAuthorizedCallback(req)) {
        log.warn({ headers: req.headers }, 'openclaw callback unauthorized')
        return res.status(401).json({ ok: false, error: 'unauthorized' })
      }

      const actions = Array.isArray(req.body?.actions) ? req.body.actions : [req.body]
      log.info(
        { actionsCount: actions.length, body: req.body },
        'openclaw callback accepted'
      )

      const results = []
      for (const action of actions) {
        results.push(await executeOpenClawAction(action))
      }

      log.info({ results }, 'openclaw callback completed')
      return res.json({ ok: true, results, stores: getStoresFromEnv() })
    } catch (err) {
      log.error({ err }, 'openclaw callback failed')
      return res.status(500).json({
        ok: false,
        error: 'callback failed',
        detail: err?.message || 'unknown error'
      })
    }
  })
}

export { isOpenClawEnabled }
