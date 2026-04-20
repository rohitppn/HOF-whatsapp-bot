import { isOpenClawEnabled } from '../services/openclaw.js'
import { ALLOWED_GROUPS, MANAGERS_GROUP_ID, getStoresFromEnv, isAllowedGroup, isAllowedSender } from './storeConfig.js'
import { getPauseRemainingHours, isBotPaused } from './state.js'
import {
  buildHelpMessage,
  isBotMentioned,
  looksLikeManagerAssistantChat,
  looksLikeManagerCommand
} from './messageUtils.js'
import {
  answerManagerAssistant,
  decideSmartReply,
  extractOperationalIntent,
  getNowParts,
  getPartsFromTimestamp,
  handleBigBill,
  handleHourly,
  handleOpening,
  parseManagerCommand
} from './handlers/operations.js'
import { normalizeHourLabel, randomGapMs, sleep } from './time.js'
import { appendSheetRow, sheetHourly, sheetOpening, updateSheetRange } from '../services/sheets.js'

export function registerMessageHandler({
  sock,
  state,
  sendAndRemember,
  rememberMessage,
  rememberKnowledge,
  loadRecentMessages,
  loadRecentKnowledge,
  pushOpsEvent,
  pushManagerEvent
}) {
  const botUserJid = () => sock.user?.id || ''

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return

    for (const msg of messages) {
      try {
        const jid = msg.key.remoteJid
        let content = msg.message
        if (content?.ephemeralMessage?.message) {
          content = content.ephemeralMessage.message
        }
        if (content?.viewOnceMessage?.message) {
          content = content.viewOnceMessage.message
        }
        if (content?.viewOnceMessageV2?.message) {
          content = content.viewOnceMessageV2.message
        }

        const text =
          content?.conversation ||
          content?.extendedTextMessage?.text ||
          content?.imageMessage?.caption ||
          content?.documentMessage?.caption ||
          ''

        const botMentioned = isBotMentioned({ sock, content })
        const isDirectSelfChat =
          Boolean(jid) &&
          !jid.endsWith('@g.us') &&
          Boolean(botUserJid()) &&
          jid.split(':')[0] === botUserJid().split(':')[0]

        if (isDirectSelfChat && msg.key.fromMe && /^\s*STOP\s*$/i.test(text || '')) {
          state.botPausedUntilMs = Date.now() + 12 * 60 * 60 * 1000
          continue
        }

        if (!jid || !isAllowedGroup(jid)) continue
        if (msg.key.fromMe) continue

        const sender = msg.key.participant || msg.key.remoteJid
        if (!isAllowedSender(sender)) continue

        const upper = text.toUpperCase()
        const msgTs = Number(msg.messageTimestamp)
        const parts = getPartsFromTimestamp(msgTs)
        const senderName = msg.pushName || null
        const isManagerGroup = Boolean(MANAGERS_GROUP_ID && jid === MANAGERS_GROUP_ID)
        const sessionKey = `${jid}:${parts.date}`

        await rememberMessage({
          groupJid: jid,
          senderJid: sender,
          senderName,
          direction: 'inbound',
          messageType: content?.imageMessage ? 'image' : 'text',
          textContent: text || '[media]'
        })

        if (!text) continue

        if (isBotPaused(state) && !isManagerGroup) continue

        if (
          !isManagerGroup &&
          (botMentioned || looksLikeManagerAssistantChat(text) || looksLikeManagerCommand(text))
        ) {
          continue
        }

        if (isManagerGroup && (botMentioned || looksLikeManagerCommand(text))) {
          if (/@bot\s+on\?/i.test(text) || /\bon\?\b/i.test(text)) {
            await sendAndRemember(
              jid,
              isBotPaused(state)
                ? `Yes, I'm activated, but paused for the next ${getPauseRemainingHours(state)} hour(s).`
                : `Yes, I'm activated.`
            )
            continue
          }

          if (
            /@bot\s*\/help/i.test(text) ||
            /@assistant\s*\/help/i.test(text) ||
            /\b\/help\b/i.test(text)
          ) {
            await sendAndRemember(jid, buildHelpMessage())
            continue
          }

          const managerAssistantChat =
            botMentioned || looksLikeManagerAssistantChat(text)
          const allowedSheets = [
            process.env.HOURLY_SHEET_NAME || 'Sheet1',
            process.env.OPENING_SHEET_NAME || 'Sheet2',
            process.env.BIG_BILL_SHEET_NAME || 'Sheet3'
          ]

          if (isOpenClawEnabled()) {
            await pushManagerEvent({
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              eventType: managerAssistantChat
                ? 'manager_assistant_chat'
                : 'manager_command',
              allowedSheets,
              storeGroups: ALLOWED_GROUPS,
              stores: getStoresFromEnv(),
              sessionKey
            })
          }

          const explicitManagerCommand = looksLikeManagerCommand(text)
          const cmd = explicitManagerCommand
            ? await parseManagerCommand({
                text,
                stores: getStoresFromEnv(),
                allowedSheets,
                storeGroups: ALLOWED_GROUPS
              })
            : null

          if (cmd?.action === 'send_group_message' && cmd.message) {
            const groups =
              Array.isArray(cmd.targetGroups) && cmd.targetGroups.length
                ? cmd.targetGroups
                : ALLOWED_GROUPS

            for (const group of groups) {
              if (!ALLOWED_GROUPS.includes(group)) continue
              await sendAndRemember(group, cmd.message)
              await sleep(randomGapMs())
            }

            await sendAndRemember(
              jid,
              'Message sent to the store group successfully.'
            )
            continue
          }

          if (
            cmd?.action === 'update_sheet' &&
            cmd.sheetName &&
            Array.isArray(cmd.values) &&
            cmd.values.length
          ) {
            const allowedSheetSet = new Set(allowedSheets)
            if (allowedSheetSet.has(cmd.sheetName)) {
              if (cmd.appendRow) {
                for (const row of cmd.values) {
                  await appendSheetRow(cmd.sheetName, row)
                }
              } else if (cmd.range) {
                await updateSheetRange(cmd.sheetName, cmd.range, cmd.values)
              }
              await sendAndRemember(
                jid,
                `Sheet update completed for ${cmd.sheetName}.`
              )
              continue
            }
          }

          if (managerAssistantChat) {
            const reply = await answerManagerAssistant({
              text,
              stores: getStoresFromEnv(),
              recentMessages: await loadRecentMessages(jid, 25),
              recentKnowledge: await loadRecentKnowledge(jid, 15),
              now: getNowParts()
            })

            await sendAndRemember(
              jid,
              reply ||
                'I saw your message, but I could not generate a reply right now. Please check the Claude settings and try again.'
            )
            continue
          }
        }

        if (isBotPaused(state)) continue

        let handled = false

        if (/big\s*bill/i.test(text) || /assisted by/i.test(text) || /with the help of/i.test(text) || /done by/i.test(text) || /wow bill/i.test(text)) {
          const result = await handleBigBill(text, msgTs, sender)
          if (!result.error) {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'performance',
              factText: `Big bill recorded for ${result.store}: ${result.billValue}.`,
              sourceMessageId: msg.key.id || null
            })
            await pushOpsEvent({
              eventType: 'big_bill',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `big_bill:${result.store}:${result.billValue}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
            continue
          }
        }

        if (
          /STORE\s*[:\-]/i.test(text) &&
          /(TARGET|TODAY'?S\s*TARGET)\s*[:\-]/i.test(text) &&
          /ACHIEVED(\s*TILL\s*NOW)?\s*[:\-]/i.test(text)
        ) {
          const result = await handleHourly(text, msgTs)
          if (result.error) {
            await sendAndRemember(
              jid,
              'Could not process this update. Please resend in the required format.'
            )
          } else {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'performance',
              factText: `Hourly report recorded for ${result.store} for ${result.hourBlock}.`,
              sourceMessageId: msg.key.id || null
            })
            await pushOpsEvent({
              eventType: 'hourly_report',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `hourly:${result.store}:${result.hourBlock}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
          }
          handled = true
          continue
        }

        if (upper.includes('OPENING')) {
          const result = await handleOpening(text, msgTs)
          if (result.error) {
            await sendAndRemember(
              jid,
              'Could not process this update. Please resend in the required format.'
            )
          } else {
            await rememberKnowledge({
              groupJid: jid,
              storeName: result.store,
              kind: 'status',
              factText: `${result.store} opening was recorded ${result.late ? 'late' : 'on time'}.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              result.savedToSheets
                ? result.late
                  ? `${result.store}, opening was saved after 10:30 AM. Please ensure timely opening from tomorrow.`
                  : `Good morning, ${result.store}. Opening is saved on time. Wishing you a productive day ahead.`
                : `${result.store}, opening update was received, but Google Sheets is not configured yet.`
            )
          }
          await pushOpsEvent({
            eventType: 'opening_report',
            groupJid: jid,
            senderJid: sender,
            senderName,
            timestamp: parts.recordedAt,
            text,
            structuredResult: `opening:${result.store}:${result.late ? 'late' : 'on_time'}`,
            stores: getStoresFromEnv(),
            recentKnowledge: await loadRecentKnowledge(jid, 8),
            sessionKey
          })
          handled = true
          continue
        }

        if (!handled && text.trim()) {
          const extracted = await extractOperationalIntent({
            text,
            stores: getStoresFromEnv(),
            now: getPartsFromTimestamp(msgTs)
          })

          if (
            extracted?.kind === 'hourly' &&
            extracted.data?.store &&
            extracted.data?.target != null &&
            extracted.data?.achieved != null &&
            extracted.data?.walkIns != null
          ) {
            const store = String(extracted.data.store).trim()
            const hourBlock = normalizeHourLabel(extracted.data.hour, parts.time)
            const extractedSaveOk = await sheetHourly([
              parts.date,
              parts.time,
              store,
              hourBlock,
              Number(extracted.data.target),
              Number(extracted.data.achieved),
              Number(extracted.data.walkIns),
              text,
              parts.recordedAt
            ])
            await rememberKnowledge({
              groupJid: jid,
              storeName: store,
              kind: 'performance',
              factText: `Hourly report recorded for ${store} for ${hourBlock}.`,
              sourceMessageId: msg.key.id || null
            })
            await pushOpsEvent({
              eventType: 'hourly_report_ai_extracted',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `hourly:${store}:${hourBlock}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
          } else if (extracted?.kind === 'opening' && extracted.data?.store) {
            const store = String(extracted.data.store).trim()
            const openingTime = extracted.data.openingTime
              ? String(extracted.data.openingTime).trim()
              : parts.time
            const late = openingTime > '10:30'
            const extractedSaveOk = await sheetOpening([
              parts.date,
              parts.time,
              store,
              openingTime,
              late ? 'YES' : 'NO',
              text,
              parts.recordedAt,
              ''
            ])
            await rememberKnowledge({
              groupJid: jid,
              storeName: store,
              kind: 'status',
              factText: `${store} opening was recorded ${late ? 'late' : 'on time'}.`,
              sourceMessageId: msg.key.id || null
            })
            await sendAndRemember(
              jid,
              extractedSaveOk
                ? late
                  ? `${store}, opening was saved after 10:30 AM. Please ensure timely opening from tomorrow.`
                  : `Good morning, ${store}. Opening is saved on time. Wishing you a productive day ahead.`
                : `${store}, opening update was received, but Google Sheets is not configured yet.`
            )
            await pushOpsEvent({
              eventType: 'opening_report_ai_extracted',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: `opening:${store}:${late ? 'late' : 'on_time'}`,
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
          } else if (
            extracted?.kind === 'big_bill' &&
            extracted.data?.store &&
            extracted.data?.billValue != null
          ) {
            const result = await handleBigBill(text, msgTs, sender)
            if (!result.error) {
              await rememberKnowledge({
                groupJid: jid,
                storeName: result.store,
                kind: 'performance',
                factText: `Big bill recorded for ${result.store}: ${result.billValue}.`,
                sourceMessageId: msg.key.id || null
              })
              await pushOpsEvent({
                eventType: 'big_bill_ai_extracted',
                groupJid: jid,
                senderJid: sender,
                senderName,
                timestamp: parts.recordedAt,
                text,
                structuredResult: `big_bill:${result.store}:${result.billValue}`,
                stores: getStoresFromEnv(),
                recentKnowledge: await loadRecentKnowledge(jid, 8),
                sessionKey
              })
              handled = true
            }
          } else if (
            extracted?.shouldAskClarification &&
            extracted.clarification
          ) {
            await sendAndRemember(jid, extracted.clarification)
            await pushOpsEvent({
              eventType: 'clarification_requested',
              groupJid: jid,
              senderJid: sender,
              senderName,
              timestamp: parts.recordedAt,
              text,
              structuredResult: 'clarification',
              stores: getStoresFromEnv(),
              recentKnowledge: await loadRecentKnowledge(jid, 8),
              sessionKey
            })
            handled = true
          }
        }

        if (!handled && text.trim()) {
          const smart = await decideSmartReply({
            latestText: text,
            senderName,
            stores: getStoresFromEnv(),
            recentMessages: await loadRecentMessages(jid, 25),
            recentKnowledge: await loadRecentKnowledge(jid, 15),
            now: getNowParts()
          })

          if (smart?.facts?.length) {
            for (const fact of smart.facts) {
              if (!fact?.fact) continue
              await rememberKnowledge({
                groupJid: jid,
                storeName:
                  typeof fact.store === 'string' ? fact.store.trim() || null : null,
                kind: typeof fact.kind === 'string' ? fact.kind : 'note',
                factText: String(fact.fact).trim(),
                sourceMessageId: msg.key.id || null
              })
            }
          }

          if (smart?.shouldReply && smart.reply) {
            await sendAndRemember(jid, smart.reply)
          }

          await pushOpsEvent({
            eventType: 'unhandled_group_message',
            groupJid: jid,
            senderJid: sender,
            senderName,
            timestamp: parts.recordedAt,
            text,
            structuredResult: smart?.shouldReply ? 'smart_reply' : 'no_action',
            stores: getStoresFromEnv(),
            recentKnowledge: await loadRecentKnowledge(jid, 8),
            sessionKey
          })
        }
      } catch (err) {
        console.error(err)
      }
    }
  })
}
