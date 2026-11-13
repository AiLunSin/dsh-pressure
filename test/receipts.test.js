import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertReceiptSafe, buildReceipt } from '../src/receipt.js'
import { ReceiptStore } from '../src/receipts.js'
import { createState } from '../src/stats.js'

const BASE = Date.now() - 60 * 60 * 1000

/** @param {number} turn @param {string} [sessionId] @param {Record<string, any>} [overrides] */
function makeReceipt(turn, sessionId = 'sess_store', overrides = {}) {
  const state = createState(sessionId)
  state.turn = turn
  state.turnStartedAt = BASE + turn * 1000
  state.turnTools = { total: 3, failed: 1, repeats: 1, consecutiveFailures: 0, maxConsecutiveFailures: 2 }
  state.tools.maxResultEstTokens = 1200
  state.turnCompactions = 1
  return buildReceipt({
    sessionId,
    turn,
    state,
    usage: { input: 1000, output: 200, cacheRead: 500, cacheWrite: 100 },
    context: { endPressure: 0.5, observedPeak: 0.55, observedFrom: 'live', window: 100000 },
    budget: { mode: 'observe', sessionTokens: 0, sessionSpent: 1800, overBudget: 0, denied: 0 },
    flags: [{ code: 'failure_streak', severity: 'warn', count: 2, turn, adviceKey: 'advice.inspectLastError', evidence: { consecutiveFailures: 2 } }],
    adviceKey: 'advice.inspectLastError',
    partial: false,
    asOfSeq: 42,
    version: '0.1.0',
    now: BASE + turn * 1000 + 500,
    ...overrides,
  })
}

/** @param {() => Promise<void>} body */
async function withStore(body, overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pressure-store-'))
  const store = new ReceiptStore({
    dataDir: dir,
    retentionDays: 30,
    maxReceiptsPerSession: 2000,
    maxTotalBytes: 52428800,
    version: '0.1.0',
    locale: () => 'en',
    logger: { warn: () => {} },
    ...overrides,
  })
  await store.open()
  try {
    await body(store, dir)
  } finally {
    await store.close()
    await rm(dir, { recursive: true, force: true })
  }
}

test('append then read keeps one visible receipt per turn', async () => {
  await withStore(async (store) => {
    const receipt = makeReceipt(1)
    assert.deepEqual(await store.appendReceipt(receipt), { written: true })
    const again = await store.appendReceipt(makeReceipt(1))
    assert.equal(again.written, false)
    assert.equal(again.reason, 'idempotent')
    const all = await store.readSession('sess_store')
    assert.equal(all.length, 1)
    assert.equal(all[0].turn, 1)
    assert.equal(all[0].tokens.total, 1800)
    assert.equal(store.receiptCount('sess_store'), 1)
  })
})

test('a later updatedAt replaces the visible receipt for the same turn', async () => {
  await withStore(async (store) => {
    await store.appendReceipt(makeReceipt(1))
    const updated = makeReceipt(1, 'sess_store', {
      adviceKey: 'advice.changeApproach',
      now: BASE + 200_000,
    })
    const result = await store.appendReceipt(updated)
    assert.equal(result.written, true)
    const all = await store.readSession('sess_store')
    assert.equal(all.length, 1)
    assert.equal(all[0].adviceKey, 'advice.changeApproach')
  })
})

test('malformed lines are skipped and counted on reopen', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pressure-store-'))
  try {
    const options = {
      dataDir: dir,
      retentionDays: 30,
      maxReceiptsPerSession: 2000,
      maxTotalBytes: 52428800,
      version: '0.1.0',
      locale: () => 'en',
      logger: { warn: () => {} },
    }
    const first = new ReceiptStore(options)
    await first.open()
    await first.appendReceipt(makeReceipt(1))
    await first.close()
    const file = path.join(dir, 'receipts', `${(await import('../src/util.js')).hashSessionId('sess_store')}.jsonl`)
    const original = await readFile(file, 'utf8')
    await writeFile(file, `${original}not json at all\n`, 'utf8')

    const second = new ReceiptStore(options)
    await second.open()
    assert.ok(second.stats().badLines >= 1)
    const all = await second.readSession('sess_store')
    assert.equal(all.length, 1)
    await second.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('retention keeps the newest receipts per session', async () => {
  await withStore(async (store) => {
    for (const turn of [1, 2, 3]) await store.appendReceipt(makeReceipt(turn))
    assert.equal(store.receiptCount('sess_store'), 3)
    await store.prune()
    const all = await store.readSession('sess_store')
    assert.deepEqual(all.map((receipt) => receipt.turn), [2, 3])
  }, { maxReceiptsPerSession: 2 })
})

test('total-byte cap drops the oldest session rather than corrupting files', async () => {
  await withStore(async (store) => {
    await store.appendReceipt(makeReceipt(1, 'sess_old', { now: BASE + 1000 }))
    await store.appendReceipt(makeReceipt(1, 'sess_new', { now: BASE + 9000 }))
    assert.equal(store.stats().sessions, 2)
    const before = store.stats().bytes
    store.maxTotalBytes = Math.floor(before * 0.6)
    await store.prune()
    const sessions = store.listSessions(10)
    assert.deepEqual(sessions.map((entry) => entry.sessionId), ['sess_new'])
    assert.ok(store.stats().bytes <= store.maxTotalBytes)
  })
})

test('purge removes only the requested session', async () => {
  await withStore(async (store) => {
    await store.appendReceipt(makeReceipt(1, 'sess_a'))
    await store.appendReceipt(makeReceipt(1, 'sess_b'))
    const removed = await store.purgeSession('sess_a')
    assert.equal(removed, 1)
    const sessions = store.listSessions(10)
    assert.deepEqual(sessions.map((entry) => entry.sessionId), ['sess_b'])
    assert.equal(await store.purgeSession('sess_missing'), 0)
  })
})

test('exports render Markdown, JSON, and CSV without body fields', async () => {
  await withStore(async (store) => {
    await store.appendReceipt(makeReceipt(1))
    await store.appendReceipt(makeReceipt(2))
    const md = await store.exportSession('sess_store', 'md')
    const json = await store.exportSession('sess_store', 'json')
    const csv = await store.exportSession('sess_store', 'csv')
    assert.match(md.filename, /^pressure-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.md$/u)
    assert.match(md.body, /Cache hit rate/u)
    assert.equal(md.body.includes('"arguments"'), false)
    assert.equal(md.body.includes('toolOutput'), false)
    const parsed = JSON.parse(json.body)
    assert.equal(parsed.length, 2)
    for (const receipt of parsed) assertReceiptSafe(receipt)
    assert.equal(csv.body.split('\n')[0].split(',').length, 26)
    assert.match(csv.body, /failure_streak/u)
    assert.equal(json.body.includes('"prompt"'), false)
  })
})

test('oversized receipts are refused', async () => {
  await withStore(async (store) => {
    const flags = Array.from({ length: 900 }, (_, index) => ({
      code: `signal_${index}_${'x'.repeat(20)}`,
      severity: 'info',
      count: index,
      turn: 1,
      adviceKey: 'advice.none',
      evidence: { index },
    }))
    const result = await store.appendReceipt(makeReceipt(1, 'sess_store', { flags }))
    assert.equal(result.written, false)
    assert.equal(result.reason, 'too-large')
  })
})

test('privacy guard rejects forbidden fields at any depth', () => {
  assert.doesNotThrow(() => assertReceiptSafe({ tokens: { total: 1 }, flags: [] }))
  assert.throws(() => assertReceiptSafe({ nested: { toolOutput: 'secret' } }), /forbidden field/u)
  assert.throws(() => assertReceiptSafe({ prompt: 'hello' }), /forbidden field/u)
})
