import assert from 'node:assert/strict'
import test from 'node:test'
import { createState, fold, MAX_SIGNATURES, repeatCount } from '../src/stats.js'

/** @param {string} type @param {any} data @param {number} [time] */
function event(type, data, time = 1000) {
  return { type, data, time, seq: 1 }
}

test('fold counts turn, step, tool calls and failures', () => {
  let state = createState('sess_1')
  state = fold(state, event('turn/start', { turn: 1 }))
  state = fold(state, event('step/start', { turn: 1, step: 1 }))
  state = fold(state, event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' }))
  state = fold(state, event('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{"path":"b"}' }))
  state = fold(state, event('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'ok' }] } }, 1200))
  state = fold(state, event('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c2', isError: true, content: [] }, error: { name: 'E', code: 'X' } }, 1400))

  assert.equal(state.turn, 1)
  assert.equal(state.step, 1)
  assert.equal(state.turnTools.total, 2)
  assert.equal(state.turnTools.failed, 1)
  assert.equal(state.turnTools.consecutiveFailures, 1)
  assert.equal(state.turnTools.maxConsecutiveFailures, 1)
  assert.equal(state.tools.failed, 1)
  assert.equal(state.tools.byName.read.calls, 2)
  assert.equal(state.tools.byName.read.failures, 1)
  assert.equal(state.tools.byName.read.maxDurationMs, 400)
  assert.equal(state.turnStartedAt, 1000)
})

test('consecutive failures reset on success and peak is kept', () => {
  let state = createState()
  state = fold(state, event('turn/start', { turn: 2 }))
  for (const [index, failed] of [[1, true], [2, true], [3, true], [4, false]]) {
    state = fold(state, event('tool/call', { turn: 2, step: 1, callId: `c${index}`, name: 'pwsh', arguments: '{}' }))
    state = fold(state, event('tool/result', { turn: 2, step: 1, message: { toolCallId: `c${index}`, isError: failed, content: [] } }))
  }
  assert.equal(state.turnTools.consecutiveFailures, 0)
  assert.equal(state.turnTools.maxConsecutiveFailures, 3)
  assert.equal(state.turnTools.failed, 3)
})

test('identical consecutive arguments count as repeats without keeping text', () => {
  let state = createState()
  state = fold(state, event('turn/start', { turn: 1 }))
  for (let index = 0; index < 3; index += 1) {
    state = fold(state, event('tool/call', { turn: 1, step: 1, callId: `c${index}`, name: 'read', arguments: '{"b":2,"a":1}' }))
  }
  assert.equal(state.signatures[0].n, 3)
  assert.equal(repeatCount(state), 2)
  assert.equal(state.signatures[0].h.length, 64)
  assert.equal(JSON.stringify(state).includes('"a":1'), false)
})

test('unrelated events return the same reference', () => {
  const state = createState()
  const folded = fold(state, event('assistant/message', { turn: 1, step: 1 }))
  assert.equal(folded, state)
  assert.equal(fold(state, event('compaction/start', { compactionId: 'c', turn: 1 })), state)
})

test('compaction counts only on end', () => {
  let state = createState()
  state = fold(state, event('turn/start', { turn: 1 }))
  state = fold(state, event('compaction/start', { compactionId: 'c1', turn: 1 }))
  assert.equal(state.turnCompactions, 0)
  state = fold(state, event('compaction/end', { compactionId: 'c1', turn: 1 }))
  assert.equal(state.turnCompactions, 1)
  assert.equal(state.compactions, 1)
})

test('state tables are bounded', () => {
  let state = createState()
  state = fold(state, event('turn/start', { turn: 1 }))
  for (let index = 0; index < 100; index += 1) {
    state = fold(state, event('tool/call', { turn: 1, step: 1, callId: `c${index}`, name: `tool_${index}`, arguments: `{"i":${index}}` }))
  }
  assert.ok(Object.keys(state.tools.byName).length <= 32)
  assert.ok(state.signatures.length <= MAX_SIGNATURES)
  assert.ok(Object.keys(state.pending).length <= 64)
})

test('turn/end freezes lastTurn and keeps the current turn counters for the receipt', () => {
  let state = createState()
  state = fold(state, event('turn/start', { turn: 3 }))
  state = fold(state, event('tool/call', { turn: 3, step: 1, callId: 'c1', name: 'read', arguments: '{}' }))
  state = fold(state, event('turn/end', { turn: 3, reason: { kind: 'completed' } }, 5000))
  assert.equal(state.lastTurn.turn, 3)
  assert.equal(state.lastTurn.tools.total, 1)
  assert.equal(state.lastTurn.endedAt, 5000)
  assert.equal(state.turnTools.total, 1)
})

test('turn/start resets per-turn counters and signatures', () => {
  let state = createState()
  state = fold(state, event('turn/start', { turn: 1 }))
  state = fold(state, event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' }))
  state = fold(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  state = fold(state, event('turn/start', { turn: 2 }, 9000))
  assert.equal(state.turn, 2)
  assert.equal(state.turnTools.total, 0)
  assert.equal(state.signatures.length, 0)
  assert.equal(state.tools.total, 1)
  assert.equal(state.turnStartedAt, 9000)
})
