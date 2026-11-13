import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudget, setLimit } from '../src/budget.js'
import { createSqueezeCommand } from '../src/commands.js'
import { createState, fold } from '../src/stats.js'

const SESSION = 'sess_cmd'

function harness() {
  let state = createState(SESSION)
  state = fold(state, { type: 'turn/start', data: { turn: 2 }, time: 1000, seq: 1 })
  state = fold(state, { type: 'tool/call', data: { turn: 2, step: 1, callId: 'c', name: 'read', arguments: '{}' }, time: 1001, seq: 2 })
  state = fold(state, { type: 'tool/result', data: { turn: 2, step: 1, message: { toolCallId: 'c', isError: true, content: [] } }, time: 1002, seq: 3 })
  const binding = {
    sessionId: SESSION,
    state,
    mode: 'observe',
    budget: createBudget({ sessionTokens: 20000, turnTokens: 0, turnToolCalls: 5 }),
    muted: new Set(),
  }
  const receipt = {
    turn: 2,
    tokens: { total: 1234, cacheHitRate: 0.25 },
    tools: { calls: 1, failures: 1 },
    flags: [{ code: 'failure_streak', severity: 'warn', count: 1 }],
    adviceKey: 'advice.inspectLastError',
  }
  const calls = { audits: [], purged: 0, modes: [], budgets: [] }
  const service = {
    bindingOf: (id) => (id === SESSION ? binding : undefined),
    liveView: (id) => (id === SESSION
      ? { flags: [{ code: 'failure_streak', severity: 'warn', count: 1, adviceKey: 'advice.inspectLastError' }] }
      : null),
    setMode: (id, mode) => {
      if (id !== SESSION) return false
      binding.mode = mode
      calls.modes.push(mode)
      return true
    },
    setBudget: (id, dimension, value) => {
      if (id !== SESSION) return null
      const previous = binding.budget.limits[dimension]
      binding.budget = setLimit(binding.budget, dimension, value)
      calls.budgets.push([dimension, value])
      return { previous }
    },
    mute: (id, code, muted) => {
      if (id !== SESSION) return false
      if (muted) binding.muted.add(code)
      else binding.muted.delete(code)
      return true
    },
  }
  const store = {
    receiptCount: () => 3,
    listReceipts: async () => ({ receipts: [receipt], nextCursor: null }),
    getReceipt: async (_id, turn) => (turn === 2 ? receipt : null),
    purgeSession: async () => {
      calls.purged += 1
      return 2
    },
    audit: async (entry) => { calls.audits.push(entry) },
  }
  const command = createSqueezeCommand({ service, store, locale: 'en' })
  /** @param {string} rawInput @param {string} [agent] */
  const run = (rawInput, agent = SESSION) => command.handler({ agent: { id: agent }, rawInput })
  return { command, run, binding, calls, receipt }
}

test('status reports mode, budgets, calls, signals, and receipts', async () => {
  const { run } = harness()
  const result = await run('status')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /mode=observe/u)
  assert.match(result.text, /session 0\/20,000/u)
  assert.match(result.text, /tools 0\/5/u)
  assert.match(result.text, /flags 1/u)
  assert.match(result.text, /receipts 3/u)
  assert.equal((await run('')).kind, 'success')
})

test('mode validates and takes effect immediately', async () => {
  const { run, binding, calls } = harness()
  const ok = await run('mode enforce')
  assert.equal(ok.kind, 'success')
  assert.equal(binding.mode, 'enforce')
  assert.deepEqual(calls.modes, ['enforce'])
  const bad = await run('mode turbo')
  assert.equal(bad.kind, 'error')
  assert.match(bad.text, /observe, coach, or enforce/u)
})

test('budget accepts session, turn, and tools scopes only', async () => {
  const { run, binding } = harness()
  assert.equal((await run('budget session 100000')).kind, 'success')
  assert.equal(binding.budget.limits.sessionTokens, 100000)
  assert.equal((await run('budget turn 500')).kind, 'success')
  assert.equal(binding.budget.limits.turnTokens, 500)
  assert.equal((await run('budget tools 9')).kind, 'success')
  assert.equal(binding.budget.limits.turnToolCalls, 9)
  assert.equal((await run('budget tools abc')).kind, 'error')
  assert.equal((await run('budget weekly 3')).kind, 'error')
})

test('report renders the latest or a requested turn', async () => {
  const { run } = harness()
  const latest = await run('report')
  assert.equal(latest.kind, 'success')
  assert.match(latest.text, /Receipt · turn 2/u)
  assert.match(latest.text, /1,234/u)
  assert.match(latest.text, /25%/u)
  const missing = await run('report 9')
  assert.equal(missing.kind, 'error')
  const invalid = await run('report nope')
  assert.equal(invalid.kind, 'error')
})

test('flags, mute, and unmute follow the signal codes', async () => {
  const { run, binding } = harness()
  const flags = await run('flags')
  assert.equal(flags.kind, 'success')
  assert.match(flags.text, /failure_streak ×1/u)
  assert.equal((await run('mute failure_streak')).kind, 'success')
  assert.equal(binding.muted.has('failure_streak'), true)
  assert.equal((await run('unmute failure_streak')).kind, 'success')
  assert.equal(binding.muted.has('failure_streak'), false)
  assert.equal((await run('mute not_a_signal')).kind, 'error')
})

test('purge requires --yes and refuses --all in v0.1', async () => {
  const { run, calls } = harness()
  const missing = await run('purge')
  assert.equal(missing.kind, 'error')
  assert.match(missing.text, /--yes/u)
  assert.equal((await run('purge --all --yes')).kind, 'error')
  const done = await run('purge --yes')
  assert.equal(done.kind, 'success')
  assert.match(done.text, /2 receipt/u)
  assert.equal(calls.purged, 1)
})

test('unknown subcommands and inactive sessions return actionable text', async () => {
  const { run } = harness()
  const unknown = await run('teleport')
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /Usage:/u)
  const inactive = await run('status', 'sess_other')
  assert.equal(inactive.kind, 'error')
  assert.match(inactive.text, /not active/u)
})
