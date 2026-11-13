/**
 * `/squeeze` command family. Commands never enter the model context: the Host
 * records command events and returns text to the command UI only.
 * @module dsh-pressure/commands
 */

import { FLAG_CODES } from './flags.js'
import { translator } from './locale.js'

const BUDGET_DIMENSIONS = Object.freeze({
  session: 'sessionTokens',
  turn: 'turnTokens',
  tools: 'turnToolCalls',
})

/**
 * @param {{
 *   service: import('./service.js').PressureService,
 *   store: import('./receipts.js').ReceiptStore,
 *   locale: 'zh' | 'en',
 * }} options
 * @returns {{ name: string, description: string, handler: (invocation: any) => Promise<{ kind: 'success' | 'error', text: string }> }}
 */
export function createSqueezeCommand(options) {
  const { service, store, locale } = options
  const t = translator(locale)
  const numberFormat = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US')
  /** @param {number} value */
  const fmt = (value) => numberFormat.format(value)

  return {
    name: 'squeeze',
    description: 'Show and adjust the dsh-pressure budget and signals for this session',
    async handler(invocation) {
      try {
        return await handle(invocation)
      } catch (error) {
        return { kind: 'error', text: `dsh-pressure: ${String(error?.message ?? error)}` }
      }
    },
  }

  /** @param {any} invocation */
  async function handle(invocation) {
    const sessionId = String(invocation?.agent?.id ?? '')
    const tokens = String(invocation?.rawInput ?? '').trim().split(/\s+/u).filter((token) => token.length > 0)
    const [verb, ...args] = tokens

    if (verb === undefined || verb === 'status') return status(sessionId)
    if (verb === 'report') return report(sessionId, args[0])
    if (verb === 'mode') return mode(sessionId, args[0])
    if (verb === 'budget') return budget(sessionId, args[0], args[1])
    if (verb === 'flags') return flags(sessionId)
    if (verb === 'mute' || verb === 'unmute') return mute(sessionId, args[0], verb === 'mute')
    if (verb === 'purge') return purge(sessionId, args)
    return usageError()
  }

  /** @param {string} sessionId */
  async function status(sessionId) {
    const binding = service.bindingOf(sessionId)
    if (binding === undefined) return { kind: 'error', text: t('command.noBinding') }
    const live = service.liveView(sessionId)
    const flags = live?.flags ?? []
    const receipts = store.receiptCount(sessionId)
    const budgetState = binding.budget
    return {
      kind: 'success',
      text: t('command.status', {
        mode: binding.mode,
        sessionSpent: fmt(budgetState.sessionSpent),
        sessionLimit: limitText(budgetState.limits.sessionTokens),
        turnSpent: fmt(budgetState.turnSpent),
        turnLimit: limitText(budgetState.limits.turnTokens),
        turnCalls: fmt(budgetState.turnCalls),
        toolLimit: limitText(budgetState.limits.turnToolCalls),
        flags: flags.length,
        receipts: fmt(receipts),
      }),
    }
  }

  /**
   * @param {string} sessionId
   * @param {string | undefined} target
   */
  async function report(sessionId, target) {
    const turn = target === undefined ? null : Number(target)
    if (turn !== null && (!Number.isInteger(turn) || turn < 1)) {
      return { kind: 'error', text: `${t('command.invalidNumber', { value: String(target) })}\n${t('command.usage')}` }
    }
    let receipt = null
    if (turn === null) {
      const list = await store.listReceipts(sessionId, { limit: 1 })
      receipt = list.receipts[0] ?? null
    } else {
      receipt = await store.getReceipt(sessionId, turn)
    }
    if (receipt === null) {
      return { kind: 'error', text: t('command.reportEmpty', { target: turn === null ? 'latest turn' : `turn ${turn}` }) }
    }
    const lines = [
      t('command.reportTitle', { target: `turn ${receipt.turn}` }),
      t('command.reportLine', {
        total: receipt.tokens?.total === null || receipt.tokens?.total === undefined ? t('export.unknown') : fmt(receipt.tokens.total),
        cache: receipt.tokens?.cacheHitRate === null || receipt.tokens?.cacheHitRate === undefined
          ? t('export.unknown')
          : `${Math.round(receipt.tokens.cacheHitRate * 1000) / 10}%`,
        calls: fmt(receipt.tools?.calls ?? 0),
        failures: fmt(receipt.tools?.failures ?? 0),
        signals: receipt.flags?.length ?? 0,
      }),
      `${t('export.advice')}: ${t(receipt.adviceKey ?? 'advice.none')}`,
    ]
    return { kind: 'success', text: lines.join('\n') }
  }

  /**
   * @param {string} sessionId
   * @param {string | undefined} value
   */
  function mode(sessionId, value) {
    if (value === undefined || !['observe', 'coach', 'enforce'].includes(value)) {
      return { kind: 'error', text: t('command.invalidMode', { value: String(value) }) }
    }
    if (!service.setMode(sessionId, /** @type {'observe'|'coach'|'enforce'} */ (value))) {
      return { kind: 'error', text: t('command.noBinding') }
    }
    return { kind: 'success', text: t('command.modeSet', { mode: value }) }
  }

  /**
   * @param {string} sessionId
   * @param {string | undefined} scope
   * @param {string | undefined} rawValue
   */
  function budget(sessionId, scope, rawValue) {
    const dimension = scope === undefined ? undefined : BUDGET_DIMENSIONS[scope]
    if (dimension === undefined) {
      return { kind: 'error', text: `Unknown budget scope "${String(scope)}".\n${t('command.usage')}` }
    }
    const value = rawValue === undefined ? Number.NaN : Number(rawValue)
    if (!Number.isInteger(value) || value < 0 || value > 1e9) {
      return { kind: 'error', text: t('command.invalidNumber', { value: String(rawValue) }) }
    }
    if (service.setBudget(sessionId, dimension, value) === null) {
      return { kind: 'error', text: t('command.noBinding') }
    }
    return {
      kind: 'success',
      text: t('command.budgetSet', { dimension: t(`denial.dimension.${dimension}`), value }),
    }
  }

  /** @param {string} sessionId */
  function flags(sessionId) {
    const live = service.liveView(sessionId)
    if (live === null) return { kind: 'error', text: t('command.noBinding') }
    if (live.flags.length === 0) return { kind: 'success', text: t('command.flagsEmpty') }
    return {
      kind: 'success',
      text: live.flags.map((flag) => t('command.flagsLine', {
        code: flag.code,
        count: flag.count,
        severity: flag.severity,
        advice: t(flag.adviceKey),
      })).join('\n'),
    }
  }

  /**
   * @param {string} sessionId
   * @param {string | undefined} code
   * @param {boolean} muted
   */
  function mute(sessionId, code, muted) {
    if (code === undefined || !FLAG_CODES.includes(code)) {
      return { kind: 'error', text: t('command.unknownCode', { code: String(code) }) }
    }
    if (!service.mute(sessionId, code, muted)) return { kind: 'error', text: t('command.noBinding') }
    return { kind: 'success', text: t(muted ? 'command.muted' : 'command.unmuted', { code }) }
  }

  /**
   * @param {string} sessionId
   * @param {string[]} args
   */
  async function purge(sessionId, args) {
    if (args.includes('--all')) return { kind: 'error', text: t('command.purgeAllNotSupported') }
    if (args.length !== 1 || args[0] !== '--yes') {
      return { kind: 'error', text: t('command.purgeNeedsYes') }
    }
    const removed = await store.purgeSession(sessionId)
    await store.audit({ action: 'purge', sessionId, to: removed })
    return { kind: 'success', text: t('command.purged', { n: removed }) }
  }

  /** @returns {{ kind: 'error', text: string }} */
  function usageError() {
    return { kind: 'error', text: t('command.usage') }
  }

  /**
   * @param {number} value
   * @returns {string}
   */
  function limitText(value) {
    return value > 0 ? fmt(value) : t('command.limitNone')
  }
}
