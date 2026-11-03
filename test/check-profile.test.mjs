// Wiring tests for scripts/check-profile.mjs.
//
// The script exists because a profile can look green while the host loads
// nothing it expects (P1-4/P1-5 in docs/update-scheme.md). Every case below
// builds its own throwaway profile under the OS temp dir: nothing here reads or
// writes /root/.dsh, so the tests are safe on any machine, including CI.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'check-profile.mjs')

/** A throwaway profile directory with a manifest, and nothing else. */
function makeProfile({ dependencies = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-check-profile-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tmp-profile', private: true, dependencies }))
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  return dir
}

/** `node scripts/check-profile.mjs --profile <dir> --json`, parsed. */
function run(dir) {
  const run = spawnSync(process.execPath, [SCRIPT, '--profile', dir, '--json'], { encoding: 'utf8' })
  return { status: run.status, out: (run.stdout ?? '') + (run.stderr ?? ''), json: safeJson(run.stdout) }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function row(json, name) {
  return (json?.results ?? []).find((entry) => entry.name === name)
}

test('an orphan link whose target vanished is a wiring failure', () => {
  const dir = makeProfile()
  try {
    // The shape that shipped in this machine's web profile: a bundle that was
    // deleted from the repository, while pnpm kept the symlink behind.
    symlinkSync(join(dir, '..', 'packages', 'dsh-retired'), join(dir, 'node_modules', 'dsh-retired'))
    const result = run(dir)
    assert.equal(result.status, 1, `an orphan dangling link must fail the check:\n${result.out}`)
    assert.equal(result.json?.ok, false)
    const entry = row(result.json, 'dsh-retired')
    assert.ok(entry, `the failure must name the offending entry:\n${result.out}`)
    assert.equal(entry.kind, 'fail')
    assert.match(entry.detail, /target missing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an orphan link under a scope is found too', () => {
  const dir = makeProfile()
  try {
    mkdirSync(join(dir, 'node_modules', '@local'), { recursive: true })
    symlinkSync(join(dir, 'gone'), join(dir, 'node_modules', '@local', 'gone'))
    const result = run(dir)
    assert.equal(result.status, 1, `scoped orphans must fail too:\n${result.out}`)
    assert.equal(row(result.json, '@local/gone')?.kind, 'fail')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a live link the manifest does not declare is a warning, not a failure', () => {
  const dir = makeProfile()
  try {
    const target = join(dir, 'somewhere-else')
    mkdirSync(target)
    symlinkSync(target, join(dir, 'node_modules', 'stray-bundle'))
    const result = run(dir)
    assert.equal(result.status, 0, `a resolvable stray link must not fail:\n${result.out}`)
    assert.equal(row(result.json, 'stray-bundle')?.kind, 'warn')
    assert.equal(result.json?.warnings, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("pnpm's own bookkeeping directories are not mistaken for bundles", () => {
  const dir = makeProfile()
  try {
    // `.bin` holds symlinks to executables that may legitimately be dangling
    // on a machine with optional deps pruned; reporting them would make the
    // check noisy and unusable.
    mkdirSync(join(dir, 'node_modules', '.bin'))
    symlinkSync(join(dir, 'no-such-binary'), join(dir, 'node_modules', '.bin', 'ghost'))
    const result = run(dir)
    assert.equal(result.status, 0, `dot-directories must be skipped:\n${result.out}`)
    assert.equal(row(result.json, 'ghost'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared bundle that is linked to nothing still fails, and the count stays honest', () => {
  const dir = makeProfile({ dependencies: { 'dsh-git-status': 'link:../nowhere' } })
  try {
    symlinkSync(join(dir, '..', 'nowhere'), join(dir, 'node_modules', 'dsh-git-status'))
    const result = run(dir)
    assert.equal(result.status, 1, `declared-but-dangling must stay a failure:\n${result.out}`)
    assert.equal(row(result.json, 'dsh-git-status')?.kind, 'fail')
    // One row, not two: the orphan scan must not report what the declared pass
    // already covered.
    const entries = (result.json?.results ?? []).filter((entry) => entry.name === 'dsh-git-status')
    assert.equal(entries.length, 1, `duplicate rows for one bundle:\n${result.out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty profile passes and reports zero linked bundles', () => {
  const dir = makeProfile()
  try {
    const result = run(dir)
    assert.equal(result.status, 0, result.out)
    assert.deepEqual(result.json?.results, [])
    assert.equal(result.json?.failures, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
