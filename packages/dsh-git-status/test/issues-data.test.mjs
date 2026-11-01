/**
 * Issue-driven tests for the git-status DATA layer:
 *   #18 changed file list, #19 conflicts are not untracked,
 *   #20 stash & branch detail, #21 cache key follows the workspace.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  MAX_CHANGES,
  aheadCommitsOf,
  branchesOf,
  stashListOf,
  statusOf,
} from '../lib/git-info.js'
import { cacheKeyOf, getSnapshot, invalidateSnapshot } from '../lib/snapshot.js'

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
  writeFileSync(join(dir, 'b.txt'), 'two\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'init commit')
  return dir
}

// ---- #19: conflicts have their own bucket, never "untracked" ----------------

test('#19 an unresolved merge conflict counts as conflicts, not untracked', async () => {
  const dir = initRepo('gs-conflict-')
  git(dir, 'checkout', '-b', 'other')
  writeFileSync(join(dir, 'a.txt'), 'theirs\n')
  git(dir, 'commit', '-am', 'other change')
  git(dir, 'checkout', 'main')
  writeFileSync(join(dir, 'a.txt'), 'ours\n')
  git(dir, 'commit', '-am', 'our change')
  try {
    git(dir, 'merge', 'other')
  } catch {
    /* a conflicting merge exits non-zero; that is the setup */
  }

  const status = await statusOf(dir)
  assert.equal(status.conflicts, 1, 'conflict is counted as a conflict')
  assert.equal(status.untracked, 0, 'conflict is NOT counted as untracked')
  assert.equal(status.changed, 0, 'conflict is not a plain tracked change either')
  assert.equal(status.dirty, 1, 'dirty still covers it')
  const entry = status.changes.find((c) => c.path === 'a.txt')
  assert.ok(entry, 'conflicted path is listed')
  assert.equal(entry.kind, 'conflict')
  assert.equal(entry.conflict, true)
})

test('#19 a clean repo reports zero conflicts', async () => {
  const dir = initRepo('gs-noconflict-')
  const status = await statusOf(dir)
  assert.equal(status.conflicts, 0)
  assert.equal(status.dirty, 0)
})

// ---- #18: the changed paths are carried, not just counted ------------------

test('#18 statusOf lists changed paths with staged/unstaged state', async () => {
  const dir = initRepo('gs-changes-')
  writeFileSync(join(dir, 'a.txt'), 'modified\n')
  git(dir, 'add', 'a.txt')
  writeFileSync(join(dir, 'b.txt'), 'working tree only\n')
  writeFileSync(join(dir, 'new.txt'), 'untracked\n')

  const status = await statusOf(dir)
  const byPath = new Map(status.changes.map((c) => [c.path, c]))

  assert.equal(byPath.get('a.txt').kind, 'staged')
  assert.equal(byPath.get('a.txt').staged, true)
  assert.equal(byPath.get('b.txt').kind, 'unstaged')
  assert.equal(byPath.get('b.txt').staged, false)
  assert.equal(byPath.get('new.txt').kind, 'untracked')
  assert.equal(byPath.get('new.txt').untracked, true)

  assert.equal(status.staged, 1)
  assert.equal(status.unstaged, 1)
  assert.equal(status.untracked, 1)
  assert.equal(status.changesTotal, 3)
  assert.equal(status.changesTruncated, false)
})

test('#18 a rename keeps both the new and the original path', async () => {
  const dir = initRepo('gs-rename-')
  git(dir, 'mv', 'b.txt', 'renamed.txt')
  const status = await statusOf(dir)
  const entry = status.changes.find((c) => c.path === 'renamed.txt')
  assert.ok(entry, 'renamed path is listed')
  assert.equal(entry.origPath, 'b.txt')
})

test('#18 the change list is capped and reports truncation', async () => {
  const dir = initRepo('gs-many-')
  for (let i = 0; i < 12; i += 1) writeFileSync(join(dir, `n${i}.txt`), 'x\n')
  const status = await statusOf(dir, { maxChanges: 5 })
  assert.equal(status.changes.length, 5)
  assert.equal(status.changesTotal, 12)
  assert.equal(status.changesTruncated, true)
  assert.equal(status.untracked, 12, 'counts stay exact when the list is capped')
  assert.ok(MAX_CHANGES >= 100)
})

// ---- #20: stash contents and branch tip ------------------------------------

test('#20 stashListOf returns ref, relative date and subject', async () => {
  const dir = initRepo('gs-stash-')
  writeFileSync(join(dir, 'a.txt'), 'stashed change\n')
  git(dir, 'stash', 'push', '-m', 'wip: my stash subject')

  const list = await stashListOf(dir)
  assert.equal(list.length, 1)
  assert.equal(list[0].ref, 'stash@{0}')
  assert.equal(list[0].subject, 'On main: wip: my stash subject')
  assert.equal(typeof list[0].when, 'string')
  assert.ok(Number.isFinite(Date.parse(list[0].when)), 'carries a parseable date')
})

test('#20 branchesOf carries the tip commit date and subject', async () => {
  const dir = initRepo('gs-branchtip-')
  const branches = await branchesOf(dir)
  const main = branches.find((b) => b.name === 'main')
  assert.ok(main)
  assert.equal(main.lastCommitSubject, 'init commit')
  assert.equal(typeof main.lastCommitDate, 'string')
  assert.ok(main.lastCommitDate.length > 0)
})

test('#20 aheadCommitsOf lists the commits ahead of upstream', async () => {
  const upstream = initRepo('gs-ahead-up-')
  const clone = join(mkdtempSync(join(tmpdir(), 'gs-ahead-')), 'c')
  execFileSync(GIT, ['clone', upstream, clone], { encoding: 'utf8' })
  git(clone, 'config', 'user.email', 'test@example.com')
  git(clone, 'config', 'user.name', 'Test')

  assert.deepEqual(await aheadCommitsOf(clone), [], 'nothing ahead right after clone')

  writeFileSync(join(clone, 'c.txt'), 'new\n')
  git(clone, 'add', '.')
  git(clone, 'commit', '-m', 'local work one')
  writeFileSync(join(clone, 'd.txt'), 'new\n')
  git(clone, 'add', '.')
  git(clone, 'commit', '-m', 'local work two')

  const ahead = await aheadCommitsOf(clone)
  assert.equal(ahead.length, 2)
  assert.deepEqual(ahead.map((c) => c.subject), ['local work two', 'local work one'])
  assert.ok(ahead[0].hash.length >= 7)
})

test('#20 getSnapshot exposes stashList and aheadCommits', async () => {
  const dir = initRepo('gs-snap20-')
  writeFileSync(join(dir, 'a.txt'), 'stash me\n')
  git(dir, 'stash', 'push', '-m', 'pending work')

  invalidateSnapshot()
  const snap = await getSnapshot({ sessionCwd: dir, env: {} })
  assert.equal(snap.git.stashes, 1)
  assert.equal(snap.git.stashList.length, 1)
  assert.equal(snap.git.stashList[0].ref, 'stash@{0}')
  assert.match(snap.git.stashList[0].subject, /pending work/)
  assert.match(snap.git.stashList[0].when, /ago$/, 'renders a relative time')
  assert.ok(Array.isArray(snap.git.aheadCommits))
  assert.equal(snap.git.currentBranch, 'main')
})

// ---- #21: the cache follows the workspace, not just the Session -----------

test('#21 cacheKeyOf separates workspace from Session id', () => {
  assert.notEqual(
    cacheKeyOf({ sessionId: 's1', workspace: '/a' }),
    cacheKeyOf({ sessionId: 's1', workspace: '/b' }),
    'same Session, different workspace is a different key',
  )
  assert.equal(
    cacheKeyOf({ sessionId: 's1', workspace: '/a' }),
    cacheKeyOf({ sessionId: 's1', workspace: '/a' }),
  )
})

test('#21 one Session switching workspaces is not served a stale repo', async () => {
  const first = initRepo('gs-ws-one-')
  const second = initRepo('gs-ws-two-')
  git(second, 'checkout', '-b', 'second-branch')

  invalidateSnapshot()
  const sessions = { get: () => ({ header: { cwd: first } }) }
  const a = await getSnapshot({ sessionId: 'same-session', sessions, env: {} })
  assert.equal(a.workspace, first)
  assert.equal(a.git.status.branch, 'main')

  // Same Session, now pointing at another repo: must NOT hit a 30s cache.
  const moved = { get: () => ({ header: { cwd: second } }) }
  const b = await getSnapshot({ sessionId: 'same-session', sessions: moved, env: {} })
  assert.equal(b.workspace, second)
  assert.equal(b.git.status.branch, 'second-branch')
})

test('#21 same workspace and Session still hits the cache', async () => {
  const dir = initRepo('gs-ws-same-')
  invalidateSnapshot()
  const sessions = { get: () => ({ header: { cwd: dir } }) }
  const first = await getSnapshot({ sessionId: 's-cache', sessions, env: {} })
  const second = await getSnapshot({ sessionId: 's-cache', sessions, env: {} })
  assert.equal(second.generatedAt, first.generatedAt)
})
