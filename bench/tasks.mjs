/**
 * Pre-registered benchmark task set (design §13).
 *
 * Each task is a tiny synthetic repository plus a `check.mjs` acceptance
 * script. Nothing here calls a model; `bench/run.mjs` is the only caller that
 * spends tokens, and it requires an explicit --execute flag.
 * @module dsh-pressure/bench/tasks
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** @param {string} dir @param {string} relative @param {string} content */
function write(dir, relative, content) {
  const target = path.join(dir, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, content)
}

/** @param {string} title @param {string} body */
function prompt(title, body) {
  return [
    `Task: ${title}`,
    '',
    body,
    '',
    'Work inside the current directory. Make `node check.mjs` pass.',
    'Do not modify check.mjs. Keep the change minimal; stop when the check passes.',
  ].join('\n')
}

/**
 * @typedef {{
 *   id: string,
 *   category: 'bugfix' | 'feature' | 'investigation',
 *   title: string,
 *   prompt: string,
 *   setup: (dir: string) => void,
 * }} BenchTask
 */

/** @type {BenchTask[]} */
export const TASKS = [
  {
    id: 'bugfix-offbyone',
    category: 'bugfix',
    title: 'Fix an off-by-one in sum()',
    prompt: prompt('Fix an off-by-one in sum()', '`src/sum.js` skips the last element. Fix it so the check passes.'),
    setup(dir) {
      write(dir, 'src/sum.js', 'export function sum(values) {\n  let total = 0\n  for (let index = 0; index < values.length - 1; index += 1) total += values[index]\n  return total\n}\n')
      write(dir, 'check.mjs', "import { sum } from './src/sum.js'\nimport assert from 'node:assert/strict'\nassert.equal(sum([1, 2, 3]), 6)\nassert.equal(sum([]), 0)\nconsole.log('ok')\n")
    },
  },
  {
    id: 'bugfix-null',
    category: 'bugfix',
    title: 'Handle a null user',
    prompt: prompt('Handle a null user', '`src/format.js` throws when the user is null. Make it return `anonymous` instead.'),
    setup(dir) {
      write(dir, 'src/format.js', "export function displayName(user) {\n  return user.name.trim()\n}\n")
      write(dir, 'check.mjs', "import { displayName } from './src/format.js'\nimport assert from 'node:assert/strict'\nassert.equal(displayName(null), 'anonymous')\nassert.equal(displayName({ name: ' Ada ' }), 'Ada')\nconsole.log('ok')\n")
    },
  },
  {
    id: 'bugfix-import',
    category: 'bugfix',
    title: 'Fix a broken import',
    prompt: prompt('Fix a broken import', '`src/main.js` imports a file that does not exist. Fix the path so the check passes.'),
    setup(dir) {
      write(dir, 'src/helpers.js', 'export const value = 42\n')
      write(dir, 'src/main.js', "import { value } from './helper.js'\nexport const result = value + 1\n")
      write(dir, 'check.mjs', "import { result } from './src/main.js'\nimport assert from 'node:assert/strict'\nassert.equal(result, 43)\nconsole.log('ok')\n")
    },
  },
  {
    id: 'feature-slug',
    category: 'feature',
    title: 'Implement slugify()',
    prompt: prompt('Implement slugify()', 'Create `src/slug.js` with `slugify(text)`: lowercase, trim, spaces to `-`, and drop everything except `a-z0-9-`.'),
    setup(dir) {
      write(dir, 'src/slug.js', 'export function slugify(text) {\n  throw new Error("not implemented")\n}\n')
      write(dir, 'check.mjs', "import { slugify } from './src/slug.js'\nimport assert from 'node:assert/strict'\nassert.equal(slugify('Hello World'), 'hello-world')\nassert.equal(slugify('  A  B  '), 'a-b')\nassert.equal(slugify('C++ & JS!'), 'c-js')\nconsole.log('ok')\n")
    },
  },
  {
    id: 'feature-csv',
    category: 'feature',
    title: 'Implement toCsv(rows)',
    prompt: prompt('Implement toCsv(rows)', 'Create `src/csv.js` exporting `toCsv(rows)` for arrays of objects: header from the first row, comma separated, quote fields containing commas, quotes, or newlines, and double embedded quotes.'),
    setup(dir) {
      write(dir, 'src/csv.js', 'export function toCsv(rows) {\n  throw new Error("not implemented")\n}\n')
      write(dir, 'check.mjs', "import { toCsv } from './src/csv.js'\nimport assert from 'node:assert/strict'\nconst csv = toCsv([{ a: 1, b: 'x,y' }, { a: 2, b: 'q\"z' }])\nassert.equal(csv, 'a,b\\n1,\"x,y\"\\n2,\"q\"\"z\"')\nconsole.log('ok')\n")
    },
  },
  {
    id: 'feature-retry',
    category: 'feature',
    title: 'Implement retry()',
    prompt: prompt('Implement retry()', 'Create `src/retry.js` exporting `retry(operation, { attempts })`: await the operation, retry on rejection up to `attempts` total tries, rethrow the last error.'),
    setup(dir) {
      write(dir, 'src/retry.js', 'export async function retry(operation, options) {\n  throw new Error("not implemented")\n}\n')
      write(dir, 'check.mjs', "import { retry } from './src/retry.js'\nimport assert from 'node:assert/strict'\nlet calls = 0\nconst value = await retry(async () => { calls += 1; if (calls < 3) throw new Error('again'); return 'done' }, { attempts: 3 })\nassert.equal(value, 'done')\nassert.equal(calls, 3)\nlet failures = 0\ntry { await retry(async () => { failures += 1; throw new Error('nope') }, { attempts: 2 }) } catch (error) { assert.equal(error.message, 'nope') }\nassert.equal(failures, 2)\nconsole.log('ok')\n")
    },
  },
  {
    id: 'investigate-constant',
    category: 'investigation',
    title: 'Find the misplaced constant',
    prompt: prompt('Find the misplaced constant', 'Ten data modules define `LIMIT`; one module disagrees with `config.mjs`. Find and fix it without touching `config.mjs` or `check.mjs`.'),
    setup(dir) {
      write(dir, 'config.mjs', 'export const LIMIT = 42\n')
      for (let index = 0; index < 10; index += 1) {
        const value = index === 6 ? 7 : 42
        write(dir, `data/module-${index}.js`, `export const LIMIT = ${value}\n`)
      }
      write(dir, 'check.mjs', "import { LIMIT } from './config.mjs'\nimport * as modules from './data/module-0.js'\nimport assert from 'node:assert/strict'\nfor (let index = 0; index < 10; index += 1) {\n  const current = await import(`./data/module-${index}.js`)\n  assert.equal(current.LIMIT, LIMIT, `module-${index}`)\n}\nassert.ok(modules)\nconsole.log('ok')\n")
    },
  },
  {
    id: 'investigate-duplicate',
    category: 'investigation',
    title: 'Consolidate duplicate normalize()',
    prompt: prompt('Consolidate duplicate normalize()', 'Twelve modules each define the same `normalize()` with a subtle copy difference. Extract one shared implementation in `src/shared/normalize.js`, update every module to import it, and keep all exports working.'),
    setup(dir) {
      for (let index = 0; index < 12; index += 1) {
        const body = index === 5
          ? "export function normalize(value) {\n  return String(value).trim().toUpperCase()\n}\n"
          : "export function normalize(value) {\n  return String(value).trim().toLowerCase()\n}\n"
        write(dir, `src/module-${index}.js`, `${body}export const id = ${index}\n`)
      }
      write(dir, 'check.mjs', "import assert from 'node:assert/strict'\nimport { normalize } from './src/shared/normalize.js'\nassert.equal(normalize('  abc '), 'abc')\nfor (let index = 0; index < 12; index += 1) {\n  const current = await import(`./src/module-${index}.js`)\n  assert.equal(current.normalize('  abc '), 'abc', `module-${index}`)\n  assert.equal(typeof current.id, 'number')\n}\nconsole.log('ok')\n")
    },
  },
  {
    id: 'investigate-perf',
    category: 'investigation',
    title: 'Replace an O(n^2) duplicate scan',
    prompt: prompt('Replace an O(n^2) duplicate scan', '`src/process.js` removes duplicates with a nested scan and times out on 50k items. Make it linear while preserving order and the returned shape.'),
    setup(dir) {
      write(dir, 'src/process.js', 'export function unique(values) {\n  const output = []\n  for (const value of values) {\n    if (!output.includes(value)) output.push(value)\n  }\n  return output\n}\n')
      write(dir, 'check.mjs', "import { unique } from './src/process.js'\nimport assert from 'node:assert/strict'\nconst values = Array.from({ length: 100000 }, (_, index) => index % 10000)\nconst started = performance.now()\nconst result = unique(values)\nconst elapsed = performance.now() - started\nassert.equal(result.length, 10000)\nassert.deepEqual(result.slice(0, 3), [0, 1, 2])\nassert.ok(elapsed < 300, `too slow: ${elapsed}ms`)\nconsole.log('ok')\n")
    },
  },
]

/** @param {string} id */
export function taskById(id) {
  return TASKS.find((task) => task.id === id)
}

/**
 * Materialize one task into a fresh workspace.
 * @param {BenchTask} task
 * @param {string} dir
 * @returns {void}
 */
export function materialize(task, dir) {
  mkdirSync(dir, { recursive: true })
  task.setup(dir)
  writeFileSync(path.join(dir, 'TASK.md'), `${task.prompt}\n`)
}

/**
 * Run the task's acceptance script.
 * @param {string} dir
 * @param {number} [timeoutMs]
 * @returns {{ passed: boolean, output: string }}
 */
export function verify(dir, timeoutMs = 120_000) {
  const result = spawnSync(process.execPath, ['check.mjs'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, NODE_OPTIONS: '' },
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(0, 4000)
  return { passed: result.status === 0, output }
}
