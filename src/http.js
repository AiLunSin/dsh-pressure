/**
 * Read-only HTTP API under the Host's existing web server. Every route is GET
 * or HEAD, carries no CORS headers, and returns only aggregate numbers plus
 * stable codes. No write endpoint exists, so there is no CSRF surface.
 * @module dsh-pressure/http
 */

export const API_PREFIX = '/api/dsh-pressure'

const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/u
const FORMATS = new Set(['md', 'json', 'csv'])

/**
 * @param {{
 *   service: import('./service.js').PressureService,
 *   store: import('./receipts.js').ReceiptStore,
 *   config: ReturnType<typeof import('./config.js').resolveConfig>,
 *   version: string,
 *   dataDir: string,
 * }} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createNodeHandler(options) {
  const { service, store, config, version, dataDir } = options

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, failure('pressure/method-not-allowed', 'Only GET and HEAD are supported.'), {
          Allow: 'GET, HEAD',
        })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'HEAD') {
        // Keep the GET headers (including Content-Length) but never emit a body.
        const end = res.end.bind(res)
        res.end = () => end(undefined)
      }
      const pathname = url.pathname.startsWith(API_PREFIX)
        ? url.pathname.slice(API_PREFIX.length) || '/'
        : url.pathname
      const query = url.searchParams

      switch (pathname.replace(/\/+$/u, '') || '/') {
        case '/':
        case '/health':
          sendJson(res, 200, success(health()))
          return
        case '/sessions':
          sendJson(res, 200, success({ sessions: store.listSessions(clampLimit(query.get('limit'), 20)) }))
          return
        case '/live': {
          const rawSessionId = query.get('sessionId')
          if (rawSessionId === null) {
            // A root-scoped panel has no Session binding; offer the latest live one.
            sendJson(res, 200, success(service.latestLiveView() ?? { live: false }))
            return
          }
          const sessionId = readSessionId(query)
          if (sessionId === null) return
          const view = service.liveView(sessionId)
          if (view !== null) {
            sendJson(res, 200, success(view))
            return
          }
          const known = store.listSessions(200).find((entry) => entry.sessionId === sessionId)
          if (known === undefined) {
            sendJson(res, 404, failure('pressure/session-not-found', 'No live agent or stored receipt for this session.'))
            return
          }
          sendJson(res, 200, success({ sessionId, live: false, summary: known }))
          return
        }
        case '/receipts': {
          const sessionId = readSessionId(query)
          if (sessionId === null) return
          const limit = clampLimit(query.get('limit'), 50)
          const cursor = query.get('cursor')
          const result = await store.listReceipts(sessionId, { limit, cursor })
          sendJson(res, 200, success(result))
          return
        }
        case '/receipt': {
          const sessionId = readSessionId(query)
          if (sessionId === null) return
          const turn = readTurn(query)
          if (turn === null) return
          const receipt = await store.getReceipt(sessionId, turn)
          if (receipt === null) {
            sendJson(res, 404, failure('pressure/receipt-not-found', 'No receipt for this turn.'))
            return
          }
          sendJson(res, 200, success({ receipt }))
          return
        }
        case '/export': {
          const sessionId = readSessionId(query)
          if (sessionId === null) return
          const format = query.get('format') ?? 'md'
          if (!FORMATS.has(format)) {
            sendJson(res, 400, failure('pressure/bad-request', 'format must be md, json, or csv.'))
            return
          }
          const exported = await store.exportSession(sessionId, /** @type {'md'|'json'|'csv'} */ (format))
          if (exported === null) {
            sendJson(res, 404, failure('pressure/receipt-not-found', 'No receipt for this session.'))
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', exported.contentType)
          res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`)
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('X-Content-Type-Options', 'nosniff')
          res.end(req.method === 'HEAD' ? undefined : exported.body)
          return
        }
        default:
          sendJson(res, 404, failure('pressure/not-found', 'Unknown route.'))
      }
    } catch (error) {
      try {
        sendJson(res, 500, failure('pressure/internal', `Request failed: ${String(error?.message ?? error).slice(0, 200)}`))
      } catch {
        res.destroy()
      }
    }

    /** @returns {Record<string, any>} */
    function health() {
      return {
        version,
        dataDir,
        storage: store.stats(),
        services: {
          tokenMeter: typeof service.ctx.get?.('tokenMeter')?.contextPressure === 'function',
          sessionProjections: typeof service.ctx.get?.('sessionProjections')?.snapshot === 'function',
          webServer: true,
        },
        config: {
          mode: config.mode,
          locale: config.locale,
          thresholds: config.thresholds,
          coach: config.coach,
          storage: {
            retentionDays: config.storage.retentionDays,
            maxReceiptsPerSession: config.storage.maxReceiptsPerSession,
            maxTotalBytes: config.storage.maxTotalBytes,
          },
        },
      }
    }

    /**
     * @param {URLSearchParams} query
     * @returns {string | null} session id, or null after responding with an error
     */
    function readSessionId(query) {
      const sessionId = query.get('sessionId')
      if (sessionId === null || !SESSION_ID.test(sessionId)) {
        sendJson(res, 400, failure('pressure/bad-request', 'sessionId is required and must match [A-Za-z0-9._:-]{1,200}.'))
        return null
      }
      return sessionId
    }

    /**
     * @param {URLSearchParams} query
     * @returns {number | null} turn, or null after responding with an error
     */
    function readTurn(query) {
      const raw = query.get('turn')
      const turn = raw === null ? Number.NaN : Number(raw)
      if (!Number.isInteger(turn) || turn < 1 || turn > 1e9) {
        sendJson(res, 400, failure('pressure/bad-request', 'turn must be an integer in 1..1000000000.'))
        return null
      }
      return turn
    }
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, any>} payload
 * @param {Record<string, string>} [headers]
 * @returns {void}
 */
function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  res.setHeader('Content-Length', String(body.length))
  res.end(body)
}

/**
 * @param {Record<string, any>} data
 * @returns {{ ok: true, data: Record<string, any> }}
 */
function success(data) {
  return { ok: true, data }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, code: string, message: string }}
 */
function failure(code, message) {
  return { ok: false, code, message }
}

/**
 * @param {string | null} raw
 * @param {number} fallback
 * @returns {number}
 */
function clampLimit(raw, fallback) {
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(200, Math.max(1, Math.trunc(value)))
}
