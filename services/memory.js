import { query } from '../config/db.js'

export async function saveGroupMessage({
  groupJid,
  senderJid = null,
  senderName = null,
  direction,
  messageType = 'text',
  textContent = ''
}) {
  await query(
    `INSERT INTO group_messages
      (group_jid, sender_jid, sender_name, direction, message_type, text_content)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [groupJid, senderJid, senderName, direction, messageType, textContent]
  )
}

export async function addKnowledge({
  groupJid,
  storeName = null,
  kind,
  factText,
  sourceMessageId = null
}) {
  await query(
    `INSERT INTO group_knowledge
      (group_jid, store_name, kind, fact_text, source_message_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [groupJid, storeName, kind, factText, sourceMessageId]
  )
}

export async function getRecentMessages(groupJid, limit = 30) {
  const res = await query(
    `SELECT direction, sender_name, message_type, text_content, created_at
     FROM group_messages
     WHERE group_jid = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [groupJid, limit]
  )
  return res.rows.reverse()
}

export async function getRecentKnowledge(groupJid, limit = 20) {
  const res = await query(
    `SELECT store_name, kind, fact_text, observed_at
     FROM group_knowledge
     WHERE group_jid = $1
     ORDER BY observed_at DESC
     LIMIT $2`,
    [groupJid, limit]
  )
  return res.rows.reverse()
}
