/**
 * Durable receipt store: append-only JSONL per session, idempotent by
 * `(sessionId, turn)`, bounded by retention and size, and readable without
 * loading every receipt into memory.
 * @module dsh-pressure/receipts
 */

import { mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { assertReceiptSafe } from './receipt.js'
import { renderCsv, renderMarkdown } from './render.js'
import { hashSessionId, isFiniteNumber } from './util.js'

/** A single receipt larger than this is refused as anomalous. */
export const MAX_RECEIPT_BYTES = 16 * 1024
/** A session file shards once it grows past this size. */
export const SHARD_BYTES = 5 * 1024 * 1024
/** Directory and file permissions used on POSIX; ignored on Windows. */
const DIR_MODE = 0o700
const FILE_MODE = 0o600

/**
 * @typedef {ReturnType<typeof import('./receipt.js').buildReceipt>} Receipt
 * @typedef {{ updatedAt: string, endedAt: string, id: string, tokensTotal: number | null, flags: number, mode: string, turn: number }} ReceiptMeta
 */

export class ReceiptStore {
  /**
   * @param {{
   *   dataDir: string,
   *   retentionDays: number,
   *   maxReceiptsPerSession: number,
   *   maxTotalBytes: number,
   *   version: string,
   *   locale: () => string,
   *   logger?: { warn?: (message: string) => void, info?: (message: string) => void },
   *   clock?: () => number,
   * }} options
   */
  constructor(options) {
    this.dataDir = options.dataDir
    this.receiptsDir = path.join(this.dataDir, 'receipts')
    this.exportsDir = path.join(this.dataDir, 'exports')
    this.logsDir = path.join(this.dataDir, 'logs')
    this.retentionDays = options.retentionDays
    this.maxReceiptsPerSession = options.maxReceiptsPerSession
    this.maxTotalBytes = options.maxTotalBytes
    this.version = options.version
    this.locale = options.locale
    this.logger = options.logger
    this.clock = options.clock ?? Date.now
    /** @type {Map<string, { sessionId: string, file: string, bytes: number, lastEndedAt: number, turns: Map<number, ReceiptMeta> }>} */
    this.sessions = new Map()
    this.totalBytes = 0
    this.badLines = 0
    this.opened = false
    this.writesSincePrune = 0
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve()
  }

  /**
   * Create directories, scan existing files, and rebuild the in-memory index.
   * Throws when the data directory is unusable so the plugin fails loudly.
   * @returns {Promise<void>}
   */
  async open() {
    await mkdir(this.receiptsDir, { recursive: true, mode: DIR_MODE })
    await mkdir(this.exportsDir, { recursive: true, mode: DIR_MODE })
    await mkdir(this.logsDir, { recursive: true, mode: DIR_MODE })
    const entries = await readdir(this.receiptsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const file = path.join(this.receiptsDir, entry.name)
      const hash = entry.name.slice(0, -'.jsonl'.length)
      await this.#indexFile(hash, file)
    }
    this.opened = true
    await this.prune()
    this.logger?.info?.(`[pressure] store ready: dir=${this.receiptsDir} sessions=${this.sessions.size} bytes=${this.totalBytes}`)
  }

  /**
   * @param {string} hash
   * @param {string} file
   */
  async #indexFile(hash, file) {
    const shards = await this.#shards(hash)
    if (shards.length === 0) return
    /** @type {Map<number, ReceiptMeta>} */
    const turns = new Map()
    let sessionId = ''
    let bytes = 0
    for (const shard of shards) {
      let text = ''
      try {
        text = await readFile(shard, 'utf8')
      } catch {
        continue
      }
      bytes += Buffer.byteLength(text)
      for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue
        const receipt = parseLine(line)
        if (receipt === null) {
          this.badLines += 1
          continue
        }
        if (typeof receipt.sessionId === 'string' && receipt.sessionId.length > 0) sessionId = receipt.sessionId
        const meta = toMeta(receipt)
        if (meta === null) {
          this.badLines += 1
          continue
        }
        const previous = turns.get(meta.turn)
        if (previous === undefined || previous.updatedAt <= meta.updatedAt) turns.set(meta.turn, meta)
      }
    }
    if (turns.size === 0) return
    const lastEndedAt = [...turns.values()].reduce((max, meta) => Math.max(max, Date.parse(meta.endedAt) || 0), 0)
    this.sessions.set(hash, { sessionId, file, bytes, lastEndedAt, turns })
    this.totalBytes += bytes
  }

  /**
   * Files for one session in chronological order (older shard first).
   * @param {string} hash
   * @returns {Promise<string[]>}
   */
  async #shards(hash) {
    const base = path.join(this.receiptsDir, `${hash}.jsonl`)
    /** @type {string[]} */
    const shards = []
    for (const candidate of [`${base}.1`, base]) {
      try {
        const info = await stat(candidate)
        if (info.isFile() && info.size > 0) shards.push(candidate)
      } catch {
        // Missing shard is normal.
      }
    }
    return shards
  }

  /**
   * Append one receipt. Duplicate `(sessionId, turn)` writes are ignored unless
   * the new record has a later `updatedAt` (crash replay keeps one visible row).
   * @param {Receipt} receipt
   * @returns {Promise<{ written: boolean, reason?: string }>}
   */
  async appendReceipt(receipt) {
    const run = async () => {
      if (!this.opened) throw new Error('dsh-pressure/store: not open')
      if (receipt === null || typeof receipt !== 'object') return { written: false, reason: 'invalid' }
      if (typeof receipt.sessionId !== 'string' || receipt.sessionId.length === 0) return { written: false, reason: 'invalid-session' }
      if (!Number.isInteger(receipt.turn) || receipt.turn < 1) return { written: false, reason: 'invalid-turn' }
      assertReceiptSafe(receipt)
      const line = `${JSON.stringify(receipt)}\n`
      const lineBytes = Buffer.byteLength(line)
      if (lineBytes > MAX_RECEIPT_BYTES) return { written: false, reason: 'too-large' }

      const hash = hashSessionId(receipt.sessionId)
      const entry = this.sessions.get(hash) ?? {
        sessionId: receipt.sessionId,
        file: path.join(this.receiptsDir, `${hash}.jsonl`),
        bytes: 0,
        lastEndedAt: 0,
        turns: new Map(),
      }
      const previous = entry.turns.get(receipt.turn)
      if (previous !== undefined && previous.updatedAt >= receipt.updatedAt) {
        return { written: false, reason: 'idempotent' }
      }
      const meta = toMeta(receipt)
      if (meta === null) return { written: false, reason: 'invalid' }

      await appendLine(entry.file, line)
      entry.turns.set(receipt.turn, meta)
      entry.lastEndedAt = Math.max(entry.lastEndedAt, Date.parse(receipt.endedAt) || this.clock())
      entry.bytes += lineBytes
      this.totalBytes += lineBytes
      this.sessions.set(hash, entry)
      this.writesSincePrune += 1

      if (entry.bytes > SHARD_BYTES) await this.#shard(entry)
      if (this.totalBytes > this.maxTotalBytes || this.writesSincePrune >= 32) await this.#pruneNow()
      return { written: true }
    }
    return this.#enqueue(run)
  }

  /**
   * Move the current file to `.1`, replacing any older shard.
   * @param {{ file: string, bytes: number }} entry
   */
  async #shard(entry) {
    try {
      await rename(entry.file, `${entry.file}.1`)
      entry.bytes = 0
      this.logger?.info?.('[pressure] receipt shard rotated')
    } catch (error) {
      this.logger?.warn?.(`[pressure] shard failed: ${String(error?.message ?? error)}`)
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  #enqueue(operation) {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * Every receipt for one session, deduped by turn, ascending.
   * @param {string} sessionId
   * @returns {Promise<Receipt[]>}
   */
  async readSession(sessionId) {
    const hash = hashSessionId(sessionId)
    const shards = await this.#shards(hash)
    /** @type {Map<number, Receipt>} */
    const byTurn = new Map()
    for (const shard of shards) {
      let text = ''
      try {
        text = await readFile(shard, 'utf8')
      } catch {
        continue
      }
      for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue
        const receipt = parseLine(line)
        if (receipt === null || receipt.sessionId !== sessionId) continue
        const previous = byTurn.get(receipt.turn)
        if (previous === undefined || String(previous.updatedAt) <= String(receipt.updatedAt)) byTurn.set(receipt.turn, receipt)
      }
    }
    return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
  }

  /**
   * @param {string} sessionId
   * @param {{ limit?: number, cursor?: string | null }} [options]
   * @returns {Promise<{ receipts: Receipt[], nextCursor: string | null }>}
   */
  async listReceipts(sessionId, options = {}) {
    const limit = clampLimit(options.limit, 50)
    const all = await this.readSession(sessionId)
    const cursorTurn = options.cursor === null || options.cursor === undefined ? null : Number(options.cursor)
    const filtered = cursorTurn !== null && Number.isInteger(cursorTurn)
      ? all.filter((receipt) => receipt.turn < cursorTurn)
      : all
    const newestFirst = filtered.slice().reverse()
    const page = newestFirst.slice(0, limit)
    return {
      receipts: page,
      nextCursor: newestFirst.length > limit ? String(page[page.length - 1].turn) : null,
    }
  }

  /**
   * @param {string} sessionId
   * @param {number} turn
   * @returns {Promise<Receipt | null>}
   */
  async getReceipt(sessionId, turn) {
    const all = await this.readSession(sessionId)
    return all.find((receipt) => receipt.turn === turn) ?? null
  }

  /**
   * Session summaries for the panel, newest activity first.
   * @param {number} [limit]
   * @returns {Array<{ sessionId: string, receipts: number, lastTurn: number, lastEndedAt: string, tokensTotal: number | null, flags: number }>}
   */
  listSessions(limit = 20) {
    return [...this.sessions.values()]
      .filter((entry) => entry.sessionId.length > 0 && entry.turns.size > 0)
      .map((entry) => {
        const metas = [...entry.turns.values()]
        const last = metas.reduce((left, right) => (Date.parse(right.endedAt) > Date.parse(left.endedAt) ? right : left))
        return {
          sessionId: entry.sessionId,
          receipts: entry.turns.size,
          lastTurn: last.turn,
          lastEndedAt: last.endedAt,
          tokensTotal: last.tokensTotal,
          flags: last.flags,
        }
      })
      .sort((left, right) => Date.parse(right.lastEndedAt) - Date.parse(left.lastEndedAt))
      .slice(0, clampLimit(limit, 20))
  }

  /**
   * Number of visible receipts for one session.
   * @param {string} sessionId
   * @returns {number}
   */
  receiptCount(sessionId) {
    return this.sessions.get(hashSessionId(sessionId))?.turns.size ?? 0
  }

  /**
   * Render one session for download.
   * @param {string} sessionId
   * @param {'md' | 'json' | 'csv'} format
   * @returns {Promise<{ body: string, contentType: string, filename: string } | null>}
   */
  async exportSession(sessionId, format) {
    const receipts = await this.readSession(sessionId)
    if (receipts.length === 0) return null
    const locale = this.locale()
    const now = this.clock()
    const stamp = new Date(now).toISOString().slice(0, 10)
    const stem = `pressure-${hashSessionId(sessionId).slice(0, 8)}-${stamp}`
    if (format === 'json') {
      return {
        body: JSON.stringify(receipts, null, 2),
        contentType: 'application/json; charset=utf-8',
        filename: `${stem}.json`,
      }
    }
    if (format === 'csv') {
      return {
        body: renderCsv(receipts, locale),
        contentType: 'text/csv; charset=utf-8',
        filename: `${stem}.csv`,
      }
    }
    return {
      body: renderMarkdown(receipts, { locale, version: this.version, now }),
      contentType: 'text/markdown; charset=utf-8',
      filename: `${stem}.md`,
    }
  }

  /**
   * Delete every receipt for one session. Used by the explicit `/squeeze purge --yes`.
   * @param {string} sessionId
   * @returns {Promise<number>}
   */
  async purgeSession(sessionId) {
    const run = async () => {
      const hash = hashSessionId(sessionId)
      const entry = this.sessions.get(hash)
      const shards = await this.#shards(hash)
      const count = entry?.turns.size ?? 0
      for (const shard of shards) {
        try {
          await unlink(shard)
        } catch (error) {
          this.logger?.warn?.(`[pressure] purge failed: ${String(error?.message ?? error)}`)
        }
      }
      if (entry !== undefined) {
        this.totalBytes = Math.max(0, this.totalBytes - entry.bytes)
        this.sessions.delete(hash)
      }
      return count
    }
    return this.#enqueue(run)
  }

  /**
   * Append one audit line for a runtime change. Contains no command text.
   * @param {{ action: string, sessionId: string, from?: unknown, to?: unknown, result?: string }} entry
   * @returns {Promise<void>}
   */
  async audit(entry) {
    const line = `${JSON.stringify({
      at: new Date(this.clock()).toISOString(),
      sessionId: entry.sessionId,
      action: entry.action,
      ...(entry.from === undefined ? {} : { from: entry.from }),
      ...(entry.to === undefined ? {} : { to: entry.to }),
      result: entry.result ?? 'ok',
    })}\n`
    try {
      await appendLine(path.join(this.logsDir, 'actions.jsonl'), line)
    } catch (error) {
      this.logger?.warn?.(`[pressure] audit failed: ${String(error?.message ?? error)}`)
    }
  }

  /**
   * Enforce per-session count, age, and total-byte limits. Best effort: failures
   * are logged and retried on a later write.
   * @returns {Promise<void>}
   */
  async prune() {
    return this.#enqueue(() => this.#pruneNow())
  }

  /**
   * The prune body. Runs inside the write queue; never enqueue from here.
   * @returns {Promise<void>}
   */
  async #pruneNow() {
    const now = this.clock()
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000
    for (const [hash, entry] of this.sessions) {
      const kept = [...entry.turns.values()]
        .filter((meta) => (Date.parse(meta.endedAt) || 0) >= cutoff)
        .sort((left, right) => left.turn - right.turn)
        .slice(-this.maxReceiptsPerSession)
      if (kept.length === entry.turns.size) continue
      await this.#rewrite(hash, entry, kept)
    }
    this.writesSincePrune = 0
    // Total-size cap: drop whole oldest sessions rather than corrupting files.
    while (this.totalBytes > this.maxTotalBytes) {
      const oldest = [...this.sessions.values()].sort((left, right) => left.lastEndedAt - right.lastEndedAt)[0]
      if (oldest === undefined) break
      const hash = hashSessionId(oldest.sessionId)
      const shards = await this.#shards(hash)
      for (const shard of shards) {
        try {
          await unlink(shard)
        } catch {
          // Already gone.
        }
      }
      this.totalBytes = Math.max(0, this.totalBytes - oldest.bytes)
      this.sessions.delete(hash)
    }
    this.#recomputeTotal()
  }

  /**
   * Rewrite one session file with the kept metadata's receipts.
   * @param {string} hash
   * @param {{ file: string, turns: Map<number, ReceiptMeta> }} entry
   * @param {ReceiptMeta[]} kept
   */
  async #rewrite(hash, entry, kept) {
    const all = await this.readSession(entry.sessionId)
    const keptTurns = new Set(kept.map((meta) => meta.turn))
    const lines = all.filter((receipt) => keptTurns.has(receipt.turn)).map((receipt) => `${JSON.stringify(receipt)}\n`)
    const temp = `${entry.file}.tmp`
    const handle = await open(temp, 'w', FILE_MODE)
    try {
      await handle.writeFile(lines.join(''), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, entry.file)
    try {
      await unlink(`${entry.file}.1`)
    } catch {
      // No shard to drop.
    }
    entry.turns = new Map(kept.map((meta) => [meta.turn, meta]))
    entry.bytes = Buffer.byteLength(lines.join(''))
  }

  /** Recompute the total byte counter from known session entries. */
  #recomputeTotal() {
    let total = 0
    for (const entry of this.sessions.values()) total += entry.bytes
    this.totalBytes = total
  }

  /**
   * Health data for `/health`.
   * @returns {{ ok: boolean, dir: string, sessions: number, receipts: number, bytes: number, badLines: number }}
   */
  stats() {
    let receipts = 0
    for (const entry of this.sessions.values()) receipts += entry.turns.size
    return {
      ok: this.opened,
      dir: this.receiptsDir,
      sessions: this.sessions.size,
      receipts,
      bytes: this.totalBytes,
      badLines: this.badLines,
    }
  }

  /** @returns {Promise<void>} */
  async close() {
    await this.queue.catch(() => undefined)
    this.opened = false
  }
}

/**
 * Append one line and fsync it before returning.
 * @param {string} file
 * @param {string} line
 * @returns {Promise<void>}
 */
async function appendLine(file, line) {
  const handle = await open(file, 'a', FILE_MODE)
  try {
    await handle.writeFile(line, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * @param {string} line
 * @returns {Receipt | null}
 */
function parseLine(line) {
  try {
    const value = JSON.parse(line)
    return value !== null && typeof value === 'object' && typeof value.sessionId === 'string' ? value : null
  } catch {
    return null
  }
}

/**
 * @param {Receipt} receipt
 * @returns {ReceiptMeta | null}
 */
function toMeta(receipt) {
  if (!Number.isInteger(receipt.turn) || typeof receipt.updatedAt !== 'string' || typeof receipt.endedAt !== 'string') {
    return null
  }
  const tokensTotal = isFiniteNumber(receipt.tokens?.total) ? receipt.tokens.total : null
  const mode = typeof receipt.budget?.mode === 'string' ? receipt.budget.mode : 'observe'
  return {
    turn: receipt.turn,
    updatedAt: receipt.updatedAt,
    endedAt: receipt.endedAt,
    id: typeof receipt.id === 'string' ? receipt.id : '',
    tokensTotal,
    flags: Array.isArray(receipt.flags) ? receipt.flags.length : 0,
    mode,
  }
}

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function clampLimit(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(200, Math.max(1, Math.trunc(value)))
}
