import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createBudget, noteToolCall, settleUsage, snapshot, startTurn } from '../src/budget.js'
import { evaluateFlags, primaryAdvice } from '../src/flags.js'
import { assertReceiptSafe, buildReceipt } from '../src/receipt.js'
import { ReceiptStore } from '../src/receipts.js'
import { createState, fold } from '../src/stats.js'

test('synthetic session -> fold -> receipt -> store -> export end to end', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pressure-smoke-'))
  const store = new ReceiptStore({
    dataDir: dir,
    retentionDays: 30,
    maxReceiptsPerSession: 2000,
    maxTotalBytes: 52428800,
    version: '0.1.0',
    locale: () => 'en',
    logger: { warn: () => {} },
  })
  await store.open()
  try {
    const sessionId = 'sess_smoke'
    const thresholds = {
      contextPressure: 0.8,
      budgetPressure: 0.8,
      failureStreak: 2,
      bloatedResultTokens: 8000,
      compactionChurn: 2,
    }
    let state = createState(sessionId)
    let budget = startTurn(createBudget({ sessionTokens: 10000, turnTokens: 0, turnToolCalls: 4 }))
    const events = []
    let time = Date.now() - 60 * 60 * 1000
    /** @param {string} type @param {any} data */
    const emit = (type, data) => {
      const event = { type, data, time, seq: events.length }
      events.push(event)
      state = fold(state, event)
      return event
    }

    emit('turn/start', { turn: 1 })
    emit('step/start', { turn: 1, step: 1 })
    emit('tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{"path":"x"}' })
    budget = noteToolCall(budget)
    time += 100
    emit('tool/result', { turn: 1, step: 1, message: { toolCallId: 'a', isError: false, content: [{ type: 'text', text: 'ok' }] } })
    emit('tool/call', { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{"path":"x"}' })
    budget = noteToolCall(budget)
    time += 100
    emit('tool/result', { turn: 1, step: 1, message: { toolCallId: 'b', isError: false, content: [{ type: 'text', text: 'ok' }] } })
    emit('step/end', { turn: 1, step: 1 })
    emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    budget = settleUsage(budget, { input: 1000, output: 100, cacheRead: 200, cacheWrite: 50 })

    const flags = evaluateFlags({
      state,
      turn: 1,
      pressure: { pressureTokens: 900, contextWindow: 1000 },
      budget,
      thresholds,
    })
    const receipt = buildReceipt({
      sessionId,
      turn: 1,
      state,
      usage: { input: 1000, output: 100, cacheRead: 200, cacheWrite: 50 },
      context: { endPressure: 0.9, observedPeak: 0.9, observedFrom: 'live', window: 1000 },
      budget: { ...snapshot(budget), mode: 'coach' },
      flags,
      adviceKey: primaryAdvice(flags),
      partial: false,
      asOfSeq: events.length,
      version: '0.1.0',
      now: time,
    })
    assert.doesNotThrow(() => assertReceiptSafe(receipt))
    assert.ok(receipt.flags.some((flag) => flag.code === 'repeat_calls'))
    assert.ok(receipt.flags.some((flag) => flag.code === 'context_pressure'))
    assert.equal(receipt.tools.repeats, 1)

    const first = await store.appendReceipt(receipt)
    const second = await store.appendReceipt(receipt)
    assert.equal(first.written, true)
    assert.equal(second.reason, 'idempotent')

    const markdown = await store.exportSession(sessionId, 'md')
    const json = await store.exportSession(sessionId, 'json')
    const csv = await store.exportSession(sessionId, 'csv')
    assert.match(markdown.body, /Turn 1/u)
    assert.match(markdown.body, /context_pressure/u)
    assert.equal(markdown.body.includes('"arguments"'), false)
    assert.equal(JSON.parse(json.body).length, 1)
    assert.match(csv.body, /sess_smoke,1,/u)

    const file = path.join(dir, 'receipts')
    const { readdir } = await import('node:fs/promises')
    const shards = await readdir(file)
    assert.equal(shards.length, 1)
    const raw = await readFile(path.join(file, shards[0]), 'utf8')
    assert.equal(raw.includes('"arguments"'), false)
    assert.equal(raw.includes('"prompt"'), false)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
})
