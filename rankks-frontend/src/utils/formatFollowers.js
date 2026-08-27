// 900 -> "900", 14000 -> "14K", 1500 -> "1.5K", 1100000 -> "1.1M"
// One decimal place, dropped when it's a whole number (14.0K -> 14K).
export function formatFollowers(count) {
  const n = Number(count) || 0
  if (n < 1000) return String(n)
  const format = (value, suffix) => {
    const rounded = Math.round(value * 10) / 10
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}${suffix}`
  }
  if (n < 1_000_000) return format(n / 1000, 'K')
  return format(n / 1_000_000, 'M')
}
