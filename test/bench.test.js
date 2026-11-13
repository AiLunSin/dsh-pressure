import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { aggregate, renderMarkdown } from '../bench/report.mjs'
import { metricsFromEvents } from '../bench/metrics.mjs'
import { GROUPS, materializeAll } from '../bench/plan.mjs'
import { materialize, TASKS, verify } from '../bench/tasks.mjs'

test('the pre-registered set has nine tasks, three per category', () => {
  assert.equal(TASKS.length, 9)
  assert.equal(new Set(TASKS.map((task) => task.id)).size, 9)
  for (const category of ['bugfix', 'feature', 'investigation']) {
    assert.equal(TASKS.filter((task) => task.category === category).length, 3)
  }
  assert.deepEqual(GROUPS.map((group) => group.id), ['A', 'B', 'C', 'D'])
})

test('every pristine task fails its own acceptance check', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pressure-bench-'))
  try {
    for (const task of TASKS) {
      const dir = path.join(root, task.id)
      materialize(task, dir)
      const result = verify(dir, 20_000)
      assert.equal(result.passed, false, `${task.id} must fail before any agent edits it`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('materializeAll writes workspaces and a plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pressure-plan-'))
  try {
    const created = materializeAll(root)
    assert.equal(created.length, 9)
    const plan = JSON.parse(await readFile(path.join(root, 'plan.json'), 'utf8'))
    assert.equal(plan.tasks.length, 9)
    assert.equal(plan.groups.length, 4)
    assert.match(await readFile(path.join(root, 'bugfix-offbyone', 'TASK.md'), 'utf8'), /node check\.mjs/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the runner refuses to spend tokens without --execute', () => {
  const result = spawnSync(process.execPath, ['bench/run.mjs', '--out', '.tmp/should-not-run'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /DRY RUN/u)
  assert.match(result.stdout, /runs: 108/u)
})

test('session metrics count usage, tools, failures, compactions, and wall time', () => {
  const events = [
    { type: 'session', id: 'session-x', cwd: 'C:/work', createdAt: 1000 },
    { type: 'turn/start', time: 2000, data: { turn: 1 } },
    { type: 'step/start', time: 2001, data: { turn: 1, step: 1 } },
    { type: 'tool/call', time: 2002, data: { callId: 'a', name: 'read', arguments: '{}' } },
    { type: 'tool/result', time: 2003, data: { message: { toolCallId: 'a', isError: false } } },
    { type: 'assistant/message', time: 2004, data: { usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50, cacheWriteTokens: 5 } } },
    { type: 'assistant/message', time: 2005, data: { usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 100 } } },
    { type: 'tool/call', time: 2006, data: { callId: 'b', name: 'pwsh', arguments: '{}' } },
    { type: 'tool/result', time: 2007, data: { message: { toolCallId: 'b', isError: true }, error: { code: 'EXIT_1' } } },
    { type: 'compaction/end', time: 2008, data: { compactionId: 'c', turn: 1 } },
    { type: 'step/end', time: 2009, data: { turn: 1, step: 1 } },
    { type: 'turn/end', time: 2500, data: { turn: 1 } },
  ]
  const metrics = metricsFromEvents(events)
  assert.equal(metrics.sessionId, 'session-x')
  assert.equal(metrics.cwd, 'C:/work')
  assert.equal(metrics.turns, 1)
  assert.equal(metrics.steps, 1)
  assert.equal(metrics.toolCalls, 2)
  assert.equal(metrics.toolFailures, 1)
  assert.equal(metrics.compactions, 1)
  assert.equal(metrics.tokens.input, 300)
  assert.equal(metrics.tokens.output, 30)
  assert.equal(metrics.tokens.cacheRead, 150)
  assert.equal(metrics.tokens.cacheWrite, 5)
  assert.equal(metrics.tokens.total, 485)
  assert.equal(metrics.tokens.cacheHitRate, 0.32967)
  assert.equal(metrics.wallMs, 500)
  assert.equal(JSON.stringify(metrics).includes('read'), false)
})

test('report aggregation computes medians, deltas, and warnings honestly', () => {
  const rows = []
  const metrics = (tokens, tools) => ({ tokens: { total: tokens }, toolCalls: tools, wallMs: 1000 })
  for (const [rep, tokens] of [[1, 1000], [2, 2000]]) {
    rows.push({ group: 'A', task: 'bugfix-offbyone', rep, passed: true, metrics: metrics(tokens, 10) })
    rows.push({ group: 'B', task: 'bugfix-offbyone', rep, passed: true, metrics: metrics(tokens, 8) })
    rows.push({ group: 'C', task: 'bugfix-offbyone', rep, passed: true, metrics: metrics(tokens / 2, 8) })
  }
  rows.push({ group: 'A', task: 'feature-slug', rep: 1, passed: true, metrics: metrics(3000, 12) })
  rows.push({ group: 'B', task: 'feature-slug', rep: 1, passed: false, metrics: metrics(3000, 12) })
  const summary = aggregate(rows)
  assert.equal(summary.groupStats.A.successRate, 1)
  assert.ok(Math.abs(summary.groupStats.B.successRate - 2 / 3) < 1e-9)
  assert.equal(summary.groupStats.A.tokensMedian, 2000)
  assert.equal(summary.groupStats.B.tokensMedian, 2000)
  assert.equal(summary.deltas.C.tokensDelta, -62.5)
  assert.ok(Math.abs(summary.deltas.B.successDelta - (-33.3333333333333)) < 0.01)
  assert.ok(summary.warnings.some((warning) => warning.includes('no runs recorded')))
  const markdown = renderMarkdown(summary, { resultsFile: 'results.jsonl', now: 0 })
  assert.match(markdown, /Change vs baseline A/u)
  assert.match(markdown, /Warnings/u)
})
