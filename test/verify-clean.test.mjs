// Tests for scripts/verify-clean.mjs (issue #43, item 3).
//
// The script exists because several sessions share one checkout: a plain
// `pnpm test` / `pnpm verify` there can fail for reasons that have nothing to
// do with the change under review — another session's uncommitted edits, or the
// host's global git config rewriting remotes. The contract that matters:
// the gate runs in a throwaway worktree under a throwaway HOME, ambient git
// config never leaks in, the host working tree is left untouched, and nothing
// is left behind on either success or failure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const SCRIPT = join(ROOT, 'scripts', 'verify-clean.mjs')

/** Run the script against this checkout with a fast, observable gate. */
function run(gate) {
  return spawnSync(process.execPath, [SCRIPT, '--', process.execPath, '-e', gate], {
    encoding: 'utf8',
    cwd: ROOT,
  })
}

test('the gate runs in a throwaway HOME with no ambient git config', () => {
  // Ambient config on this host rewrites github remotes; if it leaked into the
  // worktree, the probe below would print a mirror URL instead of the origin.
  const probe = `
    const { execFileSync } = require('node:child_process');
    // 'git remote get-url' applies insteadOf rewrites; the raw config value
    // does not. Equality of the two is the mirror-agnostic rewrite detector —
    // the same trick remotesOf uses in dsh-git-status (#42).
    const configured = execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
    const resolved = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const home = process.env.HOME ?? '';
    console.log(JSON.stringify({ configured, resolved, home, nosystem: process.env.GIT_CONFIG_NOSYSTEM }));
  `
  const result = run(probe)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const seen = JSON.parse(result.stdout.trim())
  // The gate must not inherit any insteadOf: the resolved URL must equal the
  // configured one, whatever shape either takes (this catches prefix mirrors
  // like https://mirror/git/https://github.com/... that a hostname blacklist
  // would miss).
  assert.equal(seen.resolved, seen.configured, `insteadOf rewrite leaked: ${seen.configured} -> ${seen.resolved}`)
  assert.match(seen.resolved, /kurumi1ksllq\/DSH-plugins/, `origin points somewhere else: ${seen.resolved}`)
  assert.notEqual(seen.home, process.env.HOME, 'the gate must not inherit the host HOME')
  assert.equal(seen.nosystem, '1', 'the system gitconfig must be disabled')
})

test('the gate sees a clean tree while the host tree is dirty', () => {
  // The whole point of the script: uncommitted noise in the shared checkout
  // must not follow the gate into its worktree. Write a scratch file we do NOT
  // clean up before running, and prove the gate does not see it.
  const scratch = join(ROOT, 'uncommitted-noise-verify-clean.txt')
  writeFileSync(scratch, 'host-side dirt\n')
  const probe = `
    const { execFileSync } = require('node:child_process');
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    console.log(JSON.stringify({ dirty }));
  `
  try {
    const result = run(probe)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const seen = JSON.parse(result.stdout.trim())
    assert.equal(seen.dirty, '', `host dirt leaked into the gate's tree: ${seen.dirty}`)
  } finally {
    rmSync(scratch, { force: true })
  }
})

test('a failing gate fails the run', () => {
  const result = run('process.exit(3)')
  assert.equal(result.status, 3)
  assert.match(result.stdout + result.stderr, /fail/i)
})

test('cleanup: no worktree registration and no temp HOME survive the run', (t) => {
  if (!existsSync(join(ROOT, 'node_modules'))) {
    t.skip('host checkout has no node_modules; there is nothing for the run to preserve')
    return
  }
  const before = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout
  run('console.log(1)')
  const after = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout
  assert.equal(after, before, 'verify-clean left a worktree behind')
  assert.equal(existsSync(join(ROOT, 'node_modules')), true, 'the host checkout must keep its node_modules')
})

test('AGENTS.md documents when and how to run verify-clean', () => {
  // The tool is useless if the next session never learns it exists. Anchored
  // to the 完工验收四件套 section so a stray filename mention elsewhere cannot
  // keep a deleted section green: the subsection header, the reason, and BOTH
  // example commands must all sit between that header and 版本纪律.
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  const start = agents.indexOf('## 完工验收四件套')
  const end = agents.indexOf('### 版本纪律')
  assert.notEqual(start, -1, 'AGENTS.md lost the 完工验收四件套 section')
  assert.notEqual(end, -1, 'AGENTS.md lost the 版本纪律 subsection (section anchor)')
  const section = agents.slice(start, end)
  assert.match(section, /多会话共用|干净验证/, 'the reason (shared checkout false reds) is gone')
  assert.match(section, /node scripts\/verify-clean\.mjs\s*#.*verify \+ test|node scripts\/verify-clean\.mjs\s*$/, 'the default-gate command is gone')
  assert.match(section, /node scripts\/verify-clean\.mjs\s*--/, 'the custom-gate command is gone')
})
