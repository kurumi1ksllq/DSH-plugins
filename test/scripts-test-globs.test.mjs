// Contract tests for the test scripts themselves.
//
// #182: a `node --test <glob>` whose glob matches nothing exits 0 and prints
// "tests 0". It looks like it runs tests and runs none — the gate stays green
// while the engine, the API and the panel go unguarded. The same shape exists at
// the root as `pnpm --filter <name>`: an unknown name prints "No projects
// matched the filters" and still exits 0.
//
// A glob that matches SOMETHING is not enough: a package whose files are named
// `test-*.mjs` while the whole rest of the repository names them `*.test.mjs`
// silently ignores every test written the conventional way. So one case below
// asserts coverage (every test file is reached by some glob), not just
// non-emptiness.
//
// These cases read package.json and the filesystem only. They never import a
// bundle's internals, so they cannot drift with an implementation.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

/** `node --test` flags that consume the following token as a value. */
const VALUE_FLAGS = new Set([
  '--test-reporter',
  '--test-reporter-destination',
  '--test-timeout',
  '--test-concurrency',
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-shard',
])

/** Files that are deliberately outside every test glob (shared helpers). */
const NOT_TESTS = new Set([
  'packages/dsh-websearch-failover/test/probe-bundle.mjs',
  'packages/dsh-credential-vault/test/owner-mode.mjs',
  'packages/dsh-deep-ptc-mode/test-governor/fixtures.mjs',
  'packages/dsh-deep-ptc-mode/test-governor/eval-module.mjs',
  'packages/dsh-deep-ptc-mode/test-governor/integrity-runner.mjs',
])

/**
 * Every `node --test` path argument in a script, expanded against `dir`.
 *
 * A flag with a value (`--test-reporter spec`) must not have its value mistaken
 * for a path: that turns a legitimate script edit into a red guard, and a guard
 * that cries wolf gets deleted. A token containing a wildcard is expanded for
 * real (globSync, node >= 22) so a nested pattern is never silently skipped.
 */
function testArgs(dir, script) {
  const found = []
  for (const segment of script.split(/&&|\|\|/)) {
    const tokens = segment.trim().split(/\s+/)
    const at = tokens.indexOf('--test')
    if (at < 0) continue
    const rest = tokens.slice(at + 1)
    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i]
      if (token.startsWith('-')) {
        if (VALUE_FLAGS.has(token)) i += 1
        continue
      }
      if (!token.includes('*') && !token.endsWith('.mjs') && !token.endsWith('.js')) continue
      const matches = token.includes('*')
        ? globSync(token, { cwd: dir }).sort()
        : existsSync(join(dir, token)) ? [token] : []
      found.push({ pattern: token, matches })
    }
  }
  return found
}

/** Every `pnpm --filter <name>` / `--filter=<name>` argument in a script. */
function filterNames(script) {
  return [...script.matchAll(/--filter[=\s]+(?:'([^']+)'|"([^"]+)"|(\S+))/g)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((name) => !name.startsWith('!'))
}

/** Manifests that declare scripts: the workspace bundles plus the root. */
function manifests() {
  const dir = join(ROOT, 'packages')
  const bundles = readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'package.json')))
    .map((name) => ({ label: name, dir: join(dir, name), manifest: JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8')) }))
  const root = { label: '(root)', dir: ROOT, manifest: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) }
  return [root, ...bundles]
}

test('no test script is a single empty glob', () => {
  // The original defect: a script whose ONLY test argument matches nothing. A
  // script may legitimately list a pattern that is empty today — it covers the
  // conventional naming for tests written later — but then another argument has
  // to carry the load. A script that runs nothing at all is the bug.
  const bad = []
  for (const { label, dir, manifest } of manifests()) {
    for (const [key, script] of Object.entries(manifest.scripts ?? {})) {
      if (typeof script !== 'string') continue
      const args = testArgs(dir, script)
      if (args.length === 0) continue
      const total = args.reduce((sum, arg) => sum + arg.matches.length, 0)
      if (total === 0) {
        bad.push(label + ' scripts.' + key + ': every argument matches no file (' + args.map((a) => a.pattern).join(', ') + ')')
      }
    }
  }
  assert.deepEqual(bad, [], 'a test script that runs zero files is the defect this guard exists for')
})

test('every test file is reached by some glob in its own package test script', () => {
  // Coverage, not just non-emptiness. A package that names its files
  // `test-*.mjs` while the repository names them `*.test.mjs` passes the case
  // above and still never runs a conventionally-named new test.
  const bad = []
  for (const { label, dir, manifest } of manifests()) {
    const script = manifest.scripts?.test
    if (typeof script !== 'string') continue
    const reached = new Set()
    for (const arg of testArgs(dir, script)) {
      for (const match of arg.matches) reached.add(join(dir, match))
    }
    const testDir = join(dir, 'test')
    if (!existsSync(testDir)) continue
    for (const name of readdirSync(testDir)) {
      if (!name.endsWith('.mjs')) continue
      const abs = join(testDir, name)
      const rel = relative(ROOT, abs).split('\\').join('/')
      if (NOT_TESTS.has(rel)) continue
      if (!reached.has(abs)) bad.push(rel + ' is never run by ' + label + ' scripts.test')
    }
  }
  assert.deepEqual(bad, [], 'a test file outside every glob is dead weight that still looks alive')
})

test('every pnpm --filter name in the root scripts names a real workspace package', () => {
  // `pnpm --filter <unknown>` prints "No projects matched the filters" and exits
  // 0, so a renamed package silently stops being tested.
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const known = new Set(
    readdirSync(join(ROOT, 'packages'))
      .filter((name) => existsSync(join(ROOT, 'packages', name, 'package.json')))
      .map((name) => JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8')).name),
  )
  const bad = []
  for (const [key, value] of Object.entries(root.scripts ?? {})) {
    if (typeof value !== 'string') continue
    for (const name of filterNames(value)) {
      if (!known.has(name)) bad.push('scripts.' + key + ': --filter ' + name + ' names no package')
    }
  }
  assert.deepEqual(bad, [])
})
