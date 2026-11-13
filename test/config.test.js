import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULTS, resolveConfig } from '../src/config.js'

test('defaults are the documented defaults', () => {
  const config = resolveConfig(undefined)
  assert.equal(config.mode, 'observe')
  assert.equal(config.locale, 'auto')
  assert.deepEqual(config.budget, { sessionTokens: 0, turnTokens: 0, turnToolCalls: 0 })
  assert.deepEqual(config.thresholds, {
    contextPressure: 0.8,
    budgetPressure: 0.8,
    failureStreak: 2,
    bloatedResultTokens: 8000,
    compactionChurn: 2,
  })
  assert.equal(config.coach.maxPerTurn, 3)
  assert.equal(config.storage.retentionDays, 30)
  assert.equal(config.storage.maxReceiptsPerSession, 2000)
  assert.equal(config.storage.maxTotalBytes, 52428800)
  assert.equal(config.http.enabled, true)
  assert.equal(DEFAULTS.mode, 'observe')
})

test('valid overrides are normalized', () => {
  const config = resolveConfig({
    mode: 'enforce',
    locale: 'zh',
    budget: { sessionTokens: 100000, turnToolCalls: 5 },
    thresholds: { contextPressure: 0.9, failureStreak: 3 },
    storage: { dataDir: 'C:\\tmp\\pressure' },
    http: { enabled: false },
  })
  assert.equal(config.mode, 'enforce')
  assert.equal(config.locale, 'zh')
  assert.equal(config.budget.sessionTokens, 100000)
  assert.equal(config.budget.turnTokens, 0)
  assert.equal(config.budget.turnToolCalls, 5)
  assert.equal(config.thresholds.contextPressure, 0.9)
  assert.equal(config.thresholds.failureStreak, 3)
  assert.equal(config.storage.dataDir, 'C:\\tmp\\pressure')
  assert.equal(config.http.enabled, false)
})

test('invalid config fails loud with the field and range', () => {
  assert.throws(() => resolveConfig({ mode: 'yolo' }), /mode must be one of observe \| coach \| enforce/u)
  assert.throws(() => resolveConfig({ thresholds: { contextPressure: 2 } }), /thresholds\.contextPressure must be in 0\.5\.\.0\.99/u)
  assert.throws(() => resolveConfig({ budget: { sessionTokens: -1 } }), /budget\.sessionTokens must be in 0\.\.1000000000/u)
  assert.throws(() => resolveConfig({ budget: { sessionTokens: 1.5 } }), /must be an integer/u)
  assert.throws(() => resolveConfig({ unknown: true }), /unknown key "unknown"/u)
  assert.throws(() => resolveConfig({ thresholds: { failureStreak: 0 } }), /failureStreak must be in 1\.\.50/u)
  assert.throws(() => resolveConfig({ storage: { dataDir: 42 } }), /dataDir must be a string path or null/u)
  assert.throws(() => resolveConfig({ locale: 'fr' }), /locale must be one of/u)
  assert.throws(() => resolveConfig({ coach: { maxPerTurn: 99 } }), /coach\.maxPerTurn must be in 1\.\.10/u)
  assert.throws(() => resolveConfig('nope'), /config must be an object/u)
})
