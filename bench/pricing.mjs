/**
 * DeepSeek Flash list-price quote, used only to cap and label a benchmark run.
 *
 * Prices are CNY per 1M tokens, from the official pricing page retrieved
 * 2026-11-13: off-peak cache hit 0.02 / cache miss 1 / output 4; peak doubles
 * those. Peak is Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00. Cache writes
 * are priced as cache-miss input (conservative). Holidays are not modelled.
 *
 * This is a benchmark guard, not a billing statement; provider billing wins.
 * @module dsh-pressure/bench/pricing
 */

export const DEEPSEEK_FLASH_PRICES = Object.freeze({
  offPeak: Object.freeze({ cacheHit: 0.02, cacheMiss: 1, output: 4 }),
  peak: Object.freeze({ cacheHit: 0.04, cacheMiss: 2, output: 8 }),
})

/**
 * @param {Date} [at]
 * @returns {boolean} whether the instant falls in the weekday peak window (Beijing)
 */
export function isPeak(at = new Date()) {
  const beijing = new Date(at.getTime() + 8 * 60 * 60 * 1000)
  const day = beijing.getUTCDay()
  const hour = beijing.getUTCHours()
  if (day === 0 || day === 6) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/**
 * @param {{ input?: number, cacheRead?: number, cacheWrite?: number, output?: number }} tokens
 * @param {Date} [at]
 * @returns {number} CNY, rounded to 6 decimals
 */
export function quoteCny(tokens, at = new Date()) {
  const prices = isPeak(at) ? DEEPSEEK_FLASH_PRICES.peak : DEEPSEEK_FLASH_PRICES.offPeak
  const cacheMiss = (tokens.input ?? 0) + (tokens.cacheWrite ?? 0)
  const cost = (cacheMiss / 1e6) * prices.cacheMiss
    + ((tokens.cacheRead ?? 0) / 1e6) * prices.cacheHit
    + ((tokens.output ?? 0) / 1e6) * prices.output
  return Math.round(cost * 1e6) / 1e6
}
