import fs from 'fs/promises'
import path from 'path'
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys'
import { query } from '../config/db.js'

const fixKey = file => file.replace(/\//g, '__').replace(/:/g, '-')

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS wa_auth (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
}

async function writeData(key, value) {
  const json = JSON.stringify(value, BufferJSON.replacer)
  await query(
    `INSERT INTO wa_auth (key, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [key, json]
  )
}

async function readData(key) {
  const res = await query('SELECT data FROM wa_auth WHERE key = $1', [key])
  if (!res.rows.length) return null
  try {
    return JSON.parse(res.rows[0].data, BufferJSON.reviver)
  } catch {
    return null
  }
}

async function removeData(key) {
  await query('DELETE FROM wa_auth WHERE key = $1', [key])
}

async function seedFromFolderIfEmpty(folder, log) {
  const existing = await query('SELECT 1 FROM wa_auth LIMIT 1')
  if (existing.rows.length) return

  let entries
  try {
    entries = await fs.readdir(folder)
  } catch {
    return
  }

  let seeded = 0
  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(folder, file), 'utf8')
      await query(
        `INSERT INTO wa_auth (key, data) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [file, raw]
      )
      seeded += 1
    } catch (err) {
      log?.warn({ file, err: err?.message }, 'wa_auth seed file skipped')
    }
  }

  if (seeded) log?.info({ seeded, folder }, 'wa_auth seeded from existing folder')
}

export async function useDatabaseAuthState({ seedFromFolder = null, log = null } = {}) {
  await ensureTable()
  if (seedFromFolder) await seedFromFolderIfEmpty(seedFromFolder, log)

  const creds = (await readData('creds.json')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          await Promise.all(
            ids.map(async id => {
              let value = await readData(fixKey(`${type}-${id}.json`))
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              data[id] = value
            })
          )
          return data
        },
        set: async data => {
          const tasks = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const key = fixKey(`${category}-${id}.json`)
              tasks.push(value ? writeData(key, value) : removeData(key))
            }
          }
          await Promise.all(tasks)
        }
      }
    },
    saveCreds: async () => writeData('creds.json', creds)
  }
}
