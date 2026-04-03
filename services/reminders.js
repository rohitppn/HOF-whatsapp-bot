import { query } from '../config/db.js'

export async function getStoresMissingHourly(date) {
  const res = await query(
    `SELECT s.name
     FROM stores s
     LEFT JOIN reporting_compliance r
       ON r.store_id = s.id AND r.date = $1
     WHERE r.hourly_submitted IS DISTINCT FROM TRUE`,
    [date]
  )
  return res.rows.map(r => r.name)
}

export async function getStoresMissingDsr(date) {
  const res = await query(
    `SELECT s.name
     FROM stores s
     LEFT JOIN reporting_compliance r
       ON r.store_id = s.id AND r.date = $1
     WHERE r.dsr_submitted IS DISTINCT FROM TRUE`,
    [date]
  )
  return res.rows.map(r => r.name)
}
