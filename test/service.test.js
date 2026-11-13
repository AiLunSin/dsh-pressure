import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import { ReceiptStore } from '../src/receipts.js'
import { createNoticeMessage, PressureService } from '../src/service.js'

const SESSION_ID = 'sess_service'

/**
 * @param {{ mode?: string, budget?: any, thresholds?: any, coach?: any, withServices?: boolean }} [options]
 */
async function createHarness(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pressure-service-'))
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
  /** @type {Array<(exec: any) => any>} */
  const guards = []
  const session = { id: SESSION_ID }
  const agent = { id: SESSION_ID, session }
  const usage = { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 }
  const pressure = { pressureTokens: 100, contextWindow: 1000 }
  const withServices = options.withServices !== false
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    tools: { guard: (fn) => { guards.push(fn); return () => {} } },
    agents: { list: () => [] },
    get(name) {
      if (!withServices) return undefined
      if (name === 'tokenMeter') return { contextPressure: () => pressure }
      if (name === 'sessionProjections') {
        return {
          snapshot(_session, keys) {
            const values = {}
            if (keys.includes('tokenUsage')) values.tokenUsage = { ...usage }
            if (keys.includes('sessionStats')) values.sessionStats = { turns: 1, steps: 1, llmMs: 10, toolMs: 5, ttftMs: 3, ttftSteps: 1, decodeMs: 2, decodeTokens: 50 }
            return { asOfSeq: 99, values }
          },
        }
      }
      return undefined
    },
    on() {
      return () => {}
    },
  }
  const config = resolveConfig({
    mode: options.mode ?? 'observe',
    budget: options.budget,
    thresholds: options.thresholds,
    coach: options.coach,
  })
  const service = new PressureService({ ctx, config, store, locale: 'en', version: '0.1.0' })
  service.install()
  service.bindAgent(agent)
  const binding = service.bindingOf(SESSION_ID)
  assert.ok(binding)

  /** @param {string} type @param {any} data @param {number} [time] */
  function emit(type, data, time = 1_700_000_000_000) {
    service.onSessionEvent(session, { type, data, time, seq: 1 })
  }

  return {
    service,
    store,
    session,
    agent,
    guards,
    binding,
    usage,
    pressure,
    emit,
    async close() {
      service.dispose()
      await store.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

test('turn flow writes one receipt with official token delta', async () => {
  const harness = await createHarness()
  try {
    harness.emit('turn/start', { turn: 1 }, 1_700_000_000_000)
    harness.emit('step/start', { turn: 1, step: 1 }, 1_700_000_001_000)
    harness.emit('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' }, 1_700_000_002_000)
    harness.emit('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', isError: true, content: [] } }, 1_700_000_003_000)
    harness.emit('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{"path":"b"}' }, 1_700_000_004_000)
    harness.emit('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c2', isError: true, content: [] } }, 1_700_000_005_000)
    harness.usage.uncachedInputTokens = 400
    harness.usage.outputTokens = 90
    harness.usage.cacheReadTokens = 60
    harness.usage.cacheWriteTokens = 15
    harness.emit('step/end', { turn: 1, step: 1 }, 1_700_000_006_000)
    harness.emit('turn/end', { turn: 1, reason: { kind: 'completed' } }, 1_700_000_006_500)
    await flush()

    const receipts = await harness.store.readSession(SESSION_ID)
    assert.equal(receipts.length, 1)
    const receipt = receipts[0]
    assert.equal(receipt.turn, 1)
    assert.equal(receipt.tokens.input, 300)
    assert.equal(receipt.tokens.output, 40)
    assert.equal(receipt.tokens.cacheRead, 50)
    assert.equal(receipt.tokens.cacheWrite, 10)
    assert.equal(receipt.tokens.total, 400)
    assert.equal(receipt.tools.calls, 2)
    assert.equal(receipt.tools.failures, 2)
    assert.ok(receipt.flags.some((flag) => flag.code === 'failure_streak'))
    assert.equal(receipt.context.observedFrom, 'live')
    assert.equal(receipt.context.observedPeak, 0.1)
    assert.equal(receipt.partial, false)
    assert.equal(receipt.source.asOfSeq, 99)
    assert.doesNotThrow(() => JSON.stringify(receipt))
  } finally {
    await harness.close()
  }
})

test('a duplicate turn/end does not double-settle the budget', async () => {
  const harness = await createHarness()
  try {
    harness.emit('turn/start', { turn: 1 })
    harness.usage.uncachedInputTokens = 300
    harness.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    harness.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flush()
    const receipts = await harness.store.readSession(SESSION_ID)
    assert.equal(receipts.length, 1)
    assert.equal(harness.binding.budget.sessionSpent, 200)
  } finally {
    await harness.close()
  }
})

test('enforce denies the call after the limit and records the breach', async () => {
  const harness = await createHarness({ mode: 'enforce', budget: { turnToolCalls: 2 } })
  try {
    harness.emit('turn/start', { turn: 1 })
    const exec = { agent: harness.agent, name: 'read', callId: 'c' }
    assert.equal(harness.service.checkGuard(exec), undefined)
    assert.equal(harness.service.checkGuard(exec), undefined)
    const denial = harness.service.checkGuard(exec)
    assert.equal(typeof denial.reason, 'string')
    assert.match(denial.reason, /turn tool-call budget is reached \(2 \/ 2\)/u)
    assert.match(denial.reason, /final answer/u)
    assert.equal(denial.info.code, 'budget_exhausted')
    assert.equal(harness.binding.budget.denied, 1)
    assert.equal(harness.binding.budget.turnCalls, 2)
  } finally {
    await harness.close()
  }
})

test('observe mode never denies even when over budget', async () => {
  const harness = await createHarness({ mode: 'observe', budget: { turnToolCalls: 1 } })
  try {
    harness.emit('turn/start', { turn: 1 })
    const exec = { agent: harness.agent }
    assert.equal(harness.service.checkGuard(exec), undefined)
    assert.equal(harness.service.checkGuard(exec), undefined)
    assert.equal(harness.binding.budget.denied, 0)
  } finally {
    await harness.close()
  }
})

test('coach adds one notice per code per turn and respects mute', async () => {
  const harness = await createHarness({ mode: 'coach' })
  try {
    harness.emit('turn/start', { turn: 1 })
    harness.emit('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' })
    harness.emit('tool/result', { turn: 1, step: 1, message: { toolCallId: 'c1', isError: true, content: [] } })
    const exec = { agent: harness.agent, name: 'read' }
    const next = async () => ({ kind: 'accept' })
    const first = await harness.service.postExecute(exec, { isError: true, content: [] }, next)
    assert.equal(first.additionalContexts.length, 1)
    assert.equal(first.additionalContexts[0].role, 'user')
    assert.equal(first.additionalContexts[0].source.kind, 'dsh-pressure')
    assert.match(first.additionalContexts[0].content[0].text, /failed in a row/u)

    const second = await harness.service.postExecute(exec, { isError: true, content: [] }, next)
    assert.equal(second.additionalContexts, undefined)

    harness.service.mute(SESSION_ID, 'failure_streak', true)
    harness.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    harness.emit('turn/start', { turn: 2 })
    harness.emit('tool/call', { turn: 2, step: 1, callId: 'c2', name: 'read', arguments: '{}' })
    harness.emit('tool/result', { turn: 2, step: 1, message: { toolCallId: 'c2', isError: true, content: [] } })
    const muted = await harness.service.postExecute(exec, { isError: true, content: [] }, next)
    assert.equal(muted.additionalContexts, undefined)
  } finally {
    await harness.close()
  }
})

test('coach maxPerTurn caps notices even across codes', async () => {
  const harness = await createHarness({ mode: 'coach', coach: { maxPerTurn: 1 }, thresholds: { bloatedResultTokens: 500 } })
  try {
    harness.emit('turn/start', { turn: 1 })
    const exec = { agent: harness.agent, name: 'read' }
    const next = async () => ({ kind: 'accept' })
    const first = await harness.service.postExecute(exec, { isError: true, content: [{ type: 'text', text: 'x'.repeat(4000) }] }, next)
    assert.equal(first.additionalContexts.length, 1)
    const second = await harness.service.postExecute(exec, { isError: false, content: [{ type: 'text', text: 'x'.repeat(4000) }] }, next)
    assert.equal(second.additionalContexts, undefined)
  } finally {
    await harness.close()
  }
})

test('missing optional services degrade instead of failing', async () => {
  const harness = await createHarness({ withServices: false })
  try {
    harness.emit('turn/start', { turn: 1 })
    harness.emit('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' })
    harness.emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await flush()
    const receipts = await harness.store.readSession(SESSION_ID)
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].tokens.total, null)
    assert.equal(receipts[0].context.observedFrom, 'unavailable')
    assert.equal(receipts[0].partial, true)
    const live = harness.service.liveView(SESSION_ID)
    assert.equal(live.tokens, null)
    assert.equal(live.context.pressure, null)
    assert.equal(live.flags.length, 0)
  } finally {
    await harness.close()
  }
})

test('notice messages are frozen standard user messages', () => {
  const notice = createNoticeMessage('Pressure check: test')
  assert.equal(notice.role, 'user')
  assert.equal(typeof notice.id, 'string')
  assert.ok(notice.id.length > 0)
  assert.equal(Object.isFrozen(notice), true)
  assert.equal(notice.source.kind, 'dsh-pressure')
  assert.equal(notice.source.form, 'notice')
  assert.ok(notice.source.summary.length <= 120)
})
