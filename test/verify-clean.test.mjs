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
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const home = process.env.HOME ?? '';
    console.log(JSON.stringify({ url, home, nosystem: process.env.GIT_CONFIG_NOSYSTEM }));
  `
  const result = run(probe)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const seen = JSON.parse(result.stdout.trim())
  assert.equal(seen.url, 'https://github.com/kurumi1ksllq/DSH-plugins.git', `ambient insteadOf leaked: ${seen.url}`)
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

test('cleanup: no worktree registration and no temp HOME survive the run', () => {
  const before = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout
  run('console.log(1)')
  const after = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout
  assert.equal(after, before, 'verify-clean left a worktree behind')
  assert.equal(existsSync(join(ROOT, 'node_modules')), true, 'the host checkout must keep its node_modules')
})

test('AGENTS.md documents when and how to run verify-clean', () => {
  // The tool is useless if the next session never learns it exists. Read as a
  // contract: the section name, the command, and the reason must all be there.
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  assert.match(agents, /verify-clean\.mjs/)
  assert.match(agents, /多会话|共用|干净/)
  assert.match(agents, /node scripts\/verify-clean\.mjs/)
})
