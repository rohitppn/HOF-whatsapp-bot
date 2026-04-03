import { query } from '../config/db.js'
import { calculateConversion } from './calculator.js'

export async function getDailyRanking(date) {
  const res = await query(
    `SELECT s.name, d.total_sales, d.total_bills, d.total_walkins
     FROM dsr_reports d
     JOIN stores s ON s.id = d.store_id
     WHERE d.date = $1
     ORDER BY d.total_sales DESC`,
    [date]
  )

  const ranked = res.rows.map(row => {
    const conversion = calculateConversion(row.total_bills, row.total_walkins)
    return {
      store: row.name,
      totalSales: Number(row.total_sales),
      conversion
    }
  })

  ranked.sort((a, b) => {
    if (b.totalSales !== a.totalSales) return b.totalSales - a.totalSales
    return b.conversion - a.conversion
  })

  return ranked
}

export async function getMonthlyRanking(month) {
  const res = await query(
    `SELECT s.name, SUM(d.total_sales) AS total_sales, SUM(d.total_bills) AS total_bills, SUM(d.total_walkins) AS total_walkins
     FROM dsr_reports d
     JOIN stores s ON s.id = d.store_id
     WHERE to_char(d.date, 'YYYY-MM') = $1
     GROUP BY s.name`,
    [month]
  )

  const ranked = res.rows.map(row => {
    const conversion = calculateConversion(Number(row.total_bills), Number(row.total_walkins))
    return {
      store: row.name,
      totalSales: Number(row.total_sales),
      conversion
    }
  })

  ranked.sort((a, b) => {
    if (b.totalSales !== a.totalSales) return b.totalSales - a.totalSales
    return b.conversion - a.conversion
  })

  return ranked
}

export async function getTop10Bills(month) {
  const res = await query(
    `SELECT s.name, f.fc_name, f.bill_value, f.bill_type, f.date
     FROM fc_bills f
     JOIN stores s ON s.id = f.store_id
     WHERE to_char(f.date, 'YYYY-MM') = $1
     ORDER BY f.bill_value DESC
     LIMIT 10`,
    [month]
  )

  return res.rows.map(row => ({
    store: row.name,
    fcName: row.fc_name,
    billValue: Number(row.bill_value),
    billType: row.bill_type,
    date: row.date
  }))
}
