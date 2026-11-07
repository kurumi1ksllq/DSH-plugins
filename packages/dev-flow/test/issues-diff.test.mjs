/**
 * Issue #22: read-only diff for one changed path.
 * The panel's "click a file to see what changed" affordance needs a host-side
 * read; it must stay read-only and confined to the workspace.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { fileDiffOf } from '../lib-git-status/git-info.js'
import { getDiff } from '../lib-git-status/snapshot.js'

const GIT = process.env.GIT_IN_PATH ?? 'git'

function git(dir, ...args) {
  return execFileSync(GIT, args, { cwd: dir, encoding: 'utf8' })
}

function initRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'init commit')
  return dir
}

test('#22 fileDiffOf shows an unstaged change', async () => {
  const dir = initRepo('gs-diff-')
  writeFileSync(join(dir, 'a.txt'), 'changed content\n')
  const out = await fileDiffOf(dir, 'a.txt')
  assert.equal(out.path, 'a.txt')
  assert.match(out.diff, /changed content/)
  assert.equal(out.truncated, false)
})

test('#22 fileDiffOf shows a staged change', async () => {
  const dir = initRepo('gs-diff-staged-')
  writeFileSync(join(dir, 'a.txt'), 'staged content\n')
  git(dir, 'add', 'a.txt')
  const out = await fileDiffOf(dir, 'a.txt')
  assert.match(out.diff, /staged content/)
})

test('#22 fileDiffOf shows an untracked file as additions', async () => {
  const dir = initRepo('gs-diff-new-')
  writeFileSync(join(dir, 'brand-new.txt'), 'fresh line\n')
  // The contents fallback is opt-in: without it an empty diff is "nothing
  // changed", which is what keeps committed files out of the route.
  assert.equal((await fileDiffOf(dir, 'brand-new.txt')).diff, '', 'no fallback unless the caller says untracked')
  const out = await fileDiffOf(dir, 'brand-new.txt', { allowAddedFallback: true })
  assert.match(out.diff, /fresh line/)
  assert.equal(out.path, 'brand-new.txt')
})

test('#22 fileDiffOf truncates oversized diffs', async () => {
  const dir = initRepo('gs-diff-big-')
  writeFileSync(join(dir, 'a.txt'), `${'x'.repeat(500)}\n`)
  // The untracked-file fallback is what makes this diff large; it is opt-in.
  const out = await fileDiffOf(dir, 'a.txt', { maxBytes: 50, allowAddedFallback: true })
  assert.equal(out.truncated, true)
  assert.ok(out.diff.length <= 50)
})

test('#22 getDiff refuses paths outside the workspace', async () => {
  const dir = initRepo('gs-diff-guard-')
  writeFileSync(join(dir, 'a.txt'), 'x\n')
  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, '../../etc/passwd'), null)
  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, '/etc/passwd'), null)
  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, ''), null)
})

test('#22 getDiff resolves the Session workspace', async () => {
  const dir = initRepo('gs-diff-session-')
  writeFileSync(join(dir, 'a.txt'), 'session diff\n')
  const sessions = { get: () => ({ header: { cwd: dir } }) }
  const out = await getDiff({ sessionId: 's-diff', sessions, env: {} }, 'a.txt')
  assert.ok(out)
  assert.match(out.diff, /session diff/)
})

test('#22 getDiff returns null outside a git workspace', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'gs-diff-plain-'))
  assert.equal(await getDiff({ sessionCwd: plain, env: {} }, 'a.txt'), null)
})
