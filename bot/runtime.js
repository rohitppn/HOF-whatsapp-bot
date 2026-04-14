import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import express from 'express'
import P from 'pino'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const DOTENV_PATH =
  process.env.DOTENV_PATH || path.join(__dirname, '..', '.env')

if (fs.existsSync(DOTENV_PATH)) {
  const dotenvResult = dotenv.config({ path: DOTENV_PATH, override: true })
  if (dotenvResult.error) {
    console.error('dotenv load error', dotenvResult.error)
  } else {
    console.log('dotenv loaded from', DOTENV_PATH)
  }
} else {
  console.log('dotenv file not found, using process environment only')
}

export const log = P({ level: process.env.LOG_LEVEL || 'info' })
export const HANDLER_VERSION = 'v5-openai-smart-ops'
export const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata'
export const OPENCLAW_CALLBACK_TOKEN =
  (process.env.OPENCLAW_CALLBACK_TOKEN || '').trim()
export const OPENCLAW_MANAGER_ONLY =
  process.env.OPENCLAW_MANAGER_ONLY !== '0'
export const port = process.env.PORT || 3000

export const app = express()
app.use(express.json({ limit: '2mb' }))

export function getAppBaseUrl() {
  const explicit = (process.env.APP_BASE_URL || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim()
  if (railwayDomain) return `https://${railwayDomain}`

  return `http://127.0.0.1:${port}`
}

export function isAuthorizedCallback(req) {
  if (!OPENCLAW_CALLBACK_TOKEN) return false
  const auth = req.headers.authorization || ''
  return auth === `Bearer ${OPENCLAW_CALLBACK_TOKEN}`
}
