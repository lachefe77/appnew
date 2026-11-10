export function americanToDecimal(price: number) {
  if (!Number.isFinite(price) || price === 0) return null
  if (price < 0) return 1 + 100 / Math.abs(price)
  if (price >= 100) return 1 + price / 100
  if (price > 1) return price
  return null
}

export function roundOdd(value: number) {
  return Math.round(value * 1000) / 1000
}
