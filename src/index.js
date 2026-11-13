/**
 * dsh-pressure Host entry.
 *
 * A loop-governance plugin for DeepSeek Harness: it measures each turn, turns
 * the numbers into evidenced signals, and — only when the user opts in —
 * brakes new tool calls once an observed budget overrun exists. It never calls
 * a model, never registers a model tool, and never stores prompt or tool text.
 * @module dsh-pressure
 */

import { readFileSync } from 'node:fs'
import { createSqueezeCommand } from './commands.js'
import { resolveConfig } from './config.js'
import { API_PREFIX, createNodeHandler } from './http.js'
import { resolveHostLocale } from './locale.js'
import { ReceiptStore } from './receipts.js'
import { PressureService } from './service.js'
import { resolveDataDir } from './util.js'

export const name = 'dsh-pressure'

/**
 * `tools` is the only hard dependency: the guard and the coach hook live on it.
 * Everything else (projections, token meter, commands, web server) is optional
 * and degrades to "unavailable" instead of blocking activation.
 */
export const inject = ['tools']

const VERSION = readVersion()

/** @returns {string} */
function readVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * @param {any} ctx Cordis Host context
 * @param {unknown} rawConfig profile config for this row
 * @returns {Promise<void>}
 */
export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const locale = resolveHostLocale(config)
  const dataDir = resolveDataDir(config.storage)

  // Failing loudly here is deliberate: an unusable data directory is a
  // configuration problem the user must see, while hook failures below only
  // warn so a session is never blocked.
  const store = new ReceiptStore({
    dataDir,
    retentionDays: config.storage.retentionDays,
    maxReceiptsPerSession: config.storage.maxReceiptsPerSession,
    maxTotalBytes: config.storage.maxTotalBytes,
    version: VERSION,
    locale: () => locale,
    logger: ctx.logger,
  })
  await store.open()
  ctx.effect(() => () => store.close())

  const service = new PressureService({
    ctx,
    config,
    store,
    locale,
    version: VERSION,
    logger: ctx.logger,
  })
  service.install()
  ctx.effect(() => () => service.dispose())

  const commands = ctx.get('commands')
  if (commands !== undefined && typeof commands.register === 'function') {
    const definition = createSqueezeCommand({ service, store, locale })
    ctx.effect(() => commands.register(definition))
  }

  const webServer = ctx.get('webServer')
  if (config.http.enabled && webServer !== undefined && typeof webServer.register === 'function') {
    const handler = createNodeHandler({ service, store, config, version: VERSION, dataDir })
    ctx.effect(() => webServer.register({ kind: 'prefix', path: API_PREFIX, handler }))
  }

  ctx.logger?.info?.(`[pressure] active: v${VERSION} mode=${config.mode} locale=${locale} dir=${dataDir}`)
}
