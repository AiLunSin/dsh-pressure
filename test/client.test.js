import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { FLAG_ADVICE, FLAG_CODES } from '../src/flags.js'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/**
 * Load the browser bundle in a VM with a stubbed module loader and React, then
 * run its `apply` against recording slot/locale services.
 */
function loadPlugin() {
  /** @type {any} */
  let definition = null
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { definition = value } } },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client.js must register a module definition')
  const React = {
    createElement() { return {} },
    useEffect() {},
    useRef() {},
    useState() { return [null, () => {}] },
  }
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected module: ${name}`)
  })
  /** @type {Array<{ name: string, options: any }>} */
  const registrations = []
  /** @type {Record<string, Record<string, string>> | null} */
  let dictionaries = null
  const ctx = {
    effect(callback) { callback() },
    locale: {
      register(namespace, dicts) {
        assert.equal(namespace, 'dshPressure')
        dictionaries = dicts
        return () => {}
      },
      bind() { return (key) => key },
      subscribe() { return () => {} },
    },
    slots: {
      inject(name, register) { register() },
      register(options, component) {
        assert.equal(typeof component, 'function')
        registrations.push({ name: options.name, options })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  return { definition, plugin, registrations, dictionaries }
}

test('client bundle registers the sidebar entry and main panel under the package id', () => {
  const { definition, registrations } = loadPlugin()
  assert.equal(definition.id, 'dsh-pressure')
  assert.deepEqual(definition.id, 'dsh-pressure')
  const sidebar = registrations.find((entry) => entry.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.name === 'main')
  assert.ok(sidebar, 'sidebar.panellist must be registered')
  assert.equal(sidebar.options.id, 'pressure')
  assert.ok(typeof sidebar.options.order === 'number')
  assert.equal(typeof sidebar.options.label, 'function')
  assert.ok(main, 'main must be registered')
  assert.equal(main.options.key, 'pressure')
})

test('both locales are complete and contain every literal key and every advice key', () => {
  const { dictionaries } = loadPlugin()
  assert.ok(dictionaries)
  const en = dictionaries.en
  const zh = dictionaries.zh
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const code of FLAG_CODES) {
    const adviceKey = FLAG_ADVICE[code]
    assert.ok(Object.hasOwn(en, adviceKey), `en is missing ${adviceKey}`)
    assert.ok(Object.hasOwn(zh, adviceKey), `zh is missing ${adviceKey}`)
  }
  const literals = new Set([...source.matchAll(/\bt\('([^']+)'/gu)].map((match) => match[1]))
  for (const key of literals) {
    assert.ok(Object.hasOwn(en, key), `en is missing literal key ${key}`)
    assert.ok(Object.hasOwn(zh, key), `zh is missing literal key ${key}`)
  }
  for (const key of ['observe', 'coach', 'enforce', 'advice.none']) {
    assert.ok(Object.hasOwn(en, key))
    assert.ok(Object.hasOwn(zh, key))
  }
})
