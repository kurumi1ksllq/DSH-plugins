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

/** The same profile through the human-readable path: the summary lines live here. */
function runText(dir) {
  const result = spawnSync(process.execPath, [SCRIPT, '--profile', dir], { encoding: 'utf8' })
  return { status: result.status, out: (result.stdout ?? '') + (result.stderr ?? '') }
}

/** A directory that looks enough like a bundle for the declared pass to accept it. */
function fakeBundle(parent, name, version = '9.9.9') {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'cordis.patch.yml'), '# fake\n')
  writeFileSync(join(dir, 'index.js'), 'export const name = "fake"\n')
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version, main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  )
  return dir
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

test("a dot-name symlink in node_modules is pnpm's business, not ours", () => {
  const dir = makeProfile()
  try {
    // `.pnpm` is a directory today, but a stale dot-name *symlink* is exactly
    // what the guard exists for: descended into, it would manufacture failures
    // out of pnpm's own bookkeeping.
    symlinkSync(join(dir, 'gone-store'), join(dir, 'node_modules', '.pnpm-store'))
    const result = run(dir)
    assert.equal(result.status, 0, `dot entries must be skipped:\n${result.out}`)
    assert.equal(row(result.json, '.pnpm-store'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a dot directory holding dangling links is not descended into', () => {
  const dir = makeProfile()
  try {
    mkdirSync(join(dir, 'node_modules', '.bin'))
    symlinkSync(join(dir, 'ghost-binary'), join(dir, 'node_modules', '.bin', 'ghost'))
    const result = run(dir)
    assert.equal(result.status, 0, `dot directories are pnpm's, not ours:\n${result.out}`)
    assert.deepEqual(result.json?.results, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared link that is not one of ours is reported, never silently dropped', () => {
  const dir = makeProfile({ dependencies: { 'someone-elses-bundle': 'link:./ext' } })
  try {
    const ext = fakeBundle(dir, 'ext', '1.2.3')
    symlinkSync(ext, join(dir, 'node_modules', 'someone-elses-bundle'))
    const result = run(dir)
    assert.equal(result.status, 0, result.out)
    const entry = row(result.json, 'someone-elses-bundle')
    assert.ok(entry, `a declared live link must appear in the report, not vanish:\n${result.out}`)
    assert.equal(entry.kind, 'ok')
    assert.equal(result.json?.ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a stray link never claims to come from another checkout', () => {
  const dir = makeProfile()
  try {
    const target = join(dir, 'unrelated')
    mkdirSync(target)
    symlinkSync(target, join(dir, 'node_modules', 'stray-bundle'))
    const result = runText(dir)
    assert.equal(result.status, 0, result.out)
    assert.match(result.out, /stray link/)
    assert.equal(
      /load from another checkout/.test(result.out),
      false,
      `stray links must not borrow the D1 banner:\n${result.out}`,
    )
    assert.match(result.out, /profile ok: 0 linked bundle\(s\)/, result.out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bundle served from another checkout is counted as a warning, not as ok', () => {
  const dir = makeProfile({ dependencies: { 'dsh-git-status': 'link:./elsewhere' } })
  try {
    const elsewhere = fakeBundle(dir, 'elsewhere')
    symlinkSync(elsewhere, join(dir, 'node_modules', 'dsh-git-status'))
    const result = runText(dir)
    assert.equal(result.status, 0, result.out)
    // This is the number three docs quote as evidence, so pin what it counts:
    // a bundle loaded from a foreign checkout is *not* one of ours.
    assert.match(result.out, /profile ok: 0 linked bundle\(s\)/, result.out)
    assert.match(result.out, /1 warning\(s\)/, result.out)
    assert.match(result.out, /load from another checkout/, result.out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
