/**
 * PressureService: binds live agents, folds session events, installs the tool
 * guard and the coach hook, and writes one receipt per turn.
 *
 * Nothing here calls a model, registers a model tool, or copies prompt/tool
 * text. The only model-visible effects are a coach notice appended to a tool
 * result and a guard denial string.
 * @module dsh-pressure/service
 */

import { randomUUID } from 'node:crypto'
import {
  createBudget,
  guardBreach,
  noteDenied,
  noteToolCall,
  setLimit,
  settleUsage,
  snapshot,
  startTurn,
} from './budget.js'
import { evaluateFlags, primaryAdvice } from './flags.js'
import { translator } from './locale.js'
import { buildReceipt, normalizeUsage, usageDelta } from './receipt.js'
import { createState, fold, repeatCount } from './stats.js'
import { estimateContentTokens, isFiniteNumber } from './util.js'

const SETTLED_TURNS_MEMORY = 200
const CONTEXT_SUMMARY_MAX_CHARS = 120

/**
 * @typedef {{
 *   sessionId: string,
 *   session: any,
 *   agent: any,
 *   state: import('./stats.js').PressureStatsState,
 *   budget: import('./budget.js').BudgetState,
 *   mode: 'observe' | 'coach' | 'enforce',
 *   baseline: { input: number, output: number, cacheRead: number, cacheWrite: number } | null,
 *   partial: boolean,
 *   peak: number | null,
 *   peakWindow: number | null,
 *   lastPressure: { pressureTokens: number | null, contextWindow: number | null } | null,
 *   observedLive: boolean,
 *   resultsSeen: number,
 *   notices: { turn: number, total: number, byCode: Set<string>, lastResults: number | null },
 *   muted: Set<string>,
 *   settledTurns: number[],
 *   lastReceipt: Record<string, any> | null,
 *   boundAt: number,
 *   lastEventAt: number,
 * }} Binding
 */

export class PressureService {
  /**
   * @param {{
   *   ctx: any,
   *   config: ReturnType<typeof import('./config.js').resolveConfig>,
   *   store: import('./receipts.js').ReceiptStore,
   *   locale: 'zh' | 'en',
   *   version: string,
   *   logger?: { warn?: (message: string) => void, info?: (message: string) => void },
   *   clock?: () => number,
   * }} options
   */
  constructor(options) {
    this.ctx = options.ctx
    this.config = options.config
    this.store = options.store
    this.locale = options.locale
    this.t = translator(options.locale)
    this.version = options.version
    this.logger = options.logger
    this.clock = options.clock ?? Date.now
    /** @type {Map<string, Binding>} */
    this.bindings = new Map()
    /** @type {(() => void)[]} */
    this.disposers = []
    this.disposed = false
    this.pressureWarned = false
  }

  /**
   * Install Cordis listeners and bind agents that already exist. Every
   * registration is an effect on the plugin fiber, so unloading cleans up.
   * @returns {void}
   */
  install() {
    this.disposers.push(this.ctx.on('agent/created', (payload) => {
      this.guardCall(() => this.bindAgent(payload?.agent))
    }))
    this.disposers.push(this.ctx.on('agent/disposed', (payload) => {
      this.guardCall(() => this.unbindAgent(payload?.agent))
    }))
    this.disposers.push(this.ctx.on('session/event', (session, event) => {
      this.guardCall(() => this.onSessionEvent(session, event))
    }))
    this.disposers.push(this.ctx.on('tools/post-execute', (exec, result, next) => this.postExecute(exec, result, next)))
    if (typeof this.ctx.tools?.guard === 'function') {
      this.disposers.push(this.ctx.tools.guard((exec) => this.guardCall(() => this.checkGuard(exec))))
    }
    const agents = this.ctx.get?.('agents')
    if (agents && typeof agents.list === 'function') {
      for (const agent of agents.list()) this.guardCall(() => this.bindAgent(agent))
    }
    this.logger?.info?.(`[pressure] service ready: mode=${this.config.mode} locale=${this.locale} bindings=${this.bindings.size}`)
  }

  /** Stop accepting work. Cordis owns listener disposal; this releases state. */
  dispose() {
    this.disposed = true
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose?.()
      } catch {
        // Already disposed by the fiber.
      }
    }
    this.bindings.clear()
  }

  /**
   * Bind one live agent. Missing optional services degrade instead of failing.
   * @param {any} agent
   */
  bindAgent(agent) {
    if (this.disposed || agent === null || agent === undefined) return
    const session = agent.session
    if (session === undefined || session === null) return
    const sessionId = String(session.id)
    if (sessionId.length === 0 || this.bindings.has(sessionId)) return
    const binding = /** @type {Binding} */ ({
      sessionId,
      session,
      agent,
      state: createState(sessionId),
      budget: createBudget(this.config.budget),
      mode: this.config.mode,
      baseline: null,
      partial: true,
      peak: null,
      peakWindow: null,
      lastPressure: null,
      observedLive: false,
      resultsSeen: 0,
      notices: { turn: 0, total: 0, byCode: new Set(), lastResults: null },
      muted: new Set(),
      settledTurns: [],
      lastReceipt: null,
      boundAt: this.clock(),
      lastEventAt: this.clock(),
    })
    this.bindings.set(sessionId, binding)
    // Read the official cumulative usage now: a turn that started before the
    // plugin loaded is marked partial so no historical figure is invented.
    const usage = this.readUsage(session)
    binding.baseline = usage.usage
    binding.partial = usage.usage === null
    this.logger?.info?.(`[pressure] bound session ${sessionId.slice(0, 12)}… partial=${binding.partial}`)
  }

  /**
   * @param {any} agent
   */
  unbindAgent(agent) {
    if (agent === null || agent === undefined) return
    const sessionId = String(agent.id ?? '')
    if (sessionId.length > 0) this.bindings.delete(sessionId)
  }

  /**
   * One committed Session event. Folding is synchronous and bounded; receipt
   * writes are fire-and-forget so the session loop never waits on disk.
   * @param {any} session
   * @param {any} event
   */
  onSessionEvent(session, event) {
    if (this.disposed || event === null || typeof event !== 'object') return
    const binding = this.bindings.get(String(session?.id ?? ''))
    if (binding === undefined) return
    binding.lastEventAt = typeof event.time === 'number' ? event.time : this.clock()

    if (event.type === 'turn/start') {
      binding.state = fold(binding.state, event)
      binding.budget = startTurn(binding.budget)
      binding.notices = { turn: binding.state.turn, total: 0, byCode: new Set(), lastResults: null }
      binding.resultsSeen = 0
      binding.peak = null
      binding.peakWindow = null
      binding.observedLive = false
      const usage = this.readUsage(binding.session)
      binding.baseline = usage.usage
      // A mid-turn (re)bind has no turn-start baseline; keep the receipt partial.
      binding.partial = usage.usage === null
      return
    }

    binding.state = fold(binding.state, event)

    if (event.type === 'step/end' || event.type === 'assistant/message') {
      this.samplePressure(binding)
    }

    if (event.type === 'turn/end') {
      this.samplePressure(binding)
      void this.finalizeTurn(binding, event).catch((error) => {
        this.logger?.warn?.(`[pressure] receipt failed: ${String(error?.message ?? error)}`)
      })
    }
  }

  /**
   * Sample official context pressure (O(1)) and remember this turn's peak.
   * @param {Binding} binding
   * @returns {{ pressureTokens: number | null, contextWindow: number | null } | null}
   */
  samplePressure(binding) {
    const tokenMeter = this.ctx.get?.('tokenMeter')
    if (tokenMeter === undefined || typeof tokenMeter.contextPressure !== 'function') return null
    try {
      const value = tokenMeter.contextPressure(binding.session) ?? {}
      const pressureTokens = isFiniteNumber(value.projectedTokens)
        ? value.projectedTokens
        : (isFiniteNumber(value.pressureTokens) ? value.pressureTokens : null)
      const contextWindow = isFiniteNumber(value.contextWindow) && value.contextWindow > 0 ? value.contextWindow : null
      binding.lastPressure = { pressureTokens, contextWindow }
      if (pressureTokens !== null && contextWindow !== null) {
        const ratio = pressureTokens / contextWindow
        binding.peak = binding.peak === null ? ratio : Math.max(binding.peak, ratio)
        binding.peakWindow = contextWindow
        binding.observedLive = true
      }
      return binding.lastPressure
    } catch (error) {
      if (!this.pressureWarned) {
        this.pressureWarned = true
        this.logger?.warn?.(`[pressure] tokenMeter.contextPressure failed: ${String(error?.message ?? error)}`)
      }
      return null
    }
  }

  /**
   * Build and persist the turn receipt.
   * @param {Binding} binding
   * @param {any} event
   * @returns {Promise<void>}
   */
  async finalizeTurn(binding, event) {
    const turn = Number.isInteger(event?.data?.turn) ? event.data.turn : binding.state.turn
    if (!Number.isInteger(turn) || turn < 1) return
    const usage = this.readUsage(binding.session)
    const delta = usageDelta(usage.usage, binding.baseline)

    const alreadySettled = binding.settledTurns.includes(turn)
    if (!alreadySettled && delta !== null) {
      binding.budget = settleUsage(binding.budget, delta)
      binding.settledTurns.push(turn)
      if (binding.settledTurns.length > SETTLED_TURNS_MEMORY) binding.settledTurns.shift()
    }

    const pressure = this.#contextInfo(binding)
    const flags = evaluateFlags({
      state: binding.state,
      turn,
      pressure: pressure.raw,
      budget: binding.budget,
      thresholds: this.config.thresholds,
    })
    const receipt = buildReceipt({
      sessionId: binding.sessionId,
      turn,
      state: binding.state,
      usage: delta,
      context: pressure.receipt,
      budget: { ...snapshot(binding.budget), mode: binding.mode },
      flags,
      adviceKey: primaryAdvice(flags),
      partial: binding.partial || delta === null,
      asOfSeq: usage.asOfSeq,
      version: this.version,
      now: this.clock(),
    })
    binding.lastReceipt = receipt
    const result = await this.store.appendReceipt(receipt)
    if (!result.written && result.reason !== 'idempotent') {
      this.logger?.warn?.(`[pressure] receipt skipped: ${result.reason ?? 'unknown'}`)
    }
    // A new turn will set its own baseline; keep this one until then.
    binding.baseline = usage.usage
  }

  /**
   * Guard hook: synchronous, denies only in enforce mode, and never before an
   * observed overrun. Returns a localized reason or undefined.
   * @param {any} exec
   * @returns {string | { reason: string, info: { name: string, code: string, reason: string } } | undefined}
   */
  checkGuard(exec) {
    if (this.disposed) return undefined
    const agent = exec?.agent
    if (agent === null || agent === undefined) return undefined
    const binding = this.bindings.get(String(agent.id ?? ''))
    if (binding === undefined) return undefined
    const breach = guardBreach({ mode: binding.mode }, binding.budget)
    if (breach === null) {
      binding.budget = noteToolCall(binding.budget)
      return undefined
    }
    binding.budget = noteDenied(binding.budget)
    const reason = this.t('denial.budget', {
      dimension: this.t(`denial.dimension.${breach.dimension}`),
      spent: breach.spent,
      limit: breach.limit,
    })
    return { reason, info: { name: 'pressure', code: 'budget_exhausted', reason } }
  }

  /**
   * Coach hook: observe-and-enrich. The notice rides `additionalContexts` so a
   * downstream block still receives it, mirroring the official reminder.
   * @param {any} exec
   * @param {any} result
   * @param {() => Promise<any>} next
   * @returns {Promise<any>}
   */
  async postExecute(exec, result, next) {
    const decision = await next()
    try {
      if (this.disposed || decision?.kind === 'block') return decision
      const agent = exec?.agent
      if (agent === null || agent === undefined) return decision
      const binding = this.bindings.get(String(agent.id ?? ''))
      if (binding === undefined || binding.mode === 'observe') return decision

      binding.resultsSeen += 1
      const text = this.#noticeText(binding, exec, result)
      if (text === null) return decision
      const notice = createNoticeMessage(text)
      return { ...decision, additionalContexts: [notice, ...(decision.additionalContexts ?? [])] }
    } catch (error) {
      this.logger?.warn?.(`[pressure] notice failed: ${String(error?.message ?? error)}`)
      return decision
    }
  }

  /**
   * Decide whether the current tool result deserves one short notice.
   * @param {Binding} binding
   * @param {any} exec
   * @param {any} result
   * @returns {string | null}
   */
  #noticeText(binding, exec, result) {
    if (binding.notices.turn !== binding.state.turn) {
      binding.notices = { turn: binding.state.turn, total: 0, byCode: new Set(), lastResults: null }
    }
    if (binding.notices.total >= this.config.coach.maxPerTurn) return null
    if (binding.notices.lastResults !== null && binding.resultsSeen <= binding.notices.lastResults + 1) return null

    const failed = result?.isError === true
    const consecutive = failed ? binding.state.turnTools.consecutiveFailures + 1 : 0
    const prospective = {
      ...binding.state,
      turnTools: {
        ...binding.state.turnTools,
        maxConsecutiveFailures: Math.max(binding.state.turnTools.maxConsecutiveFailures, consecutive),
      },
      tools: {
        ...binding.state.tools,
        maxResultEstTokens: Math.max(binding.state.tools.maxResultEstTokens, estimateContentTokens(result?.content)),
      },
    }
    const pressure = this.samplePressure(binding)
    const flags = evaluateFlags({
      state: prospective,
      turn: binding.state.turn,
      pressure,
      budget: binding.budget,
      thresholds: this.config.thresholds,
    })
    const candidate = flags.find((flag) => !binding.muted.has(flag.code) && !binding.notices.byCode.has(flag.code))
    if (candidate === undefined) return null

    const text = this.#renderNotice(candidate, binding, prospective)
    if (text === null) return null
    binding.notices.total += 1
    binding.notices.byCode.add(candidate.code)
    binding.notices.lastResults = binding.resultsSeen
    return text
  }

  /**
   * @param {import('./flags.js').PressureFlag} flag
   * @param {Binding} binding
   * @param {import('./stats.js').PressureStatsState} state
   * @returns {string | null}
   */
  #renderNotice(flag, binding, state) {
    const evidence = flag.evidence
    switch (flag.code) {
      case 'failure_streak':
        return this.t('notice.failureStreak', { turn: state.turn, count: evidence.consecutiveFailures ?? flag.count })
      case 'context_pressure':
        return this.t('notice.contextPressure', { percent: Math.round((Number(evidence.ratio) || 0) * 100) })
      case 'budget_pressure':
        return this.t('notice.budgetPressure', {
          percent: Math.round((Number(evidence.ratio) || 0) * 100),
          dimension: this.t(`denial.dimension.${String(evidence.dimension)}`),
          spent: evidence.spent ?? 0,
          limit: evidence.limit ?? 0,
        })
      case 'bloated_result':
        return this.t('notice.bloatedResult', { tokens: evidence.estimatedTokens ?? flag.count })
      case 'compaction_churn':
        return this.t('notice.compactionChurn', { count: evidence.compactions ?? flag.count })
      default:
        return null
    }
  }

  /**
   * Current context information for receipts and the live API.
   * @param {Binding} binding
   */
  #contextInfo(binding) {
    const end = this.samplePressure(binding)
    const endPressure = end !== null && isFiniteNumber(end.pressureTokens) && isFiniteNumber(end.contextWindow)
      ? end.pressureTokens / end.contextWindow
      : null
    const window = end?.contextWindow ?? binding.peakWindow
    if (binding.observedLive && binding.peak !== null) {
      return {
        raw: binding.lastPressure,
        receipt: {
          endPressure: endPressure === null ? null : round(endPressure),
          observedPeak: round(binding.peak),
          observedFrom: 'live',
          window,
        },
      }
    }
    return {
      raw: binding.lastPressure,
      receipt: {
        endPressure: endPressure === null ? null : round(endPressure),
        observedPeak: endPressure === null ? null : round(endPressure),
        observedFrom: endPressure === null ? 'unavailable' : 'end-only',
        window,
      },
    }
  }

  /**
   * Official cumulative token usage, or nulls when the projection is missing.
   * @param {any} session
   * @returns {{ usage: { input: number, output: number, cacheRead: number, cacheWrite: number } | null, asOfSeq: number | null }}
   */
  readUsage(session) {
    const projections = this.ctx.get?.('sessionProjections')
    if (projections === undefined || typeof projections.snapshot !== 'function') return { usage: null, asOfSeq: null }
    try {
      const snapshotValue = projections.snapshot(session, ['tokenUsage'])
      return {
        usage: normalizeUsage(snapshotValue?.values?.tokenUsage),
        asOfSeq: isFiniteNumber(snapshotValue?.asOfSeq) ? snapshotValue.asOfSeq : null,
      }
    } catch (error) {
      this.logger?.warn?.(`[pressure] tokenUsage snapshot failed: ${String(error?.message ?? error)}`)
      return { usage: null, asOfSeq: null }
    }
  }

  /**
   * Official whole-session stats, or null.
   * @param {any} session
   * @returns {any | null}
   */
  readStats(session) {
    const projections = this.ctx.get?.('sessionProjections')
    if (projections === undefined || typeof projections.snapshot !== 'function') return null
    try {
      return projections.snapshot(session, ['sessionStats'])?.values?.sessionStats ?? null
    } catch {
      return null
    }
  }

  /**
   * Most recently active live binding, used by a root-scoped panel that has no
   * Session binding of its own.
   * @returns {Record<string, any> | null}
   */
  latestLiveView() {
    let latest = null
    for (const binding of this.bindings.values()) {
      if (latest === null || binding.lastEventAt > latest.lastEventAt) latest = binding
    }
    return latest === null ? null : this.liveView(latest.sessionId)
  }

  /**
   * Live view for the HTTP API and commands.
   * @param {string} sessionId
   * @returns {Record<string, any> | null}
   */
  liveView(sessionId) {
    const binding = this.bindings.get(sessionId)
    if (binding === undefined) return null
    const pressure = this.samplePressure(binding)
    const usage = this.readUsage(binding.session)
    const stats = this.readStats(binding.session)
    const flags = evaluateFlags({
      state: binding.state,
      turn: binding.state.turn,
      pressure,
      budget: binding.budget,
      thresholds: this.config.thresholds,
    })
    return {
      sessionId,
      live: true,
      turn: binding.state.turn,
      step: binding.state.step,
      mode: binding.mode,
      locale: this.locale,
      partial: binding.partial,
      budget: snapshot(binding.budget),
      tools: {
        calls: binding.state.turnTools.total,
        failures: binding.state.turnTools.failed,
        repeats: repeatCount(binding.state),
        compactions: binding.state.turnCompactions,
        maxResultEstTokens: binding.state.tools.maxResultEstTokens,
      },
      context: {
        pressure: pressure !== null && isFiniteNumber(pressure.pressureTokens) && isFiniteNumber(pressure.contextWindow)
          ? pressure.pressureTokens / pressure.contextWindow
          : null,
        peak: binding.peak,
        window: pressure?.contextWindow ?? binding.peakWindow,
        observedFrom: binding.observedLive ? 'live' : (pressure === null ? 'unavailable' : 'end-only'),
      },
      tokens: usage.usage,
      stats,
      flags,
      lastReceipt: binding.lastReceipt,
      muted: [...binding.muted],
    }
  }

  /**
   * @param {string} sessionId
   * @returns {Binding | undefined}
   */
  bindingOf(sessionId) {
    return this.bindings.get(sessionId)
  }

  /**
   * @param {string} sessionId
   * @param {'observe' | 'coach' | 'enforce'} mode
   * @returns {boolean}
   */
  setMode(sessionId, mode) {
    const binding = this.bindings.get(sessionId)
    if (binding === undefined) return false
    const from = binding.mode
    binding.mode = mode
    void this.store.audit({ action: 'mode', sessionId, from, to: mode })
    return true
  }

  /**
   * @param {string} sessionId
   * @param {'sessionTokens' | 'turnTokens' | 'turnToolCalls'} dimension
   * @param {number} value
   * @returns {{ previous: number } | null}
   */
  setBudget(sessionId, dimension, value) {
    const binding = this.bindings.get(sessionId)
    if (binding === undefined) return null
    const previous = binding.budget.limits[dimension]
    binding.budget = setLimit(binding.budget, dimension, value)
    void this.store.audit({ action: `budget.${dimension}`, sessionId, from: previous, to: value })
    return { previous }
  }

  /**
   * @param {string} sessionId
   * @param {string} code
   * @param {boolean} muted
   * @returns {boolean}
   */
  mute(sessionId, code, muted) {
    const binding = this.bindings.get(sessionId)
    if (binding === undefined) return false
    if (muted) binding.muted.add(code)
    else binding.muted.delete(code)
    void this.store.audit({ action: muted ? 'mute' : 'unmute', sessionId, to: code })
    return true
  }

  /**
   * Guard one plugin hook invocation: a failure must never end a turn.
   * @template T
   * @param {() => T} operation
   * @returns {T | undefined}
   */
  guardCall(operation) {
    try {
      return operation()
    } catch (error) {
      this.logger?.warn?.(`[pressure] hook failed: ${String(error?.message ?? error)}`)
      return undefined
    }
  }
}

/**
 * Build a standard user-role context message without importing a Host package.
 * The shape matches `createUserMessage` output; the custom source kind is
 * load-bearing so derived history never renders it as a human prompt.
 * @param {string} text
 * @returns {any}
 */
export function createNoticeMessage(text) {
  const summary = `pressure: ${text.slice(0, CONTEXT_SUMMARY_MAX_CHARS - 10)}`
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([{ type: 'text', text }]),
    source: Object.freeze({
      kind: 'dsh-pressure',
      form: 'notice',
      summary: summary.slice(0, CONTEXT_SUMMARY_MAX_CHARS),
    }),
  })
}

/**
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Math.round(value * 1e6) / 1e6
}
