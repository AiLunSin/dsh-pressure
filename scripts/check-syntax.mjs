/**
 * Dependency-free syntax and policy check.
 *
 * - Imports every Host module so ESM syntax errors fail the build.
 * - Parses the Client bundle as a function body (it is a browser script).
 * - Parses every JSON file that ships with the package.
 * - Enforces the privacy/no-network policy over the shipped sources.
 * @module dsh-pressure/scripts/check-syntax
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

for (const file of listFiles(path.join(root, 'src'))) {
  try {
    await import(pathToFileURL(file).href)
  } catch (error) {
    failures.push(`${relative(file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Benchmark modules are Node-side tools; importing them must stay side-effect
// free so a typo fails here instead of during a paid run.
for (const file of [
  path.join(root, 'bench', 'tasks.mjs'),
  path.join(root, 'bench', 'metrics.mjs'),
  path.join(root, 'bench', 'plan.mjs'),
  path.join(root, 'bench', 'run.mjs'),
  path.join(root, 'bench', 'report.mjs'),
]) {
  try {
    await import(pathToFileURL(file).href)
  } catch (error) {
    failures.push(`${relative(file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

for (const file of [
  path.join(root, 'client.js'),
  path.join(root, 'scripts', 'check-syntax.mjs'),
  path.join(root, 'scripts', 'demo.mjs'),
  path.join(root, 'scripts', 'bench.mjs'),
]) {
  const source = readFileSync(file, 'utf8')
  try {
    // Client code runs as a browser script; a function body accepts that shape
    // while still rejecting syntax errors. Module scripts are imported above,
    // so only the Client bundle and this script's siblings use this path.
    if (file.endsWith('client.js')) new Function(source)
  } catch (error) {
    failures.push(`${relative(file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

for (const file of [
  path.join(root, 'package.json'),
  path.join(root, 'locale', 'en.json'),
  path.join(root, 'locale', 'zh.json'),
  ...listJson(path.join(root, 'test', 'fixtures')),
]) {
  try {
    JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    failures.push(`${relative(file)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Policy: no Host-package imports, no network egress, no model calls, and no
// model-tool registration. The Client bundle may fetch this Host's own API.
const FORBIDDEN = [
  { pattern: /from\s+['"]@deepseek-ai\//u, reason: 'imports a Host package (zero-dependency policy)' },
  { pattern: /import\(\s*['"]@deepseek-ai\//u, reason: 'imports a Host package (zero-dependency policy)' },
  { pattern: /from\s+['"]node:https?['"]/u, reason: 'imports an HTTP client (zero-network policy)' },
  { pattern: /ctx\.llm\b/u, reason: 'calls a model' },
  { pattern: /ctx\.tools\.register\s*\(/u, reason: 'registers a model tool' },
  { pattern: /systemPrompt\.(section|context)\(/u, reason: 'adds a system prompt section' },
]
const HOST_FILES = [...listFiles(path.join(root, 'src'))]
for (const file of HOST_FILES) {
  const source = readFileSync(file, 'utf8')
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(source)) failures.push(`${relative(file)}: ${rule.reason}`)
  }
}
{
  const source = readFileSync(path.join(root, 'client.js'), 'utf8')
  for (const rule of FORBIDDEN.slice(0, 2)) {
    if (rule.pattern.test(source)) failures.push(`client.js: ${rule.reason}`)
  }
}

if (failures.length > 0) {
  console.error('check-syntax failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`check-syntax ok: ${listFiles(path.join(root, 'src')).length} host modules, locale, client bundle`)

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  return readdirSync(dir)
    .map((entry) => path.join(dir, entry))
    .filter((file) => statSync(file).isFile() && (file.endsWith('.js') || file.endsWith('.mjs')))
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJson(dir) {
  return readdirSync(dir)
    .map((entry) => path.join(dir, entry))
    .filter((file) => statSync(file).isFile() && file.endsWith('.json'))
}

/**
 * @param {string} file
 * @returns {string}
 */
function relative(file) {
  return path.relative(root, file)
}
