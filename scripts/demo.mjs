/**
 * No-model demo: synthesize a session, fold it, build two receipts, store them,
 * and render Markdown/JSON/CSV. Everything is offline and deterministic, so the
 * README's first run needs no API key.
 * @module dsh-pressure/scripts/demo
 */

import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createBudget, noteToolCall, settleUsage, snapshot, startTurn } from '../src/budget.js'
import { evaluateFlags, primaryAdvice } from '../src/flags.js'
import { buildReceipt } from '../src/receipt.js'
import { ReceiptStore } from '../src/receipts.js'
import { createState, fold } from '../src/stats.js'

const outDir = path.join(process.cwd(), '.tmp', 'demo')
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const config = {
  thresholds: {
    contextPressure: 0.8,
    budgetPressure: 0.8,
    failureStreak: 2,
    bloatedResultTokens: 8000,
    compactionChurn: 2,
  },
  budget: { sessionTokens: 20000, turnTokens: 0, turnToolCalls: 8 },
}

const store = new ReceiptStore({
  dataDir: outDir,
  retentionDays: 30,
  maxReceiptsPerSession: 2000,
  maxTotalBytes: 52428800,
  version: '0.1.0',
  locale: () => 'en',
  logger: { warn: (message) => console.warn(message) },
})
await store.open()

const sessionId = 'sess_demo_pressure'
const state = createState(sessionId)
const budget = createBudget(config.budget)
let clock = Date.parse('2026-11-13T10:00:00.000Z')

/** @type {Array<any>} */
const events = []
const append = (type, data) => {
  const event = { type, data, time: clock, seq: events.length }
  events.push(event)
  return event
}

/**
 * @param {number} turn
 * @param {any} receipt
 */
async function save(turn, receipt) {
  const result = await store.appendReceipt(receipt)
  console.log(`turn ${turn}: ${result.written ? 'receipt written' : `skipped (${result.reason})`} · flags=${receipt.flags.map((flag) => flag.code).join(',') || 'none'}`)
}

/**
 * @param {{ state: any, budget: any, usage: any, pressure: any, turn: number, endedAt: number }} input
 */
function makeReceipt(input) {
  const flags = evaluateFlags({
    state: input.state,
    turn: input.turn,
    pressure: input.pressure,
    budget: input.budget,
    thresholds: config.thresholds,
  })
  return buildReceipt({
    sessionId,
    turn: input.turn,
    state: input.state,
    usage: input.usage,
    context: {
      endPressure: input.pressure.pressureTokens / input.pressure.contextWindow,
      observedPeak: input.pressure.pressureTokens / input.pressure.contextWindow,
      observedFrom: 'live',
      window: input.pressure.contextWindow,
    },
    budget: { ...snapshot(input.budget), mode: 'coach' },
    flags,
    adviceKey: primaryAdvice(flags),
    partial: false,
    asOfSeq: events.length,
    version: '0.1.0',
    now: input.endedAt,
  })
}

// Turn 1: a healthy read-test loop.
let current = startTurn(budget)
let stats = fold(state, append('turn/start', { turn: 1 }))
stats = fold(stats, append('step/start', { turn: 1, step: 1 }))
stats = fold(stats, append('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"src/a.js"}' }))
current = noteToolCall(current)
clock += 420
stats = fold(stats, append('tool/result', {
  turn: 1,
  step: 1,
  message: { role: 'tool', toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'line '.repeat(400) }] },
}))
stats = fold(stats, append('step/end', { turn: 1, step: 1 }))
clock += 400
stats = fold(stats, append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
current = settleUsage(current, { input: 1800, output: 420, cacheRead: 900, cacheWrite: 120 })
await save(1, makeReceipt({
  state: stats,
  budget: current,
  usage: { input: 1800, output: 420, cacheRead: 900, cacheWrite: 120 },
  pressure: { pressureTokens: 42000, contextWindow: 128000 },
  turn: 1,
  endedAt: clock,
}))

// Turn 2: repeated failures, a bloated result, one compaction.
clock = Date.parse('2026-11-13T10:00:03.000Z')
current = startTurn(current)
stats = fold(stats, append('turn/start', { turn: 2 }))
stats = fold(stats, append('step/start', { turn: 2, step: 1 }))
for (let index = 1; index <= 3; index += 1) {
  stats = fold(stats, append('tool/call', {
    turn: 2,
    step: 1,
    callId: `f${index}`,
    name: 'pwsh',
    arguments: '{"command":"npm test"}',
  }))
  current = noteToolCall(current)
  clock += 700
  stats = fold(stats, append('tool/result', {
    turn: 2,
    step: 1,
    message: { role: 'tool', toolCallId: `f${index}`, isError: true, content: [{ type: 'text', text: 'window is not defined' }] },
    error: { name: 'CommandError', code: 'EXIT_1' },
  }))
}
stats = fold(stats, append('tool/call', { turn: 2, step: 1, callId: 'big', name: 'read', arguments: '{"path":"dist/bundle.js"}' }))
current = noteToolCall(current)
clock += 900
stats = fold(stats, append('tool/result', {
  turn: 2,
  step: 1,
  message: { role: 'tool', toolCallId: 'big', isError: false, content: [{ type: 'text', text: 'x'.repeat(40000) }] },
}))
stats = fold(stats, append('compaction/end', { compactionId: 'comp_1', turn: 2 }))
stats = fold(stats, append('step/end', { turn: 2, step: 1 }))
clock += 300
stats = fold(stats, append('turn/end', { turn: 2, reason: { kind: 'completed' } }))
current = settleUsage(current, { input: 7200, output: 900, cacheRead: 3000, cacheWrite: 260 })
await save(2, makeReceipt({
  state: stats,
  budget: current,
  usage: { input: 7200, output: 900, cacheRead: 3000, cacheWrite: 260 },
  pressure: { pressureTokens: 108800, contextWindow: 128000 },
  turn: 2,
  endedAt: clock,
}))

const markdown = await store.exportSession(sessionId, 'md')
const csv = await store.exportSession(sessionId, 'csv')
const json = await store.exportSession(sessionId, 'json')
await store.close()

console.log('')
console.log(markdown?.body ?? 'no markdown')
console.log(`files: ${outDir}`)
console.log(`receipt shards: ${(await readdir(path.join(outDir, 'receipts'))).join(', ')}`)
console.log(`csv columns: ${csv?.body.split('\n')[0].split(',').length}`)
console.log(`json receipts: ${JSON.parse(json?.body ?? '[]').length}`)
