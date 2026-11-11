// Contract tests for the test scripts themselves.
//
// #182: a `node --test <glob>` whose glob matches nothing exits 0 and prints
// "tests 0". It looks like it runs tests and runs none — the gate stays green
// while the engine, the API and the panel go unguarded. The same shape exists at
// the root as `pnpm --filter <name>`: an unknown name prints "No projects
// matched the filters" and still exits 0.
//
// These cases read package.json and the filesystem only. They never import a
// bundle's internals, so they cannot drift with an implementation.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

/** Expand one `node --test` argument that may contain a single `*`. */
function expand(dir, pattern) {
  if (!pattern.includes('*')) return existsSync(join(dir, pattern)) ? [pattern] : []
  const star = pattern.indexOf('*')
  const prefix = pattern.slice(0, star)
  const suffix = pattern.slice(star + 1)
  // Only the file-name segment is globbed; a pattern with a slash in the suffix
  // would need real glob semantics and is out of scope for this guard.
  if (suffix.includes('/')) return null
  const slash = prefix.lastIndexOf('/')
  const sub = slash < 0 ? '' : prefix.slice(0, slash)
  const head = slash < 0 ? prefix : prefix.slice(slash + 1)
  const abs = join(dir, sub)
  if (!existsSync(abs)) return []
  return readdirSync(abs)
    .filter((name) => name.startsWith(head) && name.endsWith(suffix))
    .map((name) => (sub ? sub + '/' + name : name))
}

/** Every `node --test` argument in a manifest's test script, with its matches. */
function testArgs(dir, script) {
  const found = []
  for (const segment of script.split(/&&|\|\|/)) {
    const tokens = segment.trim().split(/\s+/)
    const at = tokens.indexOf('--test')
    if (at < 0) continue
    for (const token of tokens.slice(at + 1)) {
      if (token.startsWith('-')) continue
      found.push({ pattern: token, matches: expand(dir, token) })
    }
  }
  return found
}

/** Bundles the workspace knows about, by directory name under packages/. */
function bundles() {
  const dir = join(ROOT, 'packages')
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'package.json')))
    .map((name) => ({ name, dir: join(dir, name), manifest: JSON.parse(readFileSync(join(dir, name, 'package.json'), 'utf8')) }))
}

test('every node --test glob in a bundle test script matches at least one file', () => {
  // A glob that matches nothing is the defect this guard exists for. Asserting
  // ">= 1 match" rather than an exact count keeps the guard from pinning a
  // number that changes whenever a test file is added.
  const bad = []
  for (const bundle of bundles()) {
    const script = bundle.manifest.scripts?.test
    if (typeof script !== 'string') continue
    for (const arg of testArgs(bundle.dir, script)) {
      if (arg.matches === null) continue
      if (arg.matches.length === 0) bad.push(bundle.name + ': "' + arg.pattern + '" matches no file')
    }
  }
  assert.deepEqual(bad, [], 'a test glob that matches nothing runs zero tests and exits 0')
})

test('every pnpm --filter name in the root scripts names a real workspace package', () => {
  // `pnpm --filter <unknown>` prints "No projects matched the filters" and exits
  // 0, so a renamed package silently stops being tested.
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const known = new Set(bundles().map((bundle) => bundle.manifest.name))
  const bad = []
  for (const [key, value] of Object.entries(root.scripts ?? {})) {
    if (typeof value !== 'string') continue
    for (const match of value.matchAll(/--filter\s+(?:'([^']+)'|"([^"]+)"|(\S+))/g)) {
      const name = match[1] ?? match[2] ?? match[3]
      if (name.startsWith('!')) continue
      if (!known.has(name)) bad.push(key + ': --filter ' + name + ' names no package')
    }
  }
  assert.deepEqual(bad, [])
})
