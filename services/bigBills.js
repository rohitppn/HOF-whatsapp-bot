import { getStoreId, query } from '../config/db.js'

export async function saveBigBill({ store, billValue, quantity = null, assistedBy = null, helpedBy = null, date }) {
  const storeId = await getStoreId(store)
  await query(
    `INSERT INTO fc_bills (store_id, date, fc_name, bill_value, bill_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [storeId, date, assistedBy || '', billValue, helpedBy || 'big_bill']
  )
}

export async function getTopBigBillForDate(date) {
  const res = await query(
    `SELECT s.name, f.bill_value, f.fc_name, f.bill_type, f.date
     FROM fc_bills f
     JOIN stores s ON s.id = f.store_id
     WHERE f.date = $1
     ORDER BY f.bill_value DESC
     LIMIT 1`,
    [date]
  )
  if (!res.rows.length) return null
  const row = res.rows[0]
  return {
    store: row.name,
    billValue: Number(row.bill_value),
    assistedBy: row.fc_name || null,
    helpedBy: row.bill_type && row.bill_type !== 'big_bill' ? row.bill_type : null,
    date: row.date
  }
}
