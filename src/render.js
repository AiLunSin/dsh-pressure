/**
 * Human- and machine-readable receipt exports. Both formats are derived from
 * the stored numeric receipt only; nothing here can reach prompt or tool text.
 * @module dsh-pressure/render
 */

import { translator } from './locale.js'

/**
 * @param {number | null | undefined} value
 * @param {string} locale
 * @returns {string}
 */
function number(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(value)
}

/**
 * @param {number | null | undefined} value
 * @returns {string}
 */
function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 1000) / 10}%`
}

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
function duration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

/**
 * @param {string} locale
 * @param {string} isoString
 * @returns {string}
 */
function localTime(locale, isoString) {
  const value = Date.parse(isoString)
  if (!Number.isFinite(value)) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value))
}

/**
 * Render one or more receipts as Markdown.
 * @param {Array<Record<string, any>>} receipts
 * @param {{ locale: string, version: string, now: number }} options
 * @returns {string}
 */
export function renderMarkdown(receipts, options) {
  const t = translator(options.locale)
  const lines = []
  lines.push(`# ${t('export.title')}`)
  lines.push('')
  lines.push(t('export.generatedAt', {
    time: localTime(options.locale, new Date(options.now).toISOString()),
    version: options.version,
  }))
  lines.push('')
  lines.push(`> ${t('export.scopeNote')}`)
  lines.push(`> ${t('export.cacheFormula')}`)
  lines.push(`> ${t('export.noBody')}`)
  lines.push('')

  for (const receipt of receipts) {
    const turn = receipt.turn
    lines.push(`## ${t('export.turn')} ${turn}${receipt.partial ? ` · ${t('export.partial')}` : ''}`)
    lines.push('')
    lines.push('| | |')
    lines.push('|---|---|')
    lines.push(`| ${t('export.started')} | ${localTime(options.locale, receipt.startedAt ?? '')} |`)
    lines.push(`| ${t('export.ended')} | ${localTime(options.locale, receipt.endedAt)} |`)
    lines.push(`| ${t('export.wall')} | ${duration(receipt.wallMs)} |`)
    lines.push(`| ${t('export.tokens')} | ${number(receipt.tokens?.total, options.locale)} (${t('export.cacheHit')}: ${percent(receipt.tokens?.cacheHitRate)}) |`)
    lines.push(`| ${t('export.context')} | ${percent(receipt.context?.observedPeak)} (${receipt.context?.observedFrom ?? t('export.unknown')}) |`)
    lines.push(`| ${t('export.tools')} | ${number(receipt.tools?.calls, options.locale)} / ${number(receipt.tools?.failures, options.locale)} / ${number(receipt.tools?.repeats, options.locale)} |`)
    lines.push(`| ${t('export.budget')} | ${receipt.budget?.mode ?? '—'} · ${number(receipt.budget?.sessionSpent, options.locale)} / ${number(receipt.budget?.sessionLimit, options.locale)} |`)
    lines.push('')
    lines.push(`**${t('export.signals')}**: ${(receipt.flags ?? []).map((flag) => `${flag.code} ×${number(flag.count, options.locale)} (${flag.severity})`).join(', ') || t('export.none')}`)
    lines.push('')
    lines.push(`**${t('export.advice')}**: ${t(receipt.adviceKey ?? 'advice.none')}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/**
 * Render receipts as CSV: one row per turn, fixed columns, no free text.
 * @param {Array<Record<string, any>>} receipts
 * @param {string} locale
 * @returns {string}
 */
export function renderCsv(receipts, locale) {
  const t = translator(locale)
  const rows = [t('export.csvHeader')]
  for (const receipt of receipts) {
    const tokens = receipt.tokens ?? {}
    const context = receipt.context ?? {}
    const tools = receipt.tools ?? {}
    const budget = receipt.budget ?? {}
    const flags = (receipt.flags ?? []).map((flag) => flag.code).join(';')
    rows.push([
      receipt.sessionId,
      receipt.turn,
      receipt.startedAt ?? '',
      receipt.endedAt,
      receipt.wallMs ?? '',
      tokens.input ?? '',
      tokens.output ?? '',
      tokens.cacheRead ?? '',
      tokens.cacheWrite ?? '',
      tokens.total ?? '',
      tokens.cacheHitRate ?? '',
      context.endPressure ?? '',
      context.observedPeak ?? '',
      context.observedFrom ?? '',
      tools.calls ?? '',
      tools.failures ?? '',
      tools.repeats ?? '',
      context.compactions ?? '',
      budget.mode ?? '',
      budget.sessionLimit ?? '',
      budget.sessionSpent ?? '',
      budget.overBudget ?? '',
      budget.denied ?? '',
      flags,
      receipt.adviceKey ?? '',
      receipt.partial === true ? 'true' : 'false',
    ].map((field) => escapeCsv(field)).join(','))
  }
  return `${rows.join('\n')}\n`
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
