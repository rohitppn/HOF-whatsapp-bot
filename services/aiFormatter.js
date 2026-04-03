export function formatDailyRanking(date, ranked) {
  const lines = ranked.map(r => {
    return `${r.store} – ₹${r.totalSales} – Conversion ${r.conversion}%`
  })
  return [`Daily Store Performance Summary – ${date}`, '', ...lines].join('\n')
}
