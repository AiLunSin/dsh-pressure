/**
 * Pre-registered benchmark plan. Prints the matrix and preparation commands;
 * `--materialize <dir>` writes all nine task workspaces for inspection.
 * @module dsh-pressure/bench/plan
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { materialize, TASKS } from './tasks.mjs'

export const GROUPS = Object.freeze([
  { id: 'A', name: 'baseline', plugin: false, mode: null, description: 'official DSH plugins only, no dsh-pressure' },
  { id: 'B', name: 'observe', plugin: true, mode: 'observe', description: 'dsh-pressure, records only' },
  { id: 'C', name: 'coach', plugin: true, mode: 'coach', description: 'dsh-pressure, default thresholds' },
  { id: 'D', name: 'enforce', plugin: true, mode: 'enforce', description: 'dsh-pressure, session token budget = baseline median × 0.8' },
])

export const METRICS = Object.freeze([
  ['success', 'acceptance `node check.mjs` exits 0'],
  ['tokens', 'sum of provider usage in assistant messages'],
  ['toolCalls', 'count of tool/call events'],
  ['toolFailures', 'tool/result with isError or error'],
  ['wallMs', 'first turn/start to last event in the session log'],
])

/**
 * @param {string} dir
 * @returns {string[]} created workspace directories
 */
export function materializeAll(dir) {
  const created = []
  for (const task of TASKS) {
    const target = path.join(dir, task.id)
    materialize(task, target)
    created.push(target)
  }
  writeFileSync(path.join(dir, 'plan.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    tasks: TASKS.map((task) => ({ id: task.id, category: task.category, title: task.title, prompt: task.prompt })),
    groups: GROUPS,
    metrics: METRICS,
    repetitions: 3,
  }, null, 2)}\n`)
  return created
}

/**
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function preparationCommands(repoRoot) {
  const lines = []
  lines.push('# group A (baseline): use the shipped headless profile as-is')
  lines.push('dsh --profile headless "benchmark smoke"   # verifies the model route and creates the log')
  for (const group of GROUPS.filter((entry) => entry.plugin)) {
    const profile = `pressure-${group.id.toLowerCase()}`
    lines.push('')
    lines.push(`# group ${group.id} (${group.name})`)
    lines.push(`dsh --profile ${profile} --from-default-profile headless --dump-config > $null`)
    lines.push(`dsh plugin --profile ${profile} add "${repoRoot}"`)
    lines.push(`# then set mode: ${group.mode} on the patch row (id: dsh-pressure)`)
  }
  lines.push('')
  lines.push('# D: set budget.sessionTokens to the baseline median × 0.8 before running')
  return lines
}

/** @param {string[]} args */
export function main(args) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const materializeIndex = args.indexOf('--materialize')
  const materializeDir = materializeIndex >= 0 ? args[materializeIndex + 1] : null
  console.log('DSH Pressure benchmark plan (pre-registered)')
  console.log('')
  console.log(`tasks: ${TASKS.length} (${countByCategory()})`)
  console.log(`groups: ${GROUPS.map((group) => `${group.id}=${group.name}`).join(' · ')}`)
  console.log('repetitions: 3 per task × group (fixed prompt, repository, and model route)')
  console.log('')
  console.log('| id | category | title |')
  console.log('|---|---|---|')
  for (const task of TASKS) console.log(`| ${task.id} | ${task.category} | ${task.title} |`)
  console.log('')
  console.log('Preparation:')
  for (const line of preparationCommands(repoRoot)) console.log(line)
  if (materializeDir !== null) {
    const created = materializeAll(path.resolve(materializeDir))
    console.log('')
    console.log(`materialized ${created.length} workspaces under ${path.resolve(materializeDir)}`)
    console.log('Each pristine workspace must fail `node check.mjs`; the test suite asserts that.')
  } else {
    console.log('')
    console.log('Pass --materialize <dir> to write the workspaces for inspection.')
  }
  return 0
}

/** @returns {string} */
function countByCategory() {
  const counts = {}
  for (const task of TASKS) counts[task.category] = (counts[task.category] ?? 0) + 1
  return Object.entries(counts).map(([category, count]) => `${category} ${count}`).join(', ')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
