/**
 * Receipt construction and its privacy guard. A receipt is derived data: numbers,
 * stable codes, and advice keys only — never prompt text, tool arguments, or
 * tool results.
 * @module dsh-pressure/receipt
 */

import { repeatCount } from './stats.js'
import { receiptIdFor, ratio } from './util.js'

export const RECEIPT_SCHEMA_VERSION = 1

/** Keys that must never appear anywhere in a receipt. */
const FORBIDDEN_KEYS = new Set([
  'content',
  'text',
  'prompt',
  'messages',
  'arguments',
  'args',
  'result',
  'tooloutput',
  'tool_result',
  'summary',
  'apikey',
  'api_key',
  'authorization',
  'token',
  'secret',
  'password',
])

/**
 * Normalize the official `tokenUsage` view.
 * @param {{ uncachedInputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number } | null | undefined} usage
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null}
 */
export function normalizeUsage(usage) {
  if (usage === null || usage === undefined) return null
  const input = usage.uncachedInputTokens
  const output = usage.outputTokens
  const cacheRead = usage.cacheReadTokens
  const cacheWrite = usage.cacheWriteTokens
  if (![input, output, cacheRead, cacheWrite].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
    return null
  }
  return { input, output, cacheRead, cacheWrite }
}

/**
 * Per-turn delta between two cumulative usage snapshots.
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null} current
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null} baseline
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null}
 */
export function usageDelta(current, baseline) {
  if (current === null || baseline === null) return null
  const delta = {
    input: current.input - baseline.input,
    output: current.output - baseline.output,
    cacheRead: current.cacheRead - baseline.cacheRead,
    cacheWrite: current.cacheWrite - baseline.cacheWrite,
  }
  // A counter reset (restored session, plugin reinstall) must not produce
  // negative deltas; treat the turn as unmeasured instead.
  if (delta.input < 0 || delta.output < 0 || delta.cacheRead < 0 || delta.cacheWrite < 0) return null
  return delta
}

/**
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null} buckets
 * @returns {number | null}
 */
export function totalTokens(buckets) {
  if (buckets === null) return null
  return buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite
}

/**
 * Cache hit rate by the documented formula.
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null} buckets
 * @returns {number | null}
 */
export function cacheHitRate(buckets) {
  if (buckets === null) return null
  return ratio(buckets.cacheRead, buckets.cacheRead + buckets.input + buckets.cacheWrite)
}

/**
 * @param {{
 *   sessionId: string,
 *   turn: number,
 *   state: import('./stats.js').PressureStatsState,
 *   usage: { input: number, output: number, cacheRead: number, cacheWrite: number } | null,
 *   context: { endPressure: number | null, observedPeak: number | null, observedFrom: 'live' | 'end-only' | 'unavailable', window: number | null },
 *   budget: ReturnType<typeof import('./budget.js').snapshot>,
 *   flags: import('./flags.js').PressureFlag[],
 *   adviceKey: string,
 *   partial: boolean,
 *   asOfSeq: number | null,
 *   version: string,
 *   now: number,
 * }} input
 */
export function buildReceipt(input) {
  const endedAt = input.now
  const startedAt = input.state.turnStartedAt
  const wallMs = startedAt !== null && endedAt >= startedAt ? endedAt - startedAt : null
  const tokens = input.usage
  const sessionLimit = input.budget.sessionTokens
  const over = sessionLimit > 0 ? Math.max(0, input.budget.sessionSpent - sessionLimit) : 0

  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    id: receiptIdFor(input.sessionId, input.turn),
    sessionId: input.sessionId,
    turn: input.turn,
    startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    updatedAt: new Date(endedAt).toISOString(),
    partial: input.partial,
    wallMs,
    tokens: {
      input: tokens?.input ?? null,
      output: tokens?.output ?? null,
      cacheRead: tokens?.cacheRead ?? null,
      cacheWrite: tokens?.cacheWrite ?? null,
      total: totalTokens(tokens),
      cacheHitRate: cacheHitRate(tokens),
    },
    context: {
      endPressure: input.context.endPressure,
      observedPeak: input.context.observedPeak,
      observedFrom: input.context.observedFrom,
      window: input.context.window,
      compactions: input.state.turnCompactions,
    },
    tools: {
      calls: input.state.turnTools.total,
      failures: input.state.turnTools.failed,
      repeats: repeatCount(input.state),
      maxResultEstTokens: input.state.tools.maxResultEstTokens,
    },
    budget: {
      mode: input.budget.mode,
      sessionLimit,
      sessionSpent: input.budget.sessionSpent,
      overBudget: over,
      denied: input.budget.denied,
    },
    flags: input.flags,
    adviceKey: input.adviceKey,
    source: {
      plugin: 'dsh-pressure',
      version: input.version,
      asOfSeq: input.asOfSeq,
      measuredAt: new Date(endedAt).toISOString(),
    },
  }
}

/**
 * Guard against accidental body capture. Throws on a forbidden key so the
 * writer refuses the record instead of persisting sensitive content.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {void}
 */
export function assertReceiptSafe(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertReceiptSafe(entry, `${path}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll('-', '_')
    if (FORBIDDEN_KEYS.has(normalized)) {
      throw new Error(`dsh-pressure/receipt: forbidden field "${path}.${key}"`)
    }
    assertReceiptSafe(child, `${path}.${key}`)
  }
}
