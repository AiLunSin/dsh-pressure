/**
 * Benchmark runner. Requires --execute because every run spends tokens.
 *
 * Design:
 *  - groups A..D run the same nine tasks with the same prompt and repetition.
 *  - the Session log provides metrics for every group, including baseline A
 *    (which has no dsh-pressure receipt).
 *  - B/C/D additionally read dsh-pressure receipts for cross-checking.
 *  - nothing but metadata is persisted: exit status, acceptance output,
 *    numeric metrics, and receipts. No prompt or tool text is stored.
 * @module dsh-pressure/bench/run
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ReceiptStore } from '../src/receipts.js'
import { GROUPS } from './plan.mjs'
import { findRunMetrics, findSessionLogs } from './metrics.mjs'
import { materialize, taskById, TASKS, verify } from './tasks.mjs'

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseProfiles(text) {
  const profiles = {}
  for (const entry of text.split(',')) {
    const [group, profile] = entry.split('=')
    if (group && profile) profiles[group.trim().toUpperCase()] = profile.trim()
  }
  return profiles
}

/**
 * Deterministic shuffle so run order is fixed by seed.
 * @template T
 * @param {T[]} items
 * @param {number} seed
 * @returns {T[]}
 */
function shuffle(items, seed) {
  const copy = items.slice()
  let state = seed >>> 0
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    const swap = state % (index + 1)
    const value = copy[index]
    copy[index] = copy[swap]
    copy[swap] = value
  }
  return copy
}

/**
 * @param {import('../src/receipts.js').ReceiptStore} store
 * @param {string[]} sessionIds
 */
async function receiptSummary(store, sessionIds) {
  const receipts = []
  for (const sessionId of sessionIds) {
    try {
      receipts.push(...await store.readSession(sessionId))
    } catch {
      // A missing receipt directory is a valid empty result.
    }
  }
  if (receipts.length === 0) return null
  return {
    count: receipts.length,
    tokensTotal: receipts.reduce((sum, receipt) => sum + (receipt.tokens?.total ?? 0), 0),
    toolCalls: receipts.reduce((sum, receipt) => sum + (receipt.tools?.calls ?? 0), 0),
    toolFailures: receipts.reduce((sum, receipt) => sum + (receipt.tools?.failures ?? 0), 0),
    flags: [...new Set(receipts.flatMap((receipt) => (receipt.flags ?? []).map((flag) => flag.code)))],
    modes: [...new Set(receipts.map((receipt) => receipt.budget?.mode).filter(Boolean))],
    denied: receipts.reduce((sum, receipt) => sum + (receipt.budget?.denied ?? 0), 0),
  }
}

/**
 * The Desktop build hides the CLI inside app.asar, which only Electron's
 * patched fs can read; plain Node works for npm/source installations.
 * @returns {string}
 */
function resolveNodeExecutable() {
  const electron = process.env.DSH_NODE_EXECUTABLE
  if (typeof electron === 'string' && electron.length > 0 && existsSync(electron)) return electron
  return process.execPath
}

/** @param {string[]} argv */
export async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      groups: { type: 'string', default: 'A,B,C,D' },
      tasks: { type: 'string' },
      reps: { type: 'string', default: '3' },
      profiles: { type: 'string' },
      'dsh-home': { type: 'string' },
      cli: { type: 'string' },
      seed: { type: 'string', default: '20261113' },
      timeout: { type: 'string', default: '600000' },
      execute: { type: 'boolean', default: false },
    },
  })

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const groupIds = values.groups.split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean)
  const groups = GROUPS.filter((group) => groupIds.includes(group.id))
  const taskIds = values.tasks === undefined ? TASKS.map((task) => task.id) : values.tasks.split(',').map((entry) => entry.trim())
  const tasks = taskIds.map((id) => taskById(id)).filter(Boolean)
  const reps = Math.max(1, Number.parseInt(values.reps, 10) || 3)
  const seed = Number.parseInt(values.seed, 10) || 20261113
  const timeout = Math.max(30_000, Number.parseInt(values.timeout, 10) || 600_000)
  const profiles = parseProfiles(values.profiles ?? 'A=headless,B=pressure-b,C=pressure-c,D=pressure-d')

  if (groups.length === 0 || tasks.length === 0) {
    console.error('No groups or tasks selected.')
    return 2
  }
  for (const group of groups) {
    if (profiles[group.id] === undefined) {
      console.error(`Missing profile for group ${group.id}; pass --profiles A=...,B=...`)
      return 2
    }
  }

  const plan = shuffle(
    groups.flatMap((group) => tasks.flatMap((task) => Array.from({ length: reps }, (_, index) => ({ group, task, rep: index + 1 })))),
    seed,
  )

  if (!values.execute) {
    const nodeExecutable = resolveNodeExecutable()
    console.log('DRY RUN — pass --execute to spend tokens.')
    console.log(`runs: ${plan.length} (${groups.length} groups × ${tasks.length} tasks × ${reps} reps)`)
    console.log(`profiles: ${groups.map((group) => `${group.id}=${profiles[group.id]}`).join(' ')}`)
    const cli = values.cli ?? path.join(process.env.DSH_INSTALL_DIR ?? '<DSH_INSTALL_DIR>', 'lib', 'bin.js')
    console.log(`runtime: ${nodeExecutable}${nodeExecutable === process.execPath ? '' : ' (ELECTRON_RUN_AS_NODE=1)'}`)
    console.log('')
    console.log('First commands:')
    for (const item of plan.slice(0, 3)) {
      console.log(`  ${nodeExecutable} "${cli}" --profile ${profiles[item.group.id]} "TASK PROMPT"`)
      console.log(`    cwd=${path.join(values.out ?? '<out>', item.task.id, item.group.id + '-' + item.rep)}`)
    }
    return 0
  }

  if (values.out === undefined || values['dsh-home'] === undefined) {
    console.error('--out and --dsh-home are required with --execute.')
    return 2
  }
  const dshHome = path.resolve(values['dsh-home'])
  const out = path.resolve(values.out)
  const cli = path.resolve(values.cli ?? path.join(process.env.DSH_INSTALL_DIR ?? '', 'lib', 'bin.js'))
  const nodeExecutable = resolveNodeExecutable()
  if (!existsSync(cli)) {
    console.error(`CLI not found: ${cli} (pass --cli or set DSH_INSTALL_DIR)`)
    return 2
  }

  mkdirSync(out, { recursive: true })
  const resultsFile = path.join(out, 'results.jsonl')
  writeFileSync(resultsFile, '')
  writeFileSync(path.join(out, 'environment.json'), `${JSON.stringify({
    startedAt: new Date().toISOString(),
    repoRoot,
    cli,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    dshHome,
    seed,
    reps,
    groups: groups.map((group) => group.id),
    tasks: tasks.map((task) => task.id),
    profiles,
  }, null, 2)}\n`)

  const store = new ReceiptStore({
    dataDir: path.join(dshHome, 'squeeze'),
    retentionDays: 3650,
    maxReceiptsPerSession: 100000,
    maxTotalBytes: 1073741824,
    version: 'bench',
    locale: () => 'en',
    logger: { warn: () => {} },
  })
  await store.open()

  console.log(`executing ${plan.length} runs into ${out}`)
  let failures = 0
  for (const [index, item] of plan.entries()) {
    const label = `[${index + 1}/${plan.length}] ${item.group.id} ${item.task.id} rep${item.rep}`
    console.log(`${label} …`)
    const workspace = path.join(out, 'workspaces', item.task.id, `${item.group.id}-${item.rep}`)
    materialize(item.task, workspace)
    const startedAt = Date.now()
    const run = spawnSync(nodeExecutable, [cli, '--profile', profiles[item.group.id], item.task.prompt], {
      cwd: workspace,
      env: {
        ...process.env,
        DSH_HOME: dshHome,
        ...(nodeExecutable === process.execPath ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
      },
      encoding: 'utf8',
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    })
    const durationMs = Date.now() - startedAt
    const acceptance = verify(workspace)
    if (!acceptance.passed) failures += 1

    const metrics = findRunMetrics(findSessionLogs(dshHome, { since: startedAt - 5000 }), {
      cwd: workspace,
      since: startedAt - 5000,
    })
    const receipts = item.group.plugin && metrics !== null
      ? await receiptSummary(store, [metrics.metrics.sessionId].filter(Boolean))
      : null
    const row = {
      at: new Date().toISOString(),
      group: item.group.id,
      mode: item.group.mode,
      task: item.task.id,
      category: item.task.category,
      rep: item.rep,
      exitCode: run.status,
      timedOut: run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGTERM',
      durationMs,
      passed: acceptance.passed,
      acceptance: acceptance.output.slice(-2000),
      metrics: metrics?.metrics ?? null,
      receipts,
    }
    appendFileSync(resultsFile, `${JSON.stringify(row)}\n`)
    console.log(`   ${acceptance.passed ? 'PASS' : 'FAIL'} · ${durationMs} ms · tokens=${row.metrics?.tokens.total ?? 'n/a'} tools=${row.metrics?.toolCalls ?? 'n/a'}`)
  }
  await store.close()
  writeFileSync(path.join(out, 'done.json'), `${JSON.stringify({
    finishedAt: new Date().toISOString(),
    runs: plan.length,
    failedRuns: failures,
    resultsFile,
  }, null, 2)}\n`)
  console.log('')
  console.log(`done: ${plan.length - failures}/${plan.length} acceptance passes; results=${resultsFile}`)
  console.log('Next: node bench/report.mjs --results ' + resultsFile + ' --out ' + out)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
