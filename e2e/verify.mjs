/**
 * Offline end-to-end verification against a real DSH installation.
 *
 * Requires `DSH_INSTALL_DIR` (the @deepseek-ai/dsh package directory) and,
 * for the packaged Desktop build, `DSH_NODE_EXECUTABLE` (the Electron binary).
 * It creates a throwaway DSH_HOME, a `headless` profile, installs this plugin
 * plus a scripted LLM adapter, runs two real turns (coach and enforce), and
 * asserts the receipts and gating. No model account, network, or token spend.
 *
 * Usage: npm run e2e [-- --keep]
 * @module dsh-pressure/e2e/verify
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSessionLogs, findRunMetrics, metricsFromEvents, decodeSessionLog } from '../bench/metrics.mjs'
import { ReceiptStore } from '../src/receipts.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const installDir = process.env.DSH_INSTALL_DIR
const nodeExecutable = process.env.DSH_NODE_EXECUTABLE ?? process.execPath
const keep = process.argv.includes('--keep')

const cli = path.join(installDir ?? '', 'lib', 'bin.js')
const inAsar = cli.includes('.asar')

if (!installDir || (!inAsar && !existsSync(cli))) {
  console.error('e2e: DSH_INSTALL_DIR must point at the installed @deepseek-ai/dsh package.')
  console.error('     Desktop builds also need DSH_NODE_EXECUTABLE (the Electron binary).')
  process.exit(2)
}

const temp = mkdtempSync(path.join(os.tmpdir(), 'pressure-e2e-'))
const home = path.join(temp, 'home')
const work = path.join(temp, 'work')
mkdirSync(home, { recursive: true })
mkdirSync(work, { recursive: true })

/** @param {string[]} args @param {{ cwd?: string, timeout?: number }} [options] */
function runCli(args, options = {}) {
  const result = spawnSync(nodeExecutable, [cli, ...args], {
    cwd: options.cwd ?? temp,
    env: {
      ...process.env,
      DSH_HOME: home,
      ELECTRON_RUN_AS_NODE: '1',
    },
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`DSH exited ${result.status}: ${(result.stderr || result.stdout || '').slice(0, 2000)}`)
  }
  return result
}

/** @param {'coach' | 'enforce'} mode @param {number} toolCalls */
function writePatch(mode, toolCalls) {
  const profileDir = path.join(home, 'profiles', 'e2e')
  writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: fake-llm',
    '      name: dsh-fake-llm',
    '- id: agent-default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: fake',
    '    model: fake-1',
    '- id: dsh-pressure',
    '  name: dsh-pressure',
    '  config:',
    `    mode: ${mode}`,
    '    budget:',
    '      sessionTokens: 0',
    '      turnTokens: 0',
    `      turnToolCalls: ${toolCalls}`,
    '',
  ].join('\n'))
}

/** @param {string} prompt */
function headlessTurn(prompt) {
  const startedAt = Date.now()
  const result = runCli(['--profile', 'e2e', prompt], { cwd: work })
  const logs = findSessionLogs(home, { since: startedAt - 5000 })
  const found = findRunMetrics(logs, { cwd: work, since: startedAt - 5000 })
  assert.ok(found, 'the headless turn must leave a Session log')
  return {
    stdout: result.stdout.trim(),
    metrics: found.metrics,
    events: decodeSessionLog(found.file),
  }
}

/** @param {string} sessionId */
async function readReceipts(sessionId) {
  const store = new ReceiptStore({
    dataDir: path.join(home, 'squeeze'),
    retentionDays: 3650,
    maxReceiptsPerSession: 100_000,
    maxTotalBytes: 1_073_741_824,
    version: 'e2e',
    locale: () => 'en',
    logger: { warn: () => {} },
  })
  await store.open()
  try {
    return await store.readSession(sessionId)
  } finally {
    await store.close()
  }
}

/** @param {string} text @param {string} needle */
function assertContains(text, needle) {
  assert.ok(text.includes(needle), `expected output to contain ${JSON.stringify(needle)}`)
}

try {
  console.log('e2e: creating a throwaway headless profile')
  runCli(['--profile', 'e2e', '--from-default-profile', 'headless', '--dump-config'])
  runCli(['plugin', '--profile', 'e2e', 'add', repoRoot, path.join(repoRoot, 'e2e', 'fake-llm')])

  const profileDir = path.join(home, 'profiles', 'e2e')
  const manifest = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
  manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-pressure']
  writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log('e2e: coach turn (three failing reads)')
  writePatch('coach', 0)
  const coach = headlessTurn('Find missing.txt and report what you learned.')
  assertContains(coach.stdout, 'Stopped after three failing reads')
  assert.equal(coach.metrics.toolCalls, 3)
  assert.equal(coach.metrics.toolFailures, 3)
  const notices = coach.events.filter((event) => event.type === 'user/message' && event.data?.source?.kind === 'dsh-pressure')
  assert.equal(notices.length, 1, 'coach must append exactly one notice for the repeated code')
  assert.equal(notices[0].data.source.form, 'notice')
  const coachReceipts = await readReceipts(coach.metrics.sessionId)
  assert.equal(coachReceipts.length, 1)
  const coachReceipt = coachReceipts[0]
  assert.equal(coachReceipt.partial, false)
  assert.equal(coachReceipt.budget.mode, 'coach')
  assert.equal(coachReceipt.tools.calls, 3)
  assert.equal(coachReceipt.tools.failures, 3)
  assert.ok(coachReceipt.tokens.total > 0)
  assert.ok(coachReceipt.flags.some((flag) => flag.code === 'failure_streak'))
  assert.equal(coachReceipt.adviceKey, 'advice.inspectLastError')
  assert.equal(JSON.stringify(coachReceipt).includes('missing-'), false, 'receipt must not store tool arguments')
  console.log('e2e: PASS coach receipt + one notice')

  console.log('e2e: enforce turn (third call denied)')
  writePatch('enforce', 2)
  const enforce = headlessTurn('Find missing.txt and report what you learned.')
  assertContains(enforce.stdout, 'Stopped after three failing reads')
  const denied = enforce.events.filter((event) => event.type === 'tool/result'
    && event.data?.error?.code === 'budget_exhausted')
  assert.equal(denied.length, 1, 'exactly one call should be denied by the guard')
  assert.equal(denied[0].data.error.name, 'pressure')
  const enforceReceipts = await readReceipts(enforce.metrics.sessionId)
  assert.equal(enforceReceipts.length, 1)
  const enforceReceipt = enforceReceipts[0]
  assert.equal(enforceReceipt.budget.mode, 'enforce')
  assert.equal(enforceReceipt.budget.denied, 1)
  assert.equal(enforceReceipt.tools.calls, 3)
  assert.ok(enforceReceipt.flags.some((flag) => flag.code === 'budget_exhausted'))
  assert.equal(enforceReceipt.adviceKey, 'advice.toolsStopped')
  console.log('e2e: PASS enforce denial + receipt')
  console.log('')
  console.log(`e2e: OK (${temp})`)
} catch (error) {
  console.error(`e2e: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (!keep) rmSync(temp, { recursive: true, force: true })
  else console.error(`e2e: kept ${temp}`)
}
