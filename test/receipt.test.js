import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertReceiptSafe,
  buildReceipt,
  cacheHitRate,
  normalizeUsage,
  totalTokens,
  usageDelta,
} from '../src/receipt.js'
import { createState } from '../src/stats.js'

test('usage normalization rejects partial records instead of guessing', () => {
  assert.deepEqual(normalizeUsage({ uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }), {
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
  })
  assert.equal(normalizeUsage({ uncachedInputTokens: 1 }), null)
  assert.equal(normalizeUsage(null), null)
})

test('usage delta rejects negative and unknown baselines', () => {
  const baseline = { input: 10, output: 2, cacheRead: 4, cacheWrite: 1 }
  assert.deepEqual(usageDelta({ input: 15, output: 5, cacheRead: 9, cacheWrite: 3 }, baseline), {
    input: 5,
    output: 3,
    cacheRead: 5,
    cacheWrite: 2,
  })
  assert.equal(usageDelta({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, null), null)
  assert.equal(usageDelta({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, baseline), null)
})

test('cache hit rate uses the documented denominator and is null on zero', () => {
  assert.equal(totalTokens({ input: 100, output: 50, cacheRead: 30, cacheWrite: 20 }), 200)
  assert.equal(cacheHitRate({ input: 100, output: 50, cacheRead: 30, cacheWrite: 20 }), 0.2)
  assert.equal(cacheHitRate({ input: 0, output: 10, cacheRead: 0, cacheWrite: 0 }), null)
  assert.equal(totalTokens(null), null)
})

test('receipt has the documented shape and no forbidden fields', () => {
  const state = createState('sess_receipt')
  state.turn = 7
  state.turnStartedAt = 1_700_000_000_000
  state.turnTools = { total: 4, failed: 2, repeats: 1, consecutiveFailures: 2, maxConsecutiveFailures: 2 }
  state.tools.maxResultEstTokens = 9000
  state.turnCompactions = 2
  const receipt = buildReceipt({
    sessionId: 'sess_receipt',
    turn: 7,
    state,
    usage: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 100 },
    context: { endPressure: 0.8, observedPeak: 0.82, observedFrom: 'live', window: 128000 },
    budget: { mode: 'coach', sessionTokens: 1000, sessionSpent: 1800, overBudget: 800, denied: 0 },
    flags: [{ code: 'budget_pressure', severity: 'high', count: 100, turn: 7, adviceKey: 'advice.convergeOrRaise', evidence: { ratio: 1.8 } }],
    adviceKey: 'advice.convergeOrRaise',
    partial: false,
    asOfSeq: 1234,
    version: '0.1.0',
    now: 1_700_000_010_000,
  })
  assert.equal(receipt.schemaVersion, 1)
  assert.match(receipt.id, /^sha256:[0-9a-f]{32}$/u)
  assert.equal(receipt.turn, 7)
  assert.equal(receipt.wallMs, 10_000)
  assert.equal(receipt.tokens.total, 1800)
  assert.equal(receipt.tokens.cacheHitRate, 0.3125)
  assert.equal(receipt.context.compactions, 2)
  assert.equal(receipt.budget.overBudget, 800)
  assert.equal(receipt.flags[0].code, 'budget_pressure')
  assert.equal(receipt.source.asOfSeq, 1234)
  assert.doesNotThrow(() => assertReceiptSafe(receipt))
})

test('receipt marks unknown tokens and missing context honestly', () => {
  const state = createState('sess_unknown')
  state.turn = 1
  const receipt = buildReceipt({
    sessionId: 'sess_unknown',
    turn: 1,
    state,
    usage: null,
    context: { endPressure: null, observedPeak: null, observedFrom: 'unavailable', window: null },
    budget: { mode: 'observe', sessionTokens: 0, sessionSpent: 0, overBudget: 0, denied: 0 },
    flags: [],
    adviceKey: 'advice.none',
    partial: true,
    asOfSeq: null,
    version: '0.1.0',
    now: 1_700_000_000_000,
  })
  assert.equal(receipt.tokens.total, null)
  assert.equal(receipt.tokens.cacheHitRate, null)
  assert.equal(receipt.context.observedFrom, 'unavailable')
  assert.equal(receipt.partial, true)
  assert.equal(receipt.startedAt, null)
})
