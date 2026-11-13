import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudget, findBreach, guardBreach, noteDenied, noteToolCall, setLimit, settleUsage, snapshot, startTurn } from '../src/budget.js'
import { budgetPressureRatios, contextPressureRatio, evaluateFlags, primaryAdvice } from '../src/flags.js'
import { createState, fold } from '../src/stats.js'

const thresholds = {
  contextPressure: 0.8,
  budgetPressure: 0.8,
  failureStreak: 2,
  bloatedResultTokens: 8000,
  compactionChurn: 2,
}

/** @param {number} turn */
function stateAt(turn) {
  let state = createState('sess')
  state = fold(state, { type: 'turn/start', data: { turn }, time: 1, seq: 1 })
  return state
}

test('tool-call limit denies the call after the limit, not the limit itself', () => {
  let budget = createBudget({ sessionTokens: 0, turnTokens: 0, turnToolCalls: 2 })
  budget = startTurn(budget)
  assert.deepEqual(guardBreach({ mode: 'enforce' }, budget), null)
  budget = noteToolCall(budget)
  budget = noteToolCall(budget)
  assert.equal(budget.turnCalls, 2)
  assert.equal(guardBreach({ mode: 'enforce' }, budget).dimension, 'turnToolCalls')
  // observe and coach never deny
  assert.equal(guardBreach({ mode: 'observe' }, budget), null)
  assert.equal(guardBreach({ mode: 'coach' }, budget), null)
})

test('session token breach wins over turn tool breach', () => {
  let budget = createBudget({ sessionTokens: 100, turnTokens: 50, turnToolCalls: 1 })
  budget = settleUsage(budget, { input: 120, output: 0, cacheRead: 0, cacheWrite: 0 })
  budget = noteToolCall(budget)
  assert.equal(findBreach(budget).dimension, 'sessionTokens')
})

test('settled usage accumulates both scopes and resets per turn', () => {
  let budget = createBudget({ sessionTokens: 0, turnTokens: 0, turnToolCalls: 0 })
  budget = settleUsage(budget, { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 })
  assert.equal(budget.sessionSpent, 18)
  assert.equal(budget.turnSpent, 18)
  budget = startTurn(budget)
  assert.equal(budget.turnSpent, 0)
  assert.equal(budget.sessionSpent, 18)
})

test('setLimit changes one dimension and snapshot is JSON-safe', () => {
  let budget = createBudget({ sessionTokens: 0, turnTokens: 0, turnToolCalls: 0 })
  budget = setLimit(budget, 'sessionTokens', 500)
  const snap = snapshot(budget)
  assert.equal(snap.sessionTokens, 500)
  assert.equal(snap.denied, 0)
  assert.equal(JSON.stringify(snap).includes('limits'), false)
})

test('context pressure ratio needs a window and prefers projected tokens', () => {
  assert.equal(contextPressureRatio(null), null)
  assert.equal(contextPressureRatio({ pressureTokens: 80, contextWindow: 0 }), null)
  assert.equal(contextPressureRatio({ pressureTokens: 80, contextWindow: 100 }), 0.8)
  assert.equal(contextPressureRatio({ pressureTokens: 80, projectedTokens: 90, contextWindow: 100 }), 0.9)
})

test('budget ratios only include configured limits', () => {
  const ratios = budgetPressureRatios({
    limits: { sessionTokens: 100, turnTokens: 0, turnToolCalls: 10 },
    sessionSpent: 85,
    turnSpent: 0,
    turnCalls: 2,
  })
  assert.deepEqual(ratios.map((entry) => entry.dimension), ['sessionTokens', 'turnToolCalls'])
  assert.equal(ratios[0].ratio, 0.85)
})

test('failure streak, context, budget and compaction signals carry evidence only', () => {
  let state = stateAt(4)
  for (let index = 0; index < 3; index += 1) {
    state = fold(state, { type: 'tool/call', data: { turn: 4, step: 1, callId: `c${index}`, name: 'read', arguments: '{}' }, time: 1, seq: 1 })
    state = fold(state, { type: 'tool/result', data: { turn: 4, step: 1, message: { toolCallId: `c${index}`, isError: true, content: [] } }, time: 1, seq: 1 })
  }
  state = fold(state, { type: 'compaction/end', data: { compactionId: 'c', turn: 4 }, time: 1, seq: 1 })
  state = fold(state, { type: 'compaction/end', data: { compactionId: 'd', turn: 4 }, time: 1, seq: 1 })
  const budget = {
    limits: { sessionTokens: 1000, turnTokens: 0, turnToolCalls: 0 },
    sessionSpent: 850,
    turnSpent: 0,
    turnCalls: 0,
    denied: 1,
  }
  const flags = evaluateFlags({
    state,
    turn: 4,
    pressure: { pressureTokens: 850, contextWindow: 1000 },
    budget,
    thresholds,
  })
  const codes = flags.map((flag) => flag.code)
  assert.ok(codes.includes('failure_streak'))
  assert.ok(codes.includes('context_pressure'))
  assert.ok(codes.includes('budget_pressure'))
  assert.ok(codes.includes('compaction_churn'))
  assert.ok(codes.includes('budget_exhausted'))
  for (const flag of flags) {
    assert.equal(typeof flag.code, 'string')
    assert.ok(['info', 'warn', 'high'].includes(flag.severity))
    assert.equal(typeof flag.adviceKey, 'string')
    assert.equal(JSON.stringify(flag).includes('content'), false)
    assert.equal(JSON.stringify(flag).includes('arguments'), false)
  }
  assert.equal(flags[0].severity, 'high')
  assert.equal(primaryAdvice(flags), flags[0].adviceKey)
})

test('no signals on a quiet turn; advice falls back to advice.none', () => {
  let state = stateAt(1)
  state = fold(state, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c', name: 'read', arguments: '{"a":1}' }, time: 1, seq: 1 })
  state = fold(state, { type: 'tool/result', data: { turn: 1, step: 1, message: { toolCallId: 'c', isError: false, content: [{ type: 'text', text: 'ok' }] } }, time: 1, seq: 1 })
  const flags = evaluateFlags({
    state,
    turn: 1,
    pressure: { pressureTokens: 10, contextWindow: 1000 },
    budget: { limits: { sessionTokens: 0, turnTokens: 0, turnToolCalls: 0 }, sessionSpent: 0, turnSpent: 0, turnCalls: 0, denied: 0 },
    thresholds,
  })
  assert.deepEqual(flags, [])
  assert.equal(primaryAdvice(flags), 'advice.none')
})
