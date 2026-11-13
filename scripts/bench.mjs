/**
 * Deterministic micro-benchmarks for the local fold and the receipt store.
 * These numbers answer the non-functional budget in the requirement doc
 * (fold p95 ≤ 2 ms, write p95 ≤ 10 ms); they are not a model benchmark.
 * @module dsh-pressure/scripts/bench
 */

import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createBudget, noteToolCall, settleUsage, snapshot, startTurn } from '../src/budget.js'
import { evaluateFlags, primaryAdvice } from '../src/flags.js'
import { buildReceipt } from '../src/receipt.js'
import { ReceiptStore } from '../src/receipts.js'
import { createState, fold } from '../src/stats.js'

const EVENTS = 10_000
const RECEIPTS = 1_000
const outDir = path.join(process.cwd(), '.tmp', 'bench')
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

/** @param {number[]} samples @param {number} p */
function percentile(samples, p) {
  const sorted = samples.slice().sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

/** @param {number[]} samples */
function summarize(samples) {
  return {
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
    total: samples.reduce((sum, value) => sum + value, 0),
  }
}

/** @param {number} ms */
function ms(value) {
  return `${value.toFixed(3)} ms`
}

/** @param {number} turn @param {number} step */
function toolPair(turn, step) {
  return [
    { type: 'tool/call', data: { turn, step, callId: `c${turn}-${step}`, name: 'read', arguments: `{"path":"src/f${turn}.js"}` }, time: 0, seq: 0 },
    { type: 'tool/result', data: { turn, step, message: { role: 'tool', toolCallId: `c${turn}-${step}`, isError: false, content: [{ type: 'text', text: 'ok' }] } }, time: 0, seq: 0 },
  ]
}

const events = []
let turn = 0
while (events.length < EVENTS) {
  turn += 1
  events.push({ type: 'turn/start', data: { turn }, time: turn * 1000, seq: events.length })
  for (let step = 1; step <= 4 && events.length < EVENTS; step += 1) {
    events.push({ type: 'step/start', data: { turn, step }, time: turn * 1000 + step, seq: events.length })
    for (const event of toolPair(turn, step)) {
      if (events.length >= EVENTS) break
      events.push({ ...event, seq: events.length })
    }
    events.push({ type: 'step/end', data: { turn, step }, time: turn * 1000 + step + 1, seq: events.length })
  }
  events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } }, time: turn * 1000 + 10, seq: events.length })
}

const foldSamples = []
let state = createState('sess_bench')
for (const event of events) {
  const start = performance.now()
  state = fold(state, event)
  foldSamples.push(performance.now() - start)
}
const foldSummary = summarize(foldSamples)

// Receipt path: 1000 writes through the real store.
const thresholds = {
  contextPressure: 0.8,
  budgetPressure: 0.8,
  failureStreak: 2,
  bloatedResultTokens: 8000,
  compactionChurn: 2,
}
const store = new ReceiptStore({
  dataDir: outDir,
  retentionDays: 30,
  maxReceiptsPerSession: 5000,
  maxTotalBytes: 52428800,
  version: '0.1.0',
  locale: () => 'en',
  logger: { warn: () => {} },
})
await store.open()
let budget = startTurn(createBudget({ sessionTokens: 0, turnTokens: 0, turnToolCalls: 0 }))
const writeSamples = []
const writeStart = performance.now()
for (let index = 1; index <= RECEIPTS; index += 1) {
  budget = settleUsage(budget, { input: 900, output: 100, cacheRead: 200, cacheWrite: 20 })
  const flags = evaluateFlags({ state, turn: index, pressure: { pressureTokens: 70000, contextWindow: 128000 }, budget, thresholds })
  const receipt = buildReceipt({
    sessionId: `sess_bench_${index % 10}`,
    turn: index,
    state: { ...state, turn: index, turnStartedAt: Date.now() - 1000 },
    usage: { input: 900, output: 100, cacheRead: 200, cacheWrite: 20 },
    context: { endPressure: 0.55, observedPeak: 0.6, observedFrom: 'live', window: 128000 },
    budget: { ...snapshot(budget), mode: 'observe' },
    flags,
    adviceKey: primaryAdvice(flags),
    partial: false,
    asOfSeq: events.length,
    version: '0.1.0',
    now: Date.now(),
  })
  const start = performance.now()
  await store.appendReceipt(receipt)
  writeSamples.push(performance.now() - start)
}
const writeSummary = summarize(writeSamples)
const writeTotal = performance.now() - writeStart
const stats = store.stats()
await store.close()

const rows = [
  ['Metric', 'Target', 'Result'],
  ['fold p95', '≤ 2 ms', ms(foldSummary.p95)],
  ['fold p50', '—', ms(foldSummary.p50)],
  ['fold total (10k)', '—', ms(foldSummary.total)],
  ['write p95', '≤ 10 ms', ms(writeSummary.p95)],
  ['write p50', '—', ms(writeSummary.p50)],
  ['write total (1k)', '—', ms(writeTotal)],
  ['store bytes', '—', String(stats.bytes)],
]
const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
for (const row of rows) {
  console.log(row.map((cell, column) => cell.padEnd(widths[column])).join('  '))
}
console.log('')
console.log(JSON.stringify({ fold: foldSummary, write: writeSummary, events: events.length, receipts: RECEIPTS, store: stats }, null, 2))
