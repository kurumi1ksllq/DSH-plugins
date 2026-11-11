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
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const SCRIPT = join(ROOT, 'scripts', 'check-bundle-versions.mjs')

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr ?? ''))
  return (r.stdout ?? '').trim()
}

function run(rootDir) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', rootDir], { encoding: 'utf8' })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/** A one-bundle git workspace at `version`, tagged `<name>@<version>`. */
function makeWorkspace({ name = 'demo-bundle', version = '1.0.0' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-check-versions-'))
  const bundle = join(dir, 'packages', name)
  mkdirSync(join(bundle, 'lib'), { recursive: true })
  mkdirSync(join(bundle, 'test'), { recursive: true })
  const writeManifest = (v) => writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name, version: v,
    engines: { dsh: '^0.2.0' },
    scripts: { test: 'node --test test/*.test.mjs' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
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
