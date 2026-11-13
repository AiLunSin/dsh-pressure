import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evaluateFlags, primaryAdvice } from '../src/flags.js'
import { assertReceiptSafe, buildReceipt } from '../src/receipt.js'
import { createState, fold } from '../src/stats.js'

const THRESHOLDS = {
  contextPressure: 0.8,
  budgetPressure: 0.8,
  failureStreak: 2,
  bloatedResultTokens: 8000,
  compactionChurn: 2,
}

/** @param {string} name */
function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}

/** @param {any[]} events */
function foldAll(events) {
  let state = createState('sess_replay')
  for (const event of events) state = fold(state, event)
  return state
}

/** @param {any[]} events */
function countTools(events) {
  const calls = events.filter((event) => event.type === 'tool/call').length
  const failures = events.filter((event) => event.type === 'tool/result'
    && (event.data?.message?.isError === true || event.data?.error !== undefined)).length
  const compactions = events.filter((event) => event.type === 'compaction/end').length
  return { calls, failures, compactions }
}

/**
 * @param {any[]} events
 * @param {{ pressure?: any, thresholds?: any, budget?: any }} [options]
 */
function receiptFor(events, options = {}) {
  const state = foldAll(events)
  const lastTurn = events.filter((event) => event.type === 'turn/end').at(-1)
  const turn = lastTurn?.data?.turn ?? state.turn
  const pressure = options.pressure === undefined
    ? { pressureTokens: 200, contextWindow: 1000 }
    : options.pressure
  const ratio = pressure !== null && typeof pressure?.pressureTokens === 'number'
    ? pressure.pressureTokens / pressure.contextWindow
    : null
  const flags = evaluateFlags({
    state,
    turn,
    pressure,
    budget: options.budget ?? {
      limits: { sessionTokens: 0, turnTokens: 0, turnToolCalls: 0 },
      sessionSpent: 0,
      turnSpent: 0,
      turnCalls: 0,
      denied: 0,
    },
    thresholds: options.thresholds ?? THRESHOLDS,
  })
  return buildReceipt({
    sessionId: 'sess_replay',
    turn,
    state,
    usage: { input: 1000, output: 100, cacheRead: 200, cacheWrite: 50 },
    context: {
      endPressure: ratio,
      observedPeak: ratio,
      observedFrom: ratio === null ? 'unavailable' : 'live',
      window: pressure?.contextWindow ?? null,
    },
    budget: { mode: 'observe', sessionTokens: 0, sessionSpent: 1350, overBudget: 0, denied: 0 },
    flags,
    adviceKey: primaryAdvice(flags),
    partial: false,
    asOfSeq: events.length,
    version: '0.1.0',
    now: 9_999_999,
  })
}

test('normal fixture replays deterministically with matching tool counts', () => {
  const events = loadFixture('session-normal.json')
  const expected = countTools(events)
  const first = foldAll(events)
  const second = foldAll(events)
  assert.deepEqual(first, second)
  assert.equal(first.turn, 2)
  assert.equal(first.turnTools.total, 1)
  assert.equal(first.tools.total, 3)

  const receipt = receiptFor(events)
  assert.equal(receipt.turn, 2)
  // Receipt tool counters are per turn; the cumulative total stays in state.
  assert.equal(receipt.tools.calls, events.filter((event) => event.type === 'tool/call' && event.data.turn === 2).length)
  assert.equal(receipt.tools.failures, expected.failures)
  assert.equal(receipt.flags.length, 0)
  assert.equal(receipt.adviceKey, 'advice.none')
  assert.doesNotThrow(() => assertReceiptSafe(receipt))
  assert.equal(JSON.stringify(receipt).includes('src/alpha.js'), false)
})

test('failure fixture keeps counters, emits failure_streak, and leaks no body', () => {
  const events = loadFixture('session-failure.json')
  const expected = countTools(events)
  const receipt = receiptFor(events)
  assert.equal(receipt.tools.calls, expected.calls)
  assert.equal(receipt.tools.failures, expected.failures)
  assert.equal(receipt.turn, 1)
  const streak = receipt.flags.find((flag) => flag.code === 'failure_streak')
  assert.ok(streak)
  assert.equal(streak.count, 3)
  assert.equal(streak.severity, 'warn')
  // Three identical consecutive calls are counted, not reminded.
  assert.ok(receipt.flags.some((flag) => flag.code === 'repeat_calls'))
  const serialized = JSON.stringify(receipt)
  assert.equal(serialized.includes('SECRET_BODY_SHOULD_NOT_PERSIST'), false)
  assert.equal(serialized.includes('npm test'), false)
  assert.doesNotThrow(() => assertReceiptSafe(receipt))
})

test('compaction fixture counts ends only and flags churn and bloat', () => {
  const events = loadFixture('session-compaction.json')
  const expected = countTools(events)
  assert.equal(expected.compactions, 2)
  const receipt = receiptFor(events, { thresholds: { ...THRESHOLDS, bloatedResultTokens: 5000 } })
  assert.equal(receipt.context.compactions, 2)
  assert.ok(receipt.flags.some((flag) => flag.code === 'compaction_churn'))
  const bloat = receipt.flags.find((flag) => flag.code === 'bloated_result')
  assert.ok(bloat)
  assert.ok(bloat.evidence.estimatedTokens >= 5000)
  const serialized = JSON.stringify(receipt)
  assert.equal(serialized.includes('BLOAT_BODY_SHOULD_NOT_PERSIST'), false)
})

test('context pressure source is explicit and never invents a peak', () => {
  const events = loadFixture('session-normal.json')
  const receipt = receiptFor(events, { pressure: null })
  assert.equal(receipt.context.observedFrom, 'unavailable')
  assert.equal(receipt.context.observedPeak, null)
  assert.equal(receipt.tokens.total, 1350)
  assert.equal(receipt.tokens.cacheHitRate, 0.16)
})
