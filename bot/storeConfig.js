import fs from 'fs'
import { isJidGroup } from '@whiskeysockets/baileys'
import { DOTENV_PATH } from './runtime.js'

export const ALLOWED_GROUPS = (process.env.ALLOWED_GROUPS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

export const MANAGERS_GROUP_ID = (process.env.MANAGERS_GROUP_ID || '').trim()

export function getStoresFromEnv() {
  const list = (process.env.STORES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (list.length) return list

  const stores = Object.keys(process.env)
    .filter(k => /^store_\d+$/i.test(k))
    .map(k => (process.env[k] || '').trim())
    .filter(Boolean)
  if (stores.length) return stores

  try {
    const raw = fs.readFileSync(DOTENV_PATH, 'utf8')
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /^store_\d+=/i.test(line))
      .map(line => line.split('=').slice(1).join('=').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function normalizeStoreName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function canonicalStoreName(input, stores = getStoresFromEnv()) {
  const wanted = normalizeStoreName(input)
  if (!wanted) return null

  const exact = stores.find(store => normalizeStoreName(store) === wanted)
  if (exact) return exact

  return (
    stores.find(
      store =>
        normalizeStoreName(store).includes(wanted) ||
        wanted.includes(normalizeStoreName(store))
    ) || null
  )
}

export function getActiveStores(state) {
  const now = Date.now()
  return getStoresFromEnv().filter(store => {
    const until = state.temporaryStoreClosures.get(normalizeStoreName(store)) || 0
    return until <= now
  })
}

export function getClosedStoresToday(state) {
  const now = Date.now()
  return getStoresFromEnv().filter(store => {
    const until = state.temporaryStoreClosures.get(normalizeStoreName(store)) || 0
    return until > now
  })
}

export function markStoreClosed(state, storeName, hours = 24) {
  const canonical = canonicalStoreName(storeName)
  if (!canonical) return null

  state.temporaryStoreClosures.set(
    normalizeStoreName(canonical),
    Date.now() + hours * 60 * 60 * 1000
  )
  return canonical
}

export function reopenStore(state, storeName) {
  const canonical = canonicalStoreName(storeName)
  if (!canonical) return null

  state.temporaryStoreClosures.delete(normalizeStoreName(canonical))
  return canonical
}

export function closeAllStores(state, hours = 24) {
  const stores = getStoresFromEnv()
  for (const store of stores) {
    state.temporaryStoreClosures.set(
      normalizeStoreName(store),
      Date.now() + hours * 60 * 60 * 1000
    )
  }
  return stores
}

export function reopenAllStores(state) {
  state.temporaryStoreClosures.clear()
}

export function isAllowedGroup(jid) {
  if (!isJidGroup(jid)) return false

  const allowed = new Set(ALLOWED_GROUPS)
  if (MANAGERS_GROUP_ID) allowed.add(MANAGERS_GROUP_ID)
  if (allowed.size === 0) return true

  return allowed.has(jid)
}

export function isAllowedSender(jid) {
  if (ALLOWED_SENDERS.length === 0) return true
  return ALLOWED_SENDERS.includes(jid)
}
