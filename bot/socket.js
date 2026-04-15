import QRCode from 'qrcode'
import qrcodeTerminal from 'qrcode-terminal'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import { initDb } from '../config/db.js'
import { addKnowledge, getRecentKnowledge, getRecentMessages, saveGroupMessage } from '../services/memory.js'
import { sendManagerEventToOpenClaw, sendOpsEventToOpenClaw } from '../services/openclaw.js'
import { getStoresFromEnv } from './storeConfig.js'
import { getAppBaseUrl, log, OPENCLAW_MANAGER_ONLY } from './runtime.js'
import { registerMessageHandler } from './messageHandler.js'
import { registerOpenClawCallback, isOpenClawEnabled } from './openclawCallback.js'
import { registerScheduledJobs } from './schedulers.js'

export async function startSock({ app, state }) {
  let memoryReady = false
  let waConnectionState = 'starting'

  try {
    await initDb()
    memoryReady = true
    log.info('smart memory db ready')
  } catch (err) {
    log.warn({ err }, 'smart memory db unavailable, continuing without db memory')
  }

  const { state: authState, saveCreds } = await useMultiFileAuthState('auth')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: log,
    browser: ['HOF Ops Bot', 'Chrome', '1.0.0']
  })

  sock.ev.on('creds.update', saveCreds)

  async function rememberMessage(payload) {
    if (!memoryReady) return
    try {
      await saveGroupMessage(payload)
    } catch (err) {
      log.warn({ err }, 'saveGroupMessage failed')
    }
  }

  async function rememberKnowledge(payload) {
    if (!memoryReady) return
    try {
      await addKnowledge(payload)
    } catch (err) {
      log.warn({ err }, 'addKnowledge failed')
    }
  }

  async function loadRecentMessages(groupJid, limit) {
    if (!memoryReady) return []
    try {
      return await getRecentMessages(groupJid, limit)
    } catch (err) {
      log.warn({ err }, 'getRecentMessages failed')
      return []
    }
  }

  async function loadRecentKnowledge(groupJid, limit) {
    if (!memoryReady) return []
    try {
      return await getRecentKnowledge(groupJid, limit)
    } catch (err) {
      log.warn({ err }, 'getRecentKnowledge failed')
      return []
    }
  }

  async function sendAndRemember(groupJid, text) {
    if (waConnectionState !== 'open') {
      const err = new Error(`whatsapp not connected (${waConnectionState})`)
      err.code = 'WA_NOT_CONNECTED'
      throw err
    }
    await sock.sendMessage(groupJid, { text })
    await rememberMessage({
      groupJid,
      direction: 'outbound',
      messageType: 'text',
      textContent: text
    })
  }

  async function logParticipatingGroups() {
    try {
      const chats = await sock.groupFetchAllParticipating()
      const entries = Object.entries(chats || {})
        .map(([id, chat]) => ({
          id,
          name: chat?.subject || 'Unknown Group'
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      log.info({ count: entries.length }, 'fetched participating groups')
      for (const entry of entries) {
        log.info(
          { groupName: entry.name, groupJid: entry.id },
          'group discovered'
        )
      }
    } catch (err) {
      log.warn({ err }, 'failed to fetch participating groups')
    }
  }

  async function pushOpsEvent(event) {
    if (OPENCLAW_MANAGER_ONLY || !isOpenClawEnabled()) return
    try {
      await sendOpsEventToOpenClaw(event)
    } catch (err) {
      log.warn({ err }, 'openclaw ops event failed')
    }
  }

  async function pushManagerEvent(event) {
    if (!isOpenClawEnabled()) return
    try {
      await sendManagerEventToOpenClaw(event)
    } catch (err) {
      log.warn({ err }, 'openclaw manager event failed')
    }
  }

  registerOpenClawCallback(app, { sendAndRemember })
  registerMessageHandler({
    sock,
    state,
    sendAndRemember,
    rememberMessage,
    rememberKnowledge,
    loadRecentMessages,
    loadRecentKnowledge,
    pushOpsEvent,
    pushManagerEvent
  })
  registerScheduledJobs({ state, sendAndRemember })

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (connection) {
      waConnectionState = connection
      state.latestWaStatus = connection
    }

    if (qr) {
      state.latestQrText = qr
      state.latestQrUpdatedAt = new Date().toISOString()
      state.latestQrExternalUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(qr)}`
      qrcodeTerminal.generate(qr, { small: true })
      QRCode.toDataURL(qr, { margin: 1, width: 320 })
        .then(url => {
          state.latestQrImageUrl = url
          log.info(
            {
              qrUrl: `${getAppBaseUrl()}/qr`,
              qrImageUrl: state.latestQrExternalUrl
            },
            'scan WhatsApp QR in browser'
          )
        })
        .catch(err => log.warn({ err }, 'qr image generation failed'))
    }

    if (connection === 'open') {
      state.latestQrText = null
      state.latestQrImageUrl = null
      state.latestQrExternalUrl = null
      log.info({ waConnectionState }, 'connected')
      logParticipatingGroups().catch(err =>
        log.warn({ err }, 'failed to log participating groups')
      )
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      log.warn({ code, waConnectionState }, 'connection closed')
      if (shouldReconnect) {
        startSock({ app, state }).catch(err =>
          log.error({ err }, 'reconnect failed')
        )
      }
    }
  })

  return { sock, getStoresFromEnv }
}
