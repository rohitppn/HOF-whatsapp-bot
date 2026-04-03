import pkg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
})

export const query = (text, params) => pool.query(text, params)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SCHEMA_PATH = path.join(__dirname, '..', 'models', 'schema.sql')

let initPromise

export async function initDb() {
  if (initPromise) return initPromise
  initPromise = (async () => {
    const schema = await fs.promises.readFile(SCHEMA_PATH, 'utf8')
    await pool.query(schema)
  })()
  return initPromise
}

export async function getStoreId(name) {
  const trimmed = name.trim()
  const existing = await query('SELECT id FROM stores WHERE name = $1', [trimmed])
  if (existing.rows.length) return existing.rows[0].id
  const inserted = await query('INSERT INTO stores (name) VALUES ($1) RETURNING id', [trimmed])
  return inserted.rows[0].id
}
