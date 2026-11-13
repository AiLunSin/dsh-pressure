/**
 * Budget state machine. Token spend is settled after each turn because the
 * provider reports usage only when the model response is committed; the guard
 * therefore brakes *after* an observed overrun, never as a hard ceiling.
 * @module dsh-pressure/budget
 */

/**
 * @typedef {{
 *   limits: { sessionTokens: number, turnTokens: number, turnToolCalls: number },
 *   sessionSpent: number,
 *   turnSpent: number,
 *   turnCalls: number,
 *   denied: number,
 * }} BudgetState
 */

/**
 * @param {{ sessionTokens: number, turnTokens: number, turnToolCalls: number }} limits
 * @returns {BudgetState}
 */
export function createBudget(limits) {
  return {
    limits: { ...limits },
    sessionSpent: 0,
    turnSpent: 0,
    turnCalls: 0,
    denied: 0,
  }
}

/**
 * Reset the per-turn counters; cumulative spend is kept.
 * @param {BudgetState} budget
 * @returns {BudgetState}
 */
export function startTurn(budget) {
  return { ...budget, turnSpent: 0, turnCalls: 0, denied: 0 }
}

/**
 * Add one settled turn's usage to both scopes.
 * @param {BudgetState} budget
 * @param {{ input: number, output: number, cacheRead: number, cacheWrite: number } | null} delta
 * @returns {BudgetState}
 */
export function settleUsage(budget, delta) {
  if (delta === null) return budget
  const total = delta.input + delta.output + delta.cacheRead + delta.cacheWrite
  return {
    ...budget,
    sessionSpent: budget.sessionSpent + total,
    turnSpent: budget.turnSpent + total,
  }
}

/**
 * Record one attempted tool call (allowed or denied).
 * @param {BudgetState} budget
 * @returns {BudgetState}
 */
export function noteToolCall(budget) {
  return { ...budget, turnCalls: budget.turnCalls + 1 }
}

/**
 * Record one denied call.
 * @param {BudgetState} budget
 * @returns {BudgetState}
 */
export function noteDenied(budget) {
  return { ...budget, denied: budget.denied + 1 }
}

/**
 * @typedef {{ dimension: 'sessionTokens' | 'turnTokens' | 'turnToolCalls', spent: number, limit: number }} BudgetBreach
 */

/**
 * The first exhausted dimension, in session → turn token → turn tool order.
 * `turnToolCalls` is checked before the call is allowed, so a limit of 5 denies
 * the 6th call.
 * @param {BudgetState} budget
 * @returns {BudgetBreach | null}
 */
export function findBreach(budget) {
  if (budget.limits.sessionTokens > 0 && budget.sessionSpent >= budget.limits.sessionTokens) {
    return {
      dimension: 'sessionTokens',
      spent: budget.sessionSpent,
      limit: budget.limits.sessionTokens,
    }
  }
  if (budget.limits.turnTokens > 0 && budget.turnSpent >= budget.limits.turnTokens) {
    return {
      dimension: 'turnTokens',
      spent: budget.turnSpent,
      limit: budget.limits.turnTokens,
    }
  }
  if (budget.limits.turnToolCalls > 0 && budget.turnCalls >= budget.limits.turnToolCalls) {
    return {
      dimension: 'turnToolCalls',
      spent: budget.turnCalls,
      limit: budget.limits.turnToolCalls,
    }
  }
  return null
}

/**
 * Whether the guard should deny the next call. `observe` and `coach` never deny.
 * @param {{ mode: 'observe' | 'coach' | 'enforce' }} config
 * @param {BudgetState} budget
 * @returns {BudgetBreach | null}
 */
export function guardBreach(config, budget) {
  if (config.mode !== 'enforce') return null
  return findBreach(budget)
}

/**
 * Change one limit at runtime; returns the new state (0 = unlimited).
 * @param {BudgetState} budget
 * @param {'sessionTokens' | 'turnTokens' | 'turnToolCalls'} dimension
 * @param {number} value
 * @returns {BudgetState}
 */
export function setLimit(budget, dimension, value) {
  return { ...budget, limits: { ...budget.limits, [dimension]: value } }
}

/**
 * Public snapshot for the HTTP API and commands.
 * @param {BudgetState} budget
 * @returns {{ sessionTokens: number, turnTokens: number, turnToolCalls: number, sessionSpent: number, turnSpent: number, turnCalls: number, denied: number }}
 */
export function snapshot(budget) {
  return {
    sessionTokens: budget.limits.sessionTokens,
    turnTokens: budget.limits.turnTokens,
    turnToolCalls: budget.limits.turnToolCalls,
    sessionSpent: budget.sessionSpent,
    turnSpent: budget.turnSpent,
    turnCalls: budget.turnCalls,
    denied: budget.denied,
  }
}
