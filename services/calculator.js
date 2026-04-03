export function calculateProgress(achieved, target) {
  if (!target || target === 0) return 0
  return (achieved / target) * 100
}

export function calculateConversion(bills, walkins) {
  if (!walkins || walkins === 0) return 0
  return (bills / walkins) * 100
}
