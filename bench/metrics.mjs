/**
 * Read official Session logs for benchmark metrics without depending on the
 * plugin. DSH stores one zstd-compressed JSONL per Session; only event metadata
 * and provider usage are read here — no message or tool content is returned.
 * @module dsh-pressure/bench/metrics
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/**
 * @param {string} file
 * @returns {any[]}
 */
export function decodeSessionLog(file) {
  const bytes = readFileSync(file)
  const text = file.endsWith('.zstd')
    ? zstdDecompressSync(bytes).toString('utf8')
    : bytes.toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A truncated tail after a crash is ignored like the store does.
    }
  }
  return events
}

/**
 * Aggregate one Session's event metadata.
 * @param {any[]} events
 * @returns {{
 *   sessionId: string | null,
 *   cwd: string | null,
 *   createdAt: number | null,
 *   startedAt: number | null,
 *   endedAt: number | null,
 *   wallMs: number | null,
 *   turns: number,
 *   steps: number,
 *   toolCalls: number,
 *   toolFailures: number,
 *   compactions: number,
 *   tokens: { input: number, output: number, cacheRead: number, cacheWrite: number, total: number, cacheHitRate: number | null },
 * }}
 */
export function metricsFromEvents(events) {
  let sessionId = null
  let cwd = null
  let createdAt = null
  let startedAt = null
  let endedAt = null
  let turns = 0
  let steps = 0
  let toolCalls = 0
  let toolFailures = 0
  let compactions = 0
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const event of events) {
    if (event?.type === 'session') {
      sessionId = typeof event.id === 'string' ? event.id : sessionId
      cwd = typeof event.cwd === 'string' ? event.cwd : cwd
      createdAt = typeof event.createdAt === 'number' ? event.createdAt : createdAt
      continue
    }
    const time = typeof event?.time === 'number' ? event.time : null
    if (time !== null) {
      if (startedAt === null) startedAt = time
      endedAt = time
    }
    switch (event?.type) {
      case 'turn/start':
        turns += 1
        break
      case 'step/end':
        steps += 1
        break
      case 'tool/call':
        toolCalls += 1
        break
      case 'tool/result':
        if (event.data?.message?.isError === true || event.data?.error !== undefined) toolFailures += 1
        break
      case 'compaction/end':
        compactions += 1
        break
      case 'assistant/message': {
        const usage = event.data?.usage
        if (usage === undefined) break
        tokens.input += number(usage.inputTokens)
        tokens.output += number(usage.outputTokens)
        tokens.cacheRead += number(usage.cacheReadTokens)
        tokens.cacheWrite += number(usage.cacheWriteTokens)
        break
      }
      default:
        break
    }
  }
  const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  const denominator = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return {
    sessionId,
    cwd,
    createdAt,
    startedAt,
    endedAt,
    wallMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null,
    turns,
    steps,
    toolCalls,
    toolFailures,
    compactions,
    tokens: {
      ...tokens,
      total,
      cacheHitRate: denominator > 0 ? Math.round((tokens.cacheRead / denominator) * 1e6) / 1e6 : null,
    },
  }
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * All Session logs under a DSH home, optionally only ones touched since a time.
 * @param {string} dshHome
 * @param {{ since?: number }} [options]
 * @returns {Array<{ file: string, project: string, session: string, mtime: number }>}
 */
export function findSessionLogs(dshHome, options = {}) {
  const root = path.join(dshHome, 'sessions')
  const since = options.since ?? 0
  const found = []
  let projects = []
  try {
    projects = readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(root, project.name)
    let sessions = []
    try {
      sessions = readdirSync(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const file = path.join(projectDir, session.name, 'session.v4.jsonl.zstd')
      try {
        const info = statSync(file)
        if (info.mtimeMs >= since) {
          found.push({ file, project: project.name, session: session.name, mtime: info.mtimeMs })
        }
      } catch {
        // Session without a log yet.
      }
    }
  }
  return found.sort((left, right) => left.mtime - right.mtime)
}

/**
 * Metrics for the newest Session whose header matches a working directory and
 * creation time.
 * @param {Array<{ file: string }>} logs
 * @param {{ cwd: string, since: number }} filter
 * @returns {{ file: string, metrics: ReturnType<typeof metricsFromEvents> } | null}
 */
export function findRunMetrics(logs, filter) {
  let best = null
  for (const log of logs) {
    const metrics = metricsFromEvents(decodeSessionLog(log.file))
    if (metrics.cwd !== filter.cwd) continue
    if (metrics.createdAt !== null && metrics.createdAt < filter.since) continue
    if (best === null || (metrics.createdAt ?? 0) > (best.metrics.createdAt ?? 0)) best = { file: log.file, metrics }
  }
  return best
}
