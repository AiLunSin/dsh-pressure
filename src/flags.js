/**
 * Waste-signal rules. Every signal carries a stable code, severity, evidence
 * counters (numbers only), and a localized advice key — never body text.
 * @module dsh-pressure/flags
 */

import { isFiniteNumber, ratio } from './util.js'
import { repeatCount } from './stats.js'

/** Stable published codes. Never rename a shipped code. */
export const FLAG_CODES = Object.freeze([
  'failure_streak',
  'context_pressure',
  'budget_pressure',
  'bloated_result',
  'compaction_churn',
  'repeat_calls',
  'budget_exhausted',
])

const ADVICE = Object.freeze({
  failure_streak: 'advice.inspectLastError',
  context_pressure: 'advice.compactOrNarrow',
  budget_pressure: 'advice.convergeOrRaise',
  bloated_result: 'advice.narrowRead',
  compaction_churn: 'advice.avoidReReading',
  repeat_calls: 'advice.changeApproach',
  budget_exhausted: 'advice.toolsStopped',
})

const SEVERITY_RANK = Object.freeze({ high: 3, warn: 2, info: 1 })

/** Advice key for each published signal code (exported for locale parity tests). */
export const FLAG_ADVICE = ADVICE

/**
 * @typedef {{
 *   code: string,
 *   severity: 'info' | 'warn' | 'high',
 *   count: number,
 *   turn: number,
 *   step?: number,
 *   adviceKey: string,
 *   evidence: Record<string, number | boolean | string>,
 * }} PressureFlag
 */

/**
 * Evaluate every signal for one turn.
 *
 * @param {{
 *   state: import('./stats.js').PressureStatsState,
 *   turn: number,
 *   pressure: { pressureTokens?: number, projectedTokens?: number, contextWindow?: number } | null,
 *   budget: { limits: { sessionTokens: number, turnTokens: number, turnToolCalls: number }, sessionSpent: number, turnSpent: number, turnCalls: number, denied: number },
 *   thresholds: { contextPressure: number, budgetPressure: number, failureStreak: number, bloatedResultTokens: number, compactionChurn: number },
 *   denied?: number,
 * }} input
 * @returns {PressureFlag[]}
 */
export function evaluateFlags(input) {
  const { state, thresholds, budget } = input
  const turn = input.turn
  /** @type {PressureFlag[]} */
  const flags = []

  const streak = state.turnTools.maxConsecutiveFailures
  if (streak >= thresholds.failureStreak) {
    flags.push({
      code: 'failure_streak',
      severity: streak >= thresholds.failureStreak * 2 ? 'high' : 'warn',
      count: streak,
      turn,
      ...(state.step > 0 ? { step: state.step } : {}),
      adviceKey: ADVICE.failure_streak,
      evidence: { consecutiveFailures: streak, threshold: thresholds.failureStreak },
    })
  }

  const contextRatio = contextPressureRatio(input.pressure)
  if (contextRatio !== null && contextRatio >= thresholds.contextPressure) {
    flags.push({
      code: 'context_pressure',
      severity: contextRatio >= 0.9 ? 'high' : 'warn',
      count: Math.round(contextRatio * 100),
      turn,
      adviceKey: ADVICE.context_pressure,
      evidence: {
        ratio: contextRatio,
        threshold: thresholds.contextPressure,
        window: isFiniteNumber(input.pressure?.contextWindow) ? input.pressure.contextWindow : 0,
      },
    })
  }

  const budgetRatios = budgetPressureRatios(budget)
  if (budgetRatios.length > 0) {
    const worst = budgetRatios.reduce((left, right) => (right.ratio > left.ratio ? right : left))
    if (worst.ratio >= thresholds.budgetPressure) {
      flags.push({
        code: 'budget_pressure',
        severity: worst.ratio >= 1 ? 'high' : 'warn',
        count: Math.round(worst.ratio * 100),
        turn,
        adviceKey: ADVICE.budget_pressure,
        evidence: {
          dimension: worst.dimension,
          spent: worst.spent,
          limit: worst.limit,
          ratio: worst.ratio,
          threshold: thresholds.budgetPressure,
        },
      })
    }
  }

  const resultTokens = state.tools.maxResultEstTokens
  if (resultTokens >= thresholds.bloatedResultTokens) {
    flags.push({
      code: 'bloated_result',
      severity: resultTokens >= thresholds.bloatedResultTokens * 2 ? 'warn' : 'info',
      count: resultTokens,
      turn,
      adviceKey: ADVICE.bloated_result,
      evidence: { estimatedTokens: resultTokens, threshold: thresholds.bloatedResultTokens },
    })
  }

  if (state.turnCompactions >= thresholds.compactionChurn) {
    flags.push({
      code: 'compaction_churn',
      severity: state.turnCompactions >= thresholds.compactionChurn * 2 ? 'high' : 'warn',
      count: state.turnCompactions,
      turn,
      adviceKey: ADVICE.compaction_churn,
      evidence: { compactions: state.turnCompactions, threshold: thresholds.compactionChurn },
    })
  }

  const repeats = repeatCount(state)
  if (repeats > 0) {
    flags.push({
      code: 'repeat_calls',
      severity: 'info',
      count: repeats,
      turn,
      adviceKey: ADVICE.repeat_calls,
      evidence: { repeats },
    })
  }

  const denied = input.denied ?? budget.denied ?? 0
  if (denied > 0) {
    flags.push({
      code: 'budget_exhausted',
      severity: 'high',
      count: denied,
      turn,
      adviceKey: ADVICE.budget_exhausted,
      evidence: { denied },
    })
  }

  return flags.sort(compareFlags)
}

/**
 * @param {PressureFlag} left
 * @param {PressureFlag} right
 * @returns {number}
 */
function compareFlags(left, right) {
  const bySeverity = (SEVERITY_RANK[right.severity] ?? 0) - (SEVERITY_RANK[left.severity] ?? 0)
  return bySeverity !== 0 ? bySeverity : left.code.localeCompare(right.code)
}

/**
 * Context occupancy as a ratio (0..1+n), preferring the projected next request.
 * @param {{ pressureTokens?: number, projectedTokens?: number, contextWindow?: number } | null | undefined} pressure
 * @returns {number | null}
 */
export function contextPressureRatio(pressure) {
  if (pressure === null || pressure === undefined) return null
  if (!isFiniteNumber(pressure.contextWindow) || pressure.contextWindow <= 0) return null
  const numerator = isFiniteNumber(pressure.projectedTokens) && pressure.projectedTokens > 0
    ? pressure.projectedTokens
    : pressure.pressureTokens
  return ratio(numerator, pressure.contextWindow)
}

/**
 * Ratios of every configured limit that has observations.
 * @param {{ limits: { sessionTokens: number, turnTokens: number, turnToolCalls: number }, sessionSpent: number, turnSpent: number, turnCalls: number }} budget
 * @returns {Array<{ dimension: 'sessionTokens' | 'turnTokens' | 'turnToolCalls', spent: number, limit: number, ratio: number }>}
 */
export function budgetPressureRatios(budget) {
  const out = []
  if (budget.limits.sessionTokens > 0) {
    out.push({
      dimension: /** @type {const} */ ('sessionTokens'),
      spent: budget.sessionSpent,
      limit: budget.limits.sessionTokens,
      ratio: ratio(budget.sessionSpent, budget.limits.sessionTokens) ?? 0,
    })
  }
  if (budget.limits.turnTokens > 0) {
    out.push({
      dimension: /** @type {const} */ ('turnTokens'),
      spent: budget.turnSpent,
      limit: budget.limits.turnTokens,
      ratio: ratio(budget.turnSpent, budget.limits.turnTokens) ?? 0,
    })
  }
  if (budget.limits.turnToolCalls > 0) {
    out.push({
      dimension: /** @type {const} */ ('turnToolCalls'),
      spent: budget.turnCalls,
      limit: budget.limits.turnToolCalls,
      ratio: ratio(budget.turnCalls, budget.limits.turnToolCalls) ?? 0,
    })
  }
  return out
}

/**
 * One "next step" advice key for a receipt: the highest-severity signal wins.
 * @param {PressureFlag[]} flags
 * @returns {string} advice key, or `advice.none`
 */
export function primaryAdvice(flags) {
  return flags.length === 0 ? 'advice.none' : flags[0].adviceKey
}

/**
 * Over-budget token amount for the receipt.
 * @param {number} spent
 * @param {number} limit
 * @returns {number}
 */
export function overBudget(spent, limit) {
  if (!(limit > 0)) return 0
  return Math.max(0, spent - limit)
}
