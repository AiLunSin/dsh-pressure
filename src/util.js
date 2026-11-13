/**
 * Small, dependency-free helpers shared by the Host half.
 * @module dsh-pressure/util
 */

import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/** Fixed price of one image block when estimating a tool result's size. */
export const IMAGE_TOKEN_PLACEHOLDER = 1000

/** Large argument payloads are hashed in raw form instead of being parsed. */
const CANONICAL_PARSE_LIMIT = 64 * 1024

/**
 * Lowercase SHA-256 hex digest of a string.
 * @param {string} value
 * @returns {string}
 */
export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

/**
 * Stable JSON for duplicate detection: object keys sorted recursively.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value))
}

/** @param {unknown} value @returns {unknown} */
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const sorted = {}
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(/** @type {Record<string, unknown>} */ (value)[key])
    }
    return sorted
  }
  return value
}

/**
 * Hash of one tool call's arguments without retaining the arguments.
 * @param {string} rawArguments raw JSON string produced by the model
 * @returns {string}
 */
export function hashArguments(rawArguments) {
  const text = typeof rawArguments === 'string' ? rawArguments : ''
  if (text.length > CANONICAL_PARSE_LIMIT) return sha256Hex(`raw:${text}`)
  try {
    return sha256Hex(`json:${canonicalJson(JSON.parse(text))}`)
  } catch {
    return sha256Hex(`raw:${text}`)
  }
}

/**
 * File-name-safe hash of a session id. The original id stays inside the records.
 * @param {unknown} sessionId
 * @returns {string}
 */
export function hashSessionId(sessionId) {
  return sha256Hex(String(sessionId)).slice(0, 32)
}

/**
 * Stable receipt identity: 16 bytes of SHA-256 over `sessionId\0turn`.
 * @param {unknown} sessionId
 * @param {number} turn
 * @returns {string}
 */
export function receiptIdFor(sessionId, turn) {
  return `sha256:${sha256Hex(`${String(sessionId)}\u0000${String(turn)}`).slice(0, 32)}`
}

/**
 * Heuristic token size of content blocks: text is `ceil(chars / 4)`, images
 * carry a fixed placeholder. This is an estimate and never used for billing.
 * @param {unknown} content
 * @returns {number}
 */
export function estimateContentTokens(content) {
  if (!Array.isArray(content)) return 0
  let total = 0
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = /** @type {Record<string, unknown>} */ (block)
    if (record.type === 'text' && typeof record.text === 'string') {
      total += Math.ceil(record.text.length / 4)
    } else if (record.type === 'image') {
      total += IMAGE_TOKEN_PLACEHOLDER
    } else if (record.type === 'file') {
      total += IMAGE_TOKEN_PLACEHOLDER
    }
  }
  return total
}

/**
 * Size estimate for one tool result message.
 * @param {unknown} message
 * @returns {number}
 */
export function estimateMessageTokens(message) {
  if (message === null || typeof message !== 'object') return 0
  return estimateContentTokens(/** @type {Record<string, unknown>} */ (message).content)
}

/**
 * Resolve the plugin's data directory. `storage.dataDir` wins; otherwise
 * `$DSH_HOME/squeeze`, then `~/.dsh/squeeze`.
 * @param {{ dataDir?: string | null } | undefined} storage
 * @param {NodeJS.ProcessEnv} [env]
 * @param {() => string} [homedir]
 * @returns {string}
 */
export function resolveDataDir(storage, env = process.env, homedir = os.homedir) {
  const configured = storage?.dataDir
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return path.resolve(configured.trim())
  }
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
    ? env.DSH_HOME.trim()
    : path.join(homedir(), '.dsh')
  return path.join(path.resolve(home), 'squeeze')
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Base64url encode a short cursor.
 * @param {string} value
 * @returns {string}
 */
export function encodeCursor(value) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/**
 * Decode a cursor produced by {@link encodeCursor}.
 * @param {string} value
 * @returns {string | null}
 */
export function decodeCursor(value) {
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8')
    return text.length > 0 && text.length <= 512 ? text : null
  } catch {
    return null
  }
}

/**
 * UTC ISO timestamp for an epoch-millisecond value.
 * @param {number} ms
 * @returns {string}
 */
export function isoTime(ms) {
  return new Date(ms).toISOString()
}

/**
 * Best-effort POSIX mode change; Windows has no equivalent and is not faked.
 * @param {string} target
 * @param {number} mode
 * @returns {Promise<boolean>} whether the mode was applied
 */
export async function bestEffortChmod(target, mode) {
  try {
    const { chmod } = await import('node:fs/promises')
    await chmod(target, mode)
    return process.platform !== 'win32'
  } catch {
    return false
  }
}

/**
 * Round a ratio for storage and display; `null` when the denominator is unknown.
 * @param {number | null | undefined} numerator
 * @param {number | null | undefined} denominator
 * @returns {number | null}
 */
export function ratio(numerator, denominator) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator <= 0) return null
  return Math.round((numerator / denominator) * 1e6) / 1e6
}
