// Contract tests for scripts/check-bundle-versions.mjs rule 3.
//
// Rule 3 is the version-discipline gate. Its documented promise is "a bundle whose
// shipped files changed since its last release must declare a higher version".
// The old implementation only looked at `git status --porcelain`, so a COMMITTED
// code change with no bump passed silently — measured: a scratch repo with a
// committed change and an unchanged version exited 0 with `bundles ok: 1 checked`.
//
// Each case builds its own workspace with real git history and runs the script via
// --root, so nothing here imports a private helper and nothing touches this repo.

import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const SCRIPT = join(ROOT, 'scripts', 'check-bundle-versions.mjs')

// Host git config (a mirror insteadOf, commit.gpgSign=true) can turn these
// fixtures red or hang them. scripts/verify-clean.mjs hit the same wall (#39), so
// every git command runs with an isolated HOME and an empty global config.
const GIT_ENV = (() => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-rule3-git-home-'))
  const globalConfig = join(home, '.gitconfig')
  writeFileSync(globalConfig, '')
  return { HOME: home, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' }
})()
after(() => { try { rmSync(GIT_ENV.HOME, { recursive: true, force: true }) } catch { /* ignore */ } })

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr ?? ''))
  return (r.stdout ?? '').trim()
}

function run(rootDir) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', rootDir], { encoding: 'utf8' })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/** A one-bundle git workspace at `version`, tagged `<name>@<version>`. */
// #145: this file builds scratch git repositories. A fixture that throws before the
// test body assigns `ws` would leak its directory, because `finally` never runs.
const scratchRegistry = []
after(() => {
  for (const dir of scratchRegistry) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may still hold a handle; a temp leftover is harmless.
    }
  }
})

/** Register a directory for cleanup at the end of the run. */
function track(dir) {
  scratchRegistry.push(dir)
  return dir
}

function makeWorkspace({ name = 'demo-bundle', version = '1.0.0', manifest = {} } = {}) {
  const dir = track(mkdtempSync(join(tmpdir(), 'dsh-check-versions-')))
  const bundle = join(dir, 'packages', name)
  mkdirSync(join(bundle, 'lib'), { recursive: true })
  mkdirSync(join(bundle, 'test'), { recursive: true })
  const writeManifest = (v) => writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name, version: v,
    engines: { dsh: '^0.2.0' },
    scripts: { test: 'node --test test/*.test.mjs' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...manifest,
  }, null, 2) + '\n')
  writeFileSync(join(bundle, 'cordis.patch.yml'), '# fake\n')
  writeFileSync(join(bundle, 'lib', 'a.js'), 'module.exports = 1\n')
  writeFileSync(join(bundle, 'test', 'a.test.mjs'), '// test\n')
  writeFileSync(join(dir, 'CHANGELOG.md'), '# CHANGELOG\n\n## Unreleased\n\n### ' + name + ' ' + version + ' — init\n')
  writeManifest(version)
  sh(dir, 'init', '-q')
  sh(dir, 'config', 'user.email', 'a@b.c')
  sh(dir, 'config', 'user.name', 'test')
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '-qm', 'init')
  sh(dir, 'tag', name + '@' + version)
  return {
    dir, bundle, name, writeManifest,
    commit: (msg) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', msg) },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('a committed code change without a bump fails', () => {
  const ws = makeWorkspace()
  try {
    writeFileSync(join(ws.bundle, 'lib', 'a.js'), 'module.exports = 2\n')
    ws.commit('feat: code change, no bump')
    const r = run(ws.dir)
    assert.equal(r.status, 1, 'a shipped change without a bump must fail: ' + r.out)
    assert.match(r.out, /bump the version/)
    assert.ok(r.out.includes(ws.name), 'the failure must name the scratch bundle, not a real one')
  } finally { ws.cleanup() }
})

test('a test-only change without a bump passes', () => {
  const ws = makeWorkspace()
  try {
    writeFileSync(join(ws.bundle, 'test', 'a.test.mjs'), '// test v2\n')
    ws.commit('test: no bump needed')
    const r = run(ws.dir)
    assert.equal(r.status, 0, 'test-only changes are exempt: ' + r.out)
  } finally { ws.cleanup() }
})

test('an uncommitted code change still fails', () => {
  const ws = makeWorkspace()
  try {
    writeFileSync(join(ws.bundle, 'lib', 'a.js'), 'module.exports = 3\n')
    const r = run(ws.dir)
    assert.equal(r.status, 1, 'the old behaviour must not regress: ' + r.out)
  } finally { ws.cleanup() }
})

test('bumping without tagging passes with a note', () => {
  const ws = makeWorkspace()
  try {
    writeFileSync(join(ws.bundle, 'lib', 'a.js'), 'module.exports = 4\n')
    ws.writeManifest('1.1.0')
    ws.commit('chore: bump 1.1.0')
    const r = run(ws.dir)
    assert.equal(r.status, 0, 'a bumped version is compliant: ' + r.out)
    assert.match(r.out, /untagged version 1\.1\.0/)
  } finally { ws.cleanup() }
})

test('a mis-tagged release is not used as the baseline', () => {
  // Three tags in this repository sit on a commit whose manifest still declares the
  // PREVIOUS version (dsh-inventory@0.12.2 -> 0.12.1, two websearch ones). The trap
  // is that such a tag is NEWER than the real release: a version-blind baseline
  // starts the comparison window at the mis-tag, sees no changes, and passes.
  //
  // The assertion must name rule 3's message. Checking only the exit code would be
  // satisfied by rule 4 (a missing CHANGELOG entry) and prove nothing.
  const ws = makeWorkspace()
  try {
    // A real release: manifest 1.1.0, tagged 1.1.0, documented.
    writeFileSync(join(ws.bundle, 'lib', 'a.js'), 'module.exports = 5\n')
    ws.writeManifest('1.1.0')
    writeFileSync(join(ws.dir, 'CHANGELOG.md'), '# CHANGELOG\n\n## Unreleased\n\n### demo-bundle 1.0.0 — init\n\n### demo-bundle 1.1.0 — second\n')
    ws.commit('chore: bump to 1.1.0')
    sh(ws.dir, 'tag', ws.name + '@1.1.0')
    // Ship code without bumping, then mis-tag that commit as 1.2.0.
    writeFileSync(join(ws.bundle, 'lib', 'a.js'), 'module.exports = 6\n')
    ws.commit('feat: shipped change, version left at 1.1.0')
    sh(ws.dir, 'tag', ws.name + '@1.2.0')
    const r = run(ws.dir)
    assert.match(r.out, /shipped files changed since demo-bundle@1\.1\.0/, 'the honest baseline is 1.1.0: ' + r.out)
    assert.equal(r.status, 1)
  } finally { ws.cleanup() }
})

test('a downgrade is not a bump', () => {
  // `===` would let 1.0.0 -> 0.9.0 pass: the version changed, so the naive check
  // is satisfied, but nothing was released. Any version that is not HIGHER is a
  // missed bump.
  const ws = makeWorkspace()
  try {
    writeFileSync(join(ws.bundle, 'lib', 'a.js'), 'module.exports = 9\n')
    ws.writeManifest('0.9.0')
    ws.commit('chore: downgrade to 0.9.0')
    const r = run(ws.dir)
    assert.equal(r.status, 1, 'a downgrade must not satisfy the bump gate: ' + r.out)
    assert.match(r.out, /bump the version/)
  } finally { ws.cleanup() }
})

test('a published file whose name merely contains test/spec is still gated', () => {
  // The exemption regex used to be /.(test|spec).mjs$/ — the unescaped dots made it
  // match lib/latest.mjs, lib/contest.mjs and lib/fastest.mjs, so a published file
  // could skip the bump by its name alone.
  for (const name of ['latest.mjs', 'contest.mjs', 'fastest.mjs', 'pretest.mjs']) {
    const ws = makeWorkspace()
    try {
      writeFileSync(join(ws.bundle, 'lib', name), 'module.exports = 1\n')
      ws.commit('feat: add lib/' + name)
      const r = run(ws.dir)
      assert.equal(r.status, 1, 'lib/' + name + ' is a shipped file and must be gated: ' + r.out)
    } finally { ws.cleanup() }
  }
})

test('moving a published file into test/ is still a shipped change', () => {
  // With rename detection, `git mv lib/a.js test/a.test.mjs` collapses into a single
  // test path and the gate goes green. --no-renames keeps the deletion visible.
  const ws = makeWorkspace()
  try {
    sh(ws.dir, 'mv', 'packages/demo-bundle/lib/a.js', 'packages/demo-bundle/test/moved.test.mjs')
    ws.commit('refactor: move the module into test/')
    const r = run(ws.dir)
    assert.equal(r.status, 1, 'a rename out of lib/ must not hide the change: ' + r.out)
  } finally { ws.cleanup() }
})

test('a shipped fixture under a test-like directory still needs a bump', () => {
  // `files` decides what ships. dsh-deep-ptc-mode publishes test-governor/, so its
  // old-keys-baseline.json is a SHIPPED file even though the path says test. A
  // path-only exemption would let it change without a bump.
  const ws = makeWorkspace({ manifest: { files: ['lib', 'test-governor'] } })
  try {
    mkdirSync(join(ws.bundle, 'test-governor'), { recursive: true })
    writeFileSync(join(ws.bundle, 'test-governor', 'old-keys-baseline.json'), '{}\n')
    ws.commit('feat: add shipped fixture')
    // Baseline is the tagged 1.0.0 commit; now change the shipped fixture.
    writeFileSync(join(ws.bundle, 'test-governor', 'old-keys-baseline.json'), '{"a":1}\n')
    ws.commit('chore: change a shipped fixture, no bump')
    const r = run(ws.dir)
    assert.equal(r.status, 1, 'a shipped .json under test-governor/ must be gated: ' + r.out)
  } finally { ws.cleanup() }
})

test('a package whose tags are all mis-tagged reports a problem, not a silent skip', () => {
  // With no self-consistent tag there is no baseline, so the gate would pass
  // everything. That is the same hole as the original bug, only narrower, so it
  // must be loud.
  const ws = makeWorkspace()
  try {
    // Delete the good tag and replace it with one whose name lies about the version.
    sh(ws.dir, 'tag', '-d', ws.name + '@1.0.0')
    sh(ws.dir, 'tag', ws.name + '@2.0.0')
    writeFileSync(join(ws.bundle, 'lib', 'a.js'), 'module.exports = 8\n')
    ws.commit('feat: shipped change, version still 1.0.0')
    const r = run(ws.dir)
    assert.equal(r.status, 1, 'an all-mis-tagged package must fail loudly: ' + r.out)
    assert.match(r.out, /mis-tagged/)
  } finally { ws.cleanup() }
})
