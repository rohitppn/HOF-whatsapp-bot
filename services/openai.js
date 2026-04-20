import { answerManagerAssistantLocal } from '../bot/logic/managerAssistant.js'
import { parseManagerCommandLocal } from '../bot/logic/managerCommands.js'
import { extractOperationalIntentLocal } from '../bot/logic/operationalIntent.js'
import { decideSmartReplyLocal } from '../bot/logic/smartReply.js'

export async function decideSmartReply({
  latestText,
  senderName,
  stores,
  recentMessages,
  recentKnowledge,
  now
}) {
  return decideSmartReplyLocal({
    latestText,
    senderName,
    stores,
    recentMessages,
    recentKnowledge,
    now
  })
}

export async function extractOperationalIntent({ text, stores, now, senderJid = null }) {
  return extractOperationalIntentLocal({ text, stores, now, senderJid })
}

export async function parseManagerCommand({ text, stores, allowedSheets, storeGroups }) {
  return parseManagerCommandLocal({ text, stores, allowedSheets, storeGroups })
}

export async function answerManagerAssistant({
  text,
  stores,
  recentMessages,
  recentKnowledge,
  now
}) {
  return answerManagerAssistantLocal({
    text,
    stores,
    recentMessages,
    recentKnowledge,
    now
  })
}
