/**
 * Configuration defaults, validation, and fail-loud normalization.
 * Invalid values throw during plugin load so a typo never becomes a silent
 * fallback (FR-C-04).
 * @module dsh-pressure/config
 */

import { isPlainObject } from './util.js'

export const MODES = Object.freeze(['observe', 'coach', 'enforce'])
export const LOCALES = Object.freeze(['auto', 'zh', 'en'])

/** @typedef {'observe' | 'coach' | 'enforce'} PressureMode */

export const DEFAULTS = Object.freeze({
  mode: 'observe',
  locale: 'auto',
  budget: Object.freeze({
    sessionTokens: 0,
    turnTokens: 0,
    turnToolCalls: 0,
  }),
  thresholds: Object.freeze({
    contextPressure: 0.8,
    budgetPressure: 0.8,
    failureStreak: 2,
    bloatedResultTokens: 8000,
    compactionChurn: 2,
  }),
  coach: Object.freeze({
    maxPerTurn: 3,
  }),
  storage: Object.freeze({
    dataDir: null,
    retentionDays: 30,
    maxReceiptsPerSession: 2000,
    maxTotalBytes: 52428800,
  }),
  http: Object.freeze({
    enabled: true,
  }),
})

const KNOWN_TOP = new Set(['mode', 'locale', 'budget', 'thresholds', 'coach', 'storage', 'http'])

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(`dsh-pressure/config: ${message}`)
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function integer(value, field, min, max, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail(`${field} must be an integer in ${min}..${max} (got ${JSON.stringify(value)})`)
  }
  if (value < min || value > max) fail(`${field} must be in ${min}..${max} (got ${value})`)
  return value
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function decimal(value, field, min, max, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${field} must be a number in ${min}..${max} (got ${JSON.stringify(value)})`)
  }
  if (value < min || value > max) fail(`${field} must be in ${min}..${max} (got ${value})`)
  return value
}

/**
 * Reject unknown keys at one level so a misspelled field cannot be ignored.
 * @param {Record<string, unknown>} input
 * @param {Set<string>} known
 * @param {string} prefix
 */
function rejectUnknown(input, known, prefix) {
  for (const key of Object.keys(input)) {
    if (!known.has(key)) fail(`unknown key "${prefix}${key}"`)
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function section(value, field) {
  if (value === undefined) return {}
  if (!isPlainObject(value)) fail(`${field} must be an object`)
  return value
}

/**
 * Normalize a raw plugin config.
 * @param {unknown} raw
 * @returns {{
 *   mode: PressureMode,
 *   locale: 'auto' | 'zh' | 'en',
 *   budget: { sessionTokens: number, turnTokens: number, turnToolCalls: number },
 *   thresholds: { contextPressure: number, budgetPressure: number, failureStreak: number, bloatedResultTokens: number, compactionChurn: number },
 *   coach: { maxPerTurn: number },
 *   storage: { dataDir: string | null, retentionDays: number, maxReceiptsPerSession: number, maxTotalBytes: number },
 *   http: { enabled: boolean },
 * }}
 */
export function resolveConfig(raw) {
  const input = raw === undefined || raw === null ? {} : raw
  if (!isPlainObject(input)) fail('config must be an object')
  rejectUnknown(input, KNOWN_TOP, '')

  const mode = input.mode === undefined ? DEFAULTS.mode : input.mode
  if (typeof mode !== 'string' || !MODES.includes(/** @type {PressureMode} */ (mode))) {
    fail(`mode must be one of ${MODES.join(' | ')} (got ${JSON.stringify(mode)})`)
  }

  const locale = input.locale === undefined ? DEFAULTS.locale : input.locale
  if (typeof locale !== 'string' || !LOCALES.includes(/** @type {'auto'} */ (locale))) {
    fail(`locale must be one of ${LOCALES.join(' | ')} (got ${JSON.stringify(locale)})`)
  }

  const budgetInput = section(input.budget, 'budget')
  rejectUnknown(budgetInput, new Set(['sessionTokens', 'turnTokens', 'turnToolCalls']), 'budget.')
  const budget = {
    sessionTokens: integer(budgetInput.sessionTokens, 'budget.sessionTokens', 0, 1e9, DEFAULTS.budget.sessionTokens),
    turnTokens: integer(budgetInput.turnTokens, 'budget.turnTokens', 0, 1e9, DEFAULTS.budget.turnTokens),
    turnToolCalls: integer(budgetInput.turnToolCalls, 'budget.turnToolCalls', 0, 1e6, DEFAULTS.budget.turnToolCalls),
  }

  const thresholdsInput = section(input.thresholds, 'thresholds')
  rejectUnknown(
    thresholdsInput,
    new Set(['contextPressure', 'budgetPressure', 'failureStreak', 'bloatedResultTokens', 'compactionChurn']),
    'thresholds.',
  )
  const thresholds = {
    contextPressure: decimal(thresholdsInput.contextPressure, 'thresholds.contextPressure', 0.5, 0.99, DEFAULTS.thresholds.contextPressure),
    budgetPressure: decimal(thresholdsInput.budgetPressure, 'thresholds.budgetPressure', 0.5, 0.99, DEFAULTS.thresholds.budgetPressure),
    failureStreak: integer(thresholdsInput.failureStreak, 'thresholds.failureStreak', 1, 50, DEFAULTS.thresholds.failureStreak),
    bloatedResultTokens: integer(thresholdsInput.bloatedResultTokens, 'thresholds.bloatedResultTokens', 500, 1e6, DEFAULTS.thresholds.bloatedResultTokens),
    compactionChurn: integer(thresholdsInput.compactionChurn, 'thresholds.compactionChurn', 1, 20, DEFAULTS.thresholds.compactionChurn),
  }

  const coachInput = section(input.coach, 'coach')
  rejectUnknown(coachInput, new Set(['maxPerTurn']), 'coach.')
  const coach = {
    maxPerTurn: integer(coachInput.maxPerTurn, 'coach.maxPerTurn', 1, 10, DEFAULTS.coach.maxPerTurn),
  }

  const storageInput = section(input.storage, 'storage')
  rejectUnknown(
    storageInput,
    new Set(['dataDir', 'retentionDays', 'maxReceiptsPerSession', 'maxTotalBytes']),
    'storage.',
  )
  let dataDir = DEFAULTS.storage.dataDir
  if (storageInput.dataDir !== undefined) {
    if (storageInput.dataDir !== null && typeof storageInput.dataDir !== 'string') {
      fail('storage.dataDir must be a string path or null')
    }
    dataDir = storageInput.dataDir
  }
  const storage = {
    dataDir,
    retentionDays: integer(storageInput.retentionDays, 'storage.retentionDays', 1, 3650, DEFAULTS.storage.retentionDays),
    maxReceiptsPerSession: integer(storageInput.maxReceiptsPerSession, 'storage.maxReceiptsPerSession', 1, 100000, DEFAULTS.storage.maxReceiptsPerSession),
    maxTotalBytes: integer(storageInput.maxTotalBytes, 'storage.maxTotalBytes', 65536, 1073741824, DEFAULTS.storage.maxTotalBytes),
  }

  const httpInput = section(input.http, 'http')
  rejectUnknown(httpInput, new Set(['enabled']), 'http.')
  const http = {
    enabled: httpInput.enabled === undefined ? DEFAULTS.http.enabled : httpInput.enabled,
  }
  if (typeof http.enabled !== 'boolean') fail('http.enabled must be a boolean')

  return { mode, locale, budget, thresholds, coach, storage, http }
}
