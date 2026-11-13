/**
 * Pure, bounded fold over committed Session events. This is the Host-only
 * replacement for a registered `sessionStats`-style projection (see
 * docs/compat-notes.md D-1): token and wall-time figures still come from the
 * official projections, while this fold only owns tool/compaction counters.
 * @module dsh-pressure/stats
 */

import { estimateMessageTokens, hashArguments } from './util.js'

export const STATE_VERSION = 1
export const MAX_TOOL_NAMES = 32
export const MAX_SIGNATURES = 64
export const MAX_PENDING_CALLS = 64

/**
 * @typedef {{
 *   schemaVersion: number,
 *   sessionId: string | null,
 *   turn: number,
 *   step: number,
 *   turnStartedAt: number | null,
 *   lastStepAt: number | null,
 *   tools: {
 *     total: number,
 *     failed: number,
 *     byName: Record<string, { calls: number, failures: number, maxDurationMs: number }>,
 *     maxResultEstTokens: number,
 *   },
 *   turnTools: {
 *     total: number,
 *     failed: number,
 *     repeats: number,
 *     consecutiveFailures: number,
 *     maxConsecutiveFailures: number,
 *   },
 *   compactions: number,
 *   turnCompactions: number,
 *   signatures: Array<{ h: string, n: number }>,
 *   pending: Record<string, { name: string, at: number }>,
 *   lastTurn: null | {
 *     turn: number,
 *     startedAt: number | null,
 *     endedAt: number,
 *     tools: { total: number, failed: number, repeats: number, maxConsecutiveFailures: number },
 *     compactions: number,
 *   },
 * }} PressureStatsState
 */

/**
 * @param {string | null} [sessionId]
 * @returns {PressureStatsState}
 */
export function createState(sessionId = null) {
  return {
    schemaVersion: STATE_VERSION,
    sessionId,
    turn: 0,
    step: 0,
    turnStartedAt: null,
    lastStepAt: null,
    tools: { total: 0, failed: 0, byName: {}, maxResultEstTokens: 0 },
    turnTools: { total: 0, failed: 0, repeats: 0, consecutiveFailures: 0, maxConsecutiveFailures: 0 },
    compactions: 0,
    turnCompactions: 0,
    signatures: [],
    pending: {},
    lastTurn: null,
  }
}

/**
 * Fold one committed Session event into the state. Unrelated events return the
 * same state reference so callers can cheaply skip work.
 * @param {PressureStatsState} state
 * @param {{ type?: string, time?: number, data?: any }} event
 * @returns {PressureStatsState}
 */
export function fold(state, event) {
  if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return state
  const time = typeof event.time === 'number' ? event.time : null
  const data = event.data ?? {}

  switch (event.type) {
    case 'turn/start':
      return {
        ...state,
        turn: int(data.turn, state.turn),
        step: 0,
        turnStartedAt: time,
        lastStepAt: null,
        turnTools: { total: 0, failed: 0, repeats: 0, consecutiveFailures: 0, maxConsecutiveFailures: 0 },
        turnCompactions: 0,
        signatures: [],
        pending: {},
      }

    case 'step/start':
      return {
        ...state,
        turn: int(data.turn, state.turn),
        step: int(data.step, state.step),
        lastStepAt: time,
      }

    case 'step/end':
      return {
        ...state,
        turn: int(data.turn, state.turn),
        step: Math.max(state.step, int(data.step, state.step)),
        lastStepAt: time,
      }

    case 'tool/call': {
      const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : 'unknown'
      const callId = String(data.callId ?? '')
      const signature = typeof data.arguments === 'string' ? hashArguments(data.arguments) : ''
      return {
        ...state,
        tools: {
          ...state.tools,
          total: state.tools.total + 1,
          byName: addToolCall(state.tools.byName, name),
        },
        turnTools: {
          ...state.turnTools,
          total: state.turnTools.total + 1,
        },
        signatures: addSignature(state.signatures, signature),
        pending: addPending(state.pending, callId, name, time),
      }
    }

    case 'tool/result': {
      const failed = data?.message?.isError === true || data?.error !== undefined
      const callId = String(data?.message?.toolCallId ?? '')
      const pendingCall = state.pending[callId]
      const pending = { ...state.pending }
      delete pending[callId]
      const resultTokens = estimateMessageTokens(data?.message)
      const nextByName = pendingCall === undefined
        ? state.tools.byName
        : addToolResult(state.tools.byName, pendingCall, { failed, time })
      const consecutiveFailures = failed ? state.turnTools.consecutiveFailures + 1 : 0
      return {
        ...state,
        tools: {
          ...state.tools,
          failed: state.tools.failed + (failed ? 1 : 0),
          byName: nextByName,
          maxResultEstTokens: Math.max(state.tools.maxResultEstTokens, resultTokens),
        },
        turnTools: {
          ...state.turnTools,
          failed: state.turnTools.failed + (failed ? 1 : 0),
          consecutiveFailures,
          maxConsecutiveFailures: Math.max(state.turnTools.maxConsecutiveFailures, consecutiveFailures),
        },
        pending,
      }
    }

    case 'compaction/end':
      return {
        ...state,
        compactions: state.compactions + 1,
        turnCompactions: state.turnCompactions + 1,
      }

    case 'turn/end':
      return {
        ...state,
        turn: int(data.turn, state.turn),
        lastTurn: {
          turn: int(data.turn, state.turn),
          startedAt: state.turnStartedAt,
          endedAt: time ?? 0,
          tools: {
            total: state.turnTools.total,
            failed: state.turnTools.failed,
            repeats: state.turnTools.repeats,
            maxConsecutiveFailures: state.turnTools.maxConsecutiveFailures,
          },
          compactions: state.turnCompactions,
        },
        turnTools: { ...state.turnTools, consecutiveFailures: state.turnTools.consecutiveFailures },
        pending: {},
      }

    default:
      return state
  }
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function int(value, fallback) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

/**
 * @param {Record<string, { calls: number, failures: number, maxDurationMs: number }>} byName
 * @param {string} name
 * @returns {Record<string, { calls: number, failures: number, maxDurationMs: number }>}
 */
function addToolCall(byName, name) {
  const known = Object.hasOwn(byName, name)
  const key = known || Object.keys(byName).length < MAX_TOOL_NAMES - 1 ? name : '__other__'
  const current = byName[key] ?? { calls: 0, failures: 0, maxDurationMs: 0 }
  return { ...byName, [key]: { ...current, calls: current.calls + 1 } }
}

/**
 * @param {Record<string, { calls: number, failures: number, maxDurationMs: number }>} byName
 * @param {{ name: string, at: number | null }} pendingCall
 * @param {{ failed: boolean, time: number | null }} outcome
 * @returns {Record<string, { calls: number, failures: number, maxDurationMs: number }>}
 */
function addToolResult(byName, pendingCall, outcome) {
  const key = Object.hasOwn(byName, pendingCall.name) ? pendingCall.name : '__other__'
  const current = byName[key] ?? { calls: 0, failures: 0, maxDurationMs: 0 }
  const duration = outcome.time !== null && pendingCall.at !== null ? Math.max(0, outcome.time - pendingCall.at) : 0
  return {
    ...byName,
    [key]: {
      ...current,
      failures: current.failures + (outcome.failed ? 1 : 0),
      maxDurationMs: Math.max(current.maxDurationMs, duration),
    },
  }
}

/**
 * @param {Array<{ h: string, n: number }>} signatures
 * @param {string} hash
 * @returns {Array<{ h: string, n: number }>}
 */
function addSignature(signatures, hash) {
  if (hash.length === 0) return signatures
  const head = signatures[0]
  if (head !== undefined && head.h === hash) {
    return [{ h: hash, n: head.n + 1 }, ...signatures.slice(1)]
  }
  return [{ h: hash, n: 1 }, ...signatures.slice(0, MAX_SIGNATURES - 1)]
}

/**
 * Record a pending tool call for callId pairing, bounded to the newest calls.
 * @param {Record<string, { name: string, at: number | null }>} pending
 * @param {string} callId
 * @param {string} name
 * @param {number | null} at
 * @returns {Record<string, { name: string, at: number | null }>}
 */
function addPending(pending, callId, name, at) {
  if (callId.length === 0) return pending
  const next = { ...pending, [callId]: { name, at } }
  const keys = Object.keys(next)
  if (keys.length > MAX_PENDING_CALLS) delete next[keys[0]]
  return next
}

/**
 * Number of repeated calls in the current turn (occurrences beyond the first).
 * @param {PressureStatsState} state
 * @returns {number}
 */
export function repeatCount(state) {
  return state.signatures.reduce((total, entry) => total + Math.max(0, entry.n - 1), 0)
}
