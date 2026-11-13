/**
 * Aggregate benchmark results and emit the honest report: success rate, median
 * tokens/tools/wall with ranges, and deltas against the baseline. It refuses to
 * present missing data as a result.
 * @module dsh-pressure/bench/report
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

/** @param {number[]} values */
function median(values) {
  if (values.length === 0) return null
  const sorted = values.slice().sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** @param {number[]} values */
function range(values) {
  if (values.length === 0) return null
  return { min: Math.min(...values), max: Math.max(...values) }
}

/** @param {number | null} value @returns {string} */
function num(value) {
  return value === null ? '—' : String(Math.round(value * 10) / 10)
}

/** @param {number | null} value @returns {string} */
function pct(value) {
  return value === null ? '—' : `${Math.round(value * 10) / 10}%`
}

/**
 * @param {any[]} rows
 */
export function aggregate(rows) {
  const groups = [...new Set(rows.map((row) => row.group))].sort()
  const tasks = [...new Set(rows.map((row) => row.task))].sort()
  const groupStats = {}
  for (const group of groups) {
    const groupRows = rows.filter((row) => row.group === group)
    const tokens = groupRows.map((row) => row.metrics?.tokens?.total).filter((value) => typeof value === 'number')
    const tools = groupRows.map((row) => row.metrics?.toolCalls).filter((value) => typeof value === 'number')
    const wall = groupRows.map((row) => row.metrics?.wallMs).filter((value) => typeof value === 'number')
    const passed = groupRows.filter((row) => row.passed).length
    groupStats[group] = {
      runs: groupRows.length,
      passed,
      successRate: groupRows.length > 0 ? passed / groupRows.length : null,
      tokensMedian: median(tokens),
      tokensRange: range(tokens),
      toolsMedian: median(tools),
      toolsRange: range(tools),
      wallMedian: median(wall),
      wallRange: range(wall),
      failures: groupRows.filter((row) => row.metrics === null || row.metrics === undefined).length,
    }
  }

  const perTask = {}
  for (const group of groups) {
    perTask[group] = {}
    for (const task of tasks) {
      const taskRows = rows.filter((row) => row.group === group && row.task === task)
      const tokens = taskRows.map((row) => row.metrics?.tokens?.total).filter((value) => typeof value === 'number')
      perTask[group][task] = {
        runs: taskRows.length,
        successRate: taskRows.length > 0 ? taskRows.filter((row) => row.passed).length / taskRows.length : null,
        tokensMedian: median(tokens),
      }
    }
  }

  const baseline = groupStats.A
  const deltas = {}
  if (baseline !== undefined) {
    for (const group of groups) {
      if (group === 'A') continue
      const current = groupStats[group]
      deltas[group] = {
        successDelta: current.successRate !== null && baseline.successRate !== null
          ? (current.successRate - baseline.successRate) * 100
          : null,
        tokensDelta: current.tokensMedian !== null && baseline.tokensMedian
          ? ((current.tokensMedian - baseline.tokensMedian) / baseline.tokensMedian) * 100
          : null,
        toolsDelta: current.toolsMedian !== null && baseline.toolsMedian
          ? ((current.toolsMedian - baseline.toolsMedian) / baseline.toolsMedian) * 100
          : null,
        wallDelta: current.wallMedian !== null && baseline.wallMedian
          ? ((current.wallMedian - baseline.wallMedian) / baseline.wallMedian) * 100
          : null,
      }
    }
  }

  const warnings = []
  for (const group of groups) {
    const stats = groupStats[group]
    if (stats.failures > 0) warnings.push(`${group}: ${stats.failures} run(s) have no Session metrics (log missing or unreadable).`)
  }
  if (deltas.D !== undefined && deltas.D.successDelta !== null && deltas.D.successDelta < -10) {
    warnings.push('enforce reduced success by more than 10 points; do not recommend it as a default.')
  }
  if (!groups.includes('A')) warnings.push('Baseline group A is missing; deltas cannot be computed.')
  const expected = new Set(tasks)
  for (const group of groups) {
    for (const task of tasks) {
      const cell = perTask[group][task]
      if (cell.runs === 0) warnings.push(`${group}/${task}: no runs recorded.`)
      else if (cell.runs < 3) warnings.push(`${group}/${task}: only ${cell.runs} repetition(s).`)
    }
    if (expected.size === 0) warnings.push('No tasks found in results.')
  }

  return { groups, tasks, groupStats, perTask, deltas, warnings, rows: rows.length }
}

/**
 * @param {ReturnType<typeof aggregate>} summary
 * @param {{ resultsFile: string, now?: number }} options
 */
export function renderMarkdown(summary, options) {
  const lines = []
  lines.push('# DSH Pressure benchmark report')
  lines.push('')
  lines.push(`Generated ${new Date(options.now ?? Date.now()).toISOString()} from \`${options.resultsFile}\`.`)
  lines.push('')
  lines.push(`Rows: ${summary.rows}. Groups: ${summary.groups.join(', ') || '—'}. Tasks: ${summary.tasks.length}.`)
  lines.push('')
  lines.push('## Overall')
  lines.push('')
  lines.push('| Group | Runs | Success | Median tokens (range) | Median tool calls | Median wall (range) |')
  lines.push('|---|---|---|---|---|---|')
  for (const group of summary.groups) {
    const stats = summary.groupStats[group]
    const tokenRange = stats.tokensRange === null ? '—' : `${num(stats.tokensRange.min)}–${num(stats.tokensRange.max)}`
    const wallRange = stats.wallRange === null ? '—' : `${num(stats.wallRange.min)}–${num(stats.wallRange.max)} ms`
    lines.push(`| ${group} | ${stats.runs} | ${pct(stats.successRate === null ? null : stats.successRate * 100)} | ${num(stats.tokensMedian)} (${tokenRange}) | ${num(stats.toolsMedian)} | ${num(stats.wallMedian)} (${wallRange}) |`)
  }
  lines.push('')
  lines.push('## Change vs baseline A')
  lines.push('')
  lines.push('| Group | Success Δ | Tokens Δ | Tool calls Δ | Wall Δ |')
  lines.push('|---|---|---|---|---|')
  for (const [group, delta] of Object.entries(summary.deltas)) {
    lines.push(`| ${group} | ${delta.successDelta === null ? '—' : `${num(delta.successDelta)} pt`} | ${delta.tokensDelta === null ? '—' : `${num(delta.tokensDelta)}%`} | ${delta.toolsDelta === null ? '—' : `${num(delta.toolsDelta)}%`} | ${delta.wallDelta === null ? '—' : `${num(delta.wallDelta)}%`} |`)
  }
  lines.push('')
  lines.push('## Per task (success / median tokens)')
  lines.push('')
  lines.push(`| Task | ${summary.groups.join(' | ')} |`)
  lines.push(`|---|${summary.groups.map(() => '---|').join('')}`)
  for (const task of summary.tasks) {
    const cells = summary.groups.map((group) => {
      const cell = summary.perTask[group][task]
      return `${pct(cell.successRate === null ? null : cell.successRate * 100)} / ${num(cell.tokensMedian)}`
    })
    lines.push(`| ${task} | ${cells.join(' | ')} |`)
  }
  lines.push('')
  lines.push('## Warnings')
  lines.push('')
  if (summary.warnings.length === 0) lines.push('None.')
  else for (const warning of summary.warnings) lines.push(`- ${warning}`)
  lines.push('')
  lines.push('Metrics come from official Session logs; token figures are runtime volume, not billed amounts.')
  return `${lines.join('\n')}\n`
}

/**
 * @param {ReturnType<typeof aggregate>} summary
 * @returns {string}
 */
export function renderCsv(summary) {
  const rows = ['group,runs,successRate,tokensMedian,tokensMin,tokensMax,toolsMedian,wallMedianMs']
  for (const group of summary.groups) {
    const stats = summary.groupStats[group]
    rows.push([
      group,
      stats.runs,
      stats.successRate === null ? '' : Math.round(stats.successRate * 1000) / 10,
      stats.tokensMedian === null ? '' : stats.tokensMedian,
      stats.tokensRange?.min ?? '',
      stats.tokensRange?.max ?? '',
      stats.toolsMedian === null ? '' : stats.toolsMedian,
      stats.wallMedian === null ? '' : stats.wallMedian,
    ].join(','))
  }
  return `${rows.join('\n')}\n`
}

/** @param {string[]} argv */
export function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      results: { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (values.results === undefined) {
    console.error('--results <results.jsonl> is required')
    return 2
  }
  const lines = readFileSync(values.results, 'utf8').split('\n').filter((line) => line.trim().length > 0)
  const rows = []
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line))
    } catch {
      // A torn final line is ignored and reported by row count.
    }
  }
  const summary = aggregate(rows)
  const outDir = values.out ?? path.dirname(values.results)
  mkdirSync(outDir, { recursive: true })
  const markdown = renderMarkdown(summary, { resultsFile: path.resolve(values.results) })
  writeFileSync(path.join(outDir, 'report.md'), markdown)
  writeFileSync(path.join(outDir, 'summary.csv'), renderCsv(summary))
  process.stdout.write(markdown)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
