import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveConfig } from '../src/config.js'
import { createNodeHandler, API_PREFIX } from '../src/http.js'
import { ReceiptStore } from '../src/receipts.js'
import { PressureService } from '../src/service.js'

/** @returns {any} */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    destroyed: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(body) {
      this.body = body === undefined ? '' : String(body)
    },
    destroy() {
      this.destroyed = true
    },
  }
}

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pressure-http-'))
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
  const sessionId = 'sess_http'
  const session = { id: sessionId }
  const agent = { id: sessionId, session }
  const ctx = {
    logger: { warn: () => {}, info: () => {} },
    tools: { guard: () => () => {} },
    agents: { list: () => [] },
    get(name) {
      if (name === 'tokenMeter') return { contextPressure: () => ({ pressureTokens: 50, contextWindow: 100 }) }
      if (name === 'sessionProjections') {
        return {
          snapshot: () => ({
            asOfSeq: 7,
            values: {
              tokenUsage: { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0 },
              sessionStats: { turns: 1, steps: 1, llmMs: 1, toolMs: 1, ttftMs: 1, ttftSteps: 1, decodeMs: 1, decodeTokens: 2 },
            },
          }),
        }
      }
      return undefined
    },
    on: () => () => {},
  }
  const config = resolveConfig({ mode: 'observe' })
  const service = new PressureService({ ctx, config, store, locale: 'en', version: '0.1.0' })
  service.install()
  service.bindAgent(agent)
  service.onSessionEvent(session, { type: 'turn/start', data: { turn: 1 }, time: 1_700_000_000_000, seq: 1 })
  service.onSessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } }, time: 1_700_000_001_000, seq: 2 })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const handler = createNodeHandler({ service, store, config, version: '0.1.0', dataDir: dir })
  return { dir, store, service, handler, sessionId }
}

/**
 * @param {any} handler
 * @param {string} url
 * @param {string} [method]
 */
async function call(handler, url, method = 'GET') {
  const res = fakeResponse()
  await handler({ method, url }, res)
  let json = null
  if (typeof res.headers['content-type'] === 'string' && res.headers['content-type'].includes('application/json') && res.body.length > 0) {
    json = JSON.parse(res.body)
  }
  return { res, json }
}

test('health and sessions are read-only and report storage', async () => {
  const fixture = await setup()
  try {
    const health = await call(fixture.handler, `${API_PREFIX}/health`)
    assert.equal(health.res.statusCode, 200)
    assert.equal(health.json.ok, true)
    assert.equal(health.json.data.storage.ok, true)
    assert.equal(health.json.data.services.tokenMeter, true)
    assert.equal(health.res.headers['cache-control'], 'no-store')

    const sessions = await call(fixture.handler, `${API_PREFIX}/sessions?limit=5`)
    assert.equal(sessions.res.statusCode, 200)
    assert.equal(sessions.json.data.sessions[0].sessionId, fixture.sessionId)
  } finally {
    await fixture.service.dispose()
    await fixture.store.close()
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

test('live, receipts, receipt detail, and 404s', async () => {
  const fixture = await setup()
  try {
    const live = await call(fixture.handler, `${API_PREFIX}/live?sessionId=${fixture.sessionId}`)
    assert.equal(live.json.data.live, true)
    assert.equal(live.json.data.mode, 'observe')
    assert.equal(live.json.data.tools.calls, 0)

    // A root-scoped panel has no session id; the latest live binding is offered.
    const latest = await call(fixture.handler, `${API_PREFIX}/live`)
    assert.equal(latest.res.statusCode, 200)
    assert.equal(latest.json.data.live, true)
    assert.equal(latest.json.data.sessionId, fixture.sessionId)

    const missing = await call(fixture.handler, `${API_PREFIX}/live?sessionId=sess_missing`)
    assert.equal(missing.res.statusCode, 404)
    assert.equal(missing.json.code, 'pressure/session-not-found')

    const list = await call(fixture.handler, `${API_PREFIX}/receipts?sessionId=${fixture.sessionId}`)
    assert.equal(list.res.statusCode, 200)
    assert.equal(list.json.data.receipts.length, 1)
    assert.equal(list.json.data.receipts[0].turn, 1)

    const detail = await call(fixture.handler, `${API_PREFIX}/receipt?sessionId=${fixture.sessionId}&turn=1`)
    assert.equal(detail.res.statusCode, 200)
    assert.equal(detail.json.data.receipt.turn, 1)
    assert.equal(JSON.stringify(detail.json).includes('"arguments"'), false)

    const missingReceipt = await call(fixture.handler, `${API_PREFIX}/receipt?sessionId=${fixture.sessionId}&turn=9`)
    assert.equal(missingReceipt.res.statusCode, 404)
    assert.equal(missingReceipt.json.code, 'pressure/receipt-not-found')
  } finally {
    await fixture.service.dispose()
    await fixture.store.close()
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

test('export returns an attachment for md, json, and csv', async () => {
  const fixture = await setup()
  try {
    for (const [format, contentType] of [['md', 'text/markdown'], ['json', 'application/json'], ['csv', 'text/csv']]) {
      const result = await call(fixture.handler, `${API_PREFIX}/export?sessionId=${fixture.sessionId}&format=${format}`)
      assert.equal(result.res.statusCode, 200)
      assert.ok(result.res.headers['content-type'].startsWith(contentType))
      assert.match(result.res.headers['content-disposition'], /^attachment; filename="/u)
      assert.ok(result.res.body.length > 0)
    }
    const bad = await call(fixture.handler, `${API_PREFIX}/export?sessionId=${fixture.sessionId}&format=xml`)
    assert.equal(bad.res.statusCode, 400)
  } finally {
    await fixture.service.dispose()
    await fixture.store.close()
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

test('request validation, method rejection, and HEAD', async () => {
  const fixture = await setup()
  try {
    const traversal = await call(fixture.handler, `${API_PREFIX}/receipt?sessionId=..%2Fevil&turn=1`)
    assert.equal(traversal.res.statusCode, 400)
    assert.equal(traversal.json.code, 'pressure/bad-request')

    const badTurn = await call(fixture.handler, `${API_PREFIX}/receipt?sessionId=${fixture.sessionId}&turn=abc`)
    assert.equal(badTurn.res.statusCode, 400)

    const post = await call(fixture.handler, `${API_PREFIX}/health`, 'POST')
    assert.equal(post.res.statusCode, 405)
    assert.equal(post.res.headers.allow, 'GET, HEAD')

    const head = await call(fixture.handler, `${API_PREFIX}/health`, 'HEAD')
    assert.equal(head.res.statusCode, 200)
    assert.equal(head.res.body, '')

    const unknown = await call(fixture.handler, `${API_PREFIX}/nope`)
    assert.equal(unknown.res.statusCode, 404)
    assert.equal(unknown.json.code, 'pressure/not-found')
  } finally {
    await fixture.service.dispose()
    await fixture.store.close()
    await rm(fixture.dir, { recursive: true, force: true })
  }
})
