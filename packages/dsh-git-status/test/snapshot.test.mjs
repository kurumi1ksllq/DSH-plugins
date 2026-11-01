import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { branchesOf, recentCommitsOf, remotesOf, statusOf } from '../lib/git-info.js'
import { pickWorkspace, nearestGitRoot, hasGitDir, sessionCwdOf } from '../lib/workspace.js'
import { forgeHintFor, slugFromRemoteUrl } from '../lib/gh.js'
import { getSnapshot, invalidateSnapshot } from '../lib/snapshot.js'

const GIT = process.env.GIT_IN_PATH ?? 'git'

function initRepo(dir) {
  mkdirSync(dir, { recursive: true })
  execFileSync(GIT, ['init', '-b', 'main'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  execFileSync(GIT, ['add', '.'], { cwd: dir })
  execFileSync(GIT, ['commit', '-m', 'init commit'], { cwd: dir })
  execFileSync(GIT, ['branch', 'feature/x'], { cwd: dir })
  return dir
}

const repo = initRepo(join(tmpdir(), `dsh-git-status-test-${process.pid}`))

test('statusOf: clean repo reports branch and zero dirty', async () => {
  const s = await statusOf(repo)
  assert.equal(s.branch, 'main')
  assert.equal(s.dirty, 0)
  assert.equal(s.detached, false)
})

test('statusOf: untracked file counts as dirty', async () => {
  writeFileSync(join(repo, 'junk.txt'), 'x\n')
  const s = await statusOf(repo)
  assert.equal(s.untracked, 1)
  assert.equal(s.dirty, 1)
})

test('branchesOf lists local branches and marks current', async () => {
  const bs = await branchesOf(repo)
  const main = bs.find((b) => b.name === 'main')
  const feat = bs.find((b) => b.name === 'feature/x')
  assert.ok(main, 'main exists')
  assert.equal(main.current, true)
  assert.equal(feat.current, false)
  assert.equal(main.remote, false)
})

test('recentCommitsOf returns the init commit', async () => {
  const cs = await recentCommitsOf(repo, 5)
  assert.equal(cs.length, 1)
  assert.equal(cs[0].subject, 'init commit')
  assert.ok(cs[0].hash.length >= 7)
})

test('remotesOf is empty without remotes', async () => {
  assert.deepEqual(await remotesOf(repo), [])
})

test('nearestGitRoot climbs to the .git ancestor', () => {
  const nested = join(repo, 'sub', 'deep')
  mkdirSync(nested, { recursive: true })
  assert.equal(nearestGitRoot(nested), repo)
  assert.equal(hasGitDir(nested), false)
})

test('pickWorkspace finds the repo via env candidate', async () => {
  const picked = await pickWorkspace({ env: { DSH_WORKSPACE: join(repo, 'sub') } })
  assert.equal(picked.reason, 'git')
  assert.ok(picked.dir === repo || picked.dir.startsWith(repo))
})

test('pickWorkspace reports plain for a non-git directory', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'plain-'))
  const picked = await pickWorkspace({ env: { DSH_WORKSPACE: plain } })
  assert.equal(picked.reason, 'plain')
})

test('slugFromRemoteUrl handles ssh and https', () => {
  assert.equal(slugFromRemoteUrl('git@github.com:me/repo.git'), 'me/repo')
  assert.equal(slugFromRemoteUrl('https://github.com/me/repo.git'), 'me/repo')
  assert.equal(slugFromRemoteUrl('https://gitlab.com/me/repo'), null)
})

test('getSnapshot describes a git workspace and caches', async () => {
  invalidateSnapshot()
  const first = await getSnapshot({ env: { DSH_WORKSPACE: repo } })
  assert.equal(first.isGit, true)
  assert.equal(typeof first.gh.available, 'boolean')
  assert.ok(Array.isArray(first.git.branches))
  const cached = await getSnapshot({ env: { DSH_WORKSPACE: repo } })
  assert.equal(cached.generatedAt, first.generatedAt, 'second call served from cache')
})

test('getSnapshot handles non-git workspace', async () => {
  invalidateSnapshot()
  const plain = mkdtempSync(join(tmpdir(), 'plain2-'))
  const snap = await getSnapshot({ env: { DSH_WORKSPACE: plain } })
  assert.equal(snap.isGit, false)
  assert.equal(snap.git, null)
})

// The panel follows the Session it is showing: its header cwd is the repo.
// The web host process itself may sit anywhere (often the fallback directory),
// so the process cwd must never decide when a Session names a workspace.

test('sessionCwdOf reads the live Session header first', async () => {
  const sessions = { get: (id) => (id === 'session-live' ? { header: { cwd: repo } } : undefined) }
  const sessionPersistence = { stat: async () => undefined }
  assert.equal(await sessionCwdOf({ sessions, sessionPersistence }, 'session-live'), repo)
})

test('sessionCwdOf falls back to the persisted header', async () => {
  const sessions = { get: () => undefined }
  const sessionPersistence = { stat: async (id) => (id === 'session-stored' ? { header: { cwd: repo } } : undefined) }
  assert.equal(await sessionCwdOf({ sessions, sessionPersistence }, 'session-stored'), repo)
})

test('sessionCwdOf tolerates missing services and unknown sessions', async () => {
  assert.equal(await sessionCwdOf({}, 'session-x'), null)
  assert.equal(await sessionCwdOf({ sessions: { get: () => { throw new Error('boom') } } }, 'session-x'), null)
  assert.equal(await sessionCwdOf({ sessionPersistence: { stat: async () => ({ header: {} }) } }, 'session-x'), null)
  assert.equal(await sessionCwdOf({}, ''), null)
})

test('pickWorkspace: the Session cwd outranks the env fallback', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'plain-3-'))
  const picked = await pickWorkspace({ cwd: join(repo, 'sub'), env: { DSH_WORKSPACE: plain } })
  assert.equal(picked.reason, 'git')
  assert.equal(picked.dir, repo)
})

test('pickWorkspace: a Session cwd outside git is plain, not another repo', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'plain-4-'))
  const picked = await pickWorkspace({ cwd: plain, env: { DSH_WORKSPACE: repo } })
  assert.equal(picked.reason, 'plain')
  assert.equal(picked.dir, plain)
})

test('getSnapshot describes the Session workspace, never the process cwd', async () => {
  invalidateSnapshot()
  const sessions = { get: (id) => (id === 'session-git' ? { header: { cwd: repo } } : undefined) }
  const snap = await getSnapshot({ sessionId: 'session-git', sessions, env: {} })
  assert.equal(snap.isGit, true)
  assert.equal(snap.workspace, repo)
  assert.equal(snap.git.status.branch, 'main')
})

test('getSnapshot caches per Session, so two workspaces do not collide', async () => {
  invalidateSnapshot()
  const other = initRepo(join(tmpdir(), `dsh-git-status-other-${process.pid}`))
  execFileSync('git', ['checkout', '-q', '-b', 'other-branch'], { cwd: other })
  const rows = {
    'session-a': { header: { cwd: repo } },
    'session-b': { header: { cwd: other } },
  }
  const sessions = { get: (id) => rows[id] }
  const a1 = await getSnapshot({ sessionId: 'session-a', sessions, env: {} })
  const b1 = await getSnapshot({ sessionId: 'session-b', sessions, env: {} })
  const a2 = await getSnapshot({ sessionId: 'session-a', sessions, env: {} })
  assert.equal(a1.workspace, repo)
  assert.equal(b1.workspace, other)
  assert.equal(b1.git.status.branch, 'other-branch')
  assert.notEqual(a1.generatedAt + a1.workspace, b1.generatedAt + b1.workspace)
  assert.equal(a2.generatedAt, a1.generatedAt, 'same Session is served from cache')
})

test('getSnapshot keeps the non-git Session workspace plain', async () => {
  invalidateSnapshot()
  const plain = mkdtempSync(join(tmpdir(), 'plain5-'))
  const sessions = { get: (id) => (id === 'session-plain' ? { header: { cwd: plain } } : undefined) }
  const snap = await getSnapshot({ sessionId: 'session-plain', sessions, env: {} })
  assert.equal(snap.isGit, false)
  assert.equal(snap.workspace, plain)
})

test('forgeHintFor names the gate that hides PRs', () => {
  const remotes = [{ name: 'origin', url: 'git@github.com:me/repo.git' }]
  assert.equal(forgeHintFor({ remotes, gh: { available: false, loggedIn: false } }), 'not-installed')
  assert.equal(forgeHintFor({ remotes, gh: { available: true, loggedIn: false } }), 'not-logged-in')
  assert.equal(forgeHintFor({ remotes: [], gh: { available: true, loggedIn: true } }), 'no-remote')
  assert.equal(forgeHintFor({ remotes, gh: { available: true, loggedIn: true } }), null)
  assert.equal(
    forgeHintFor({ remotes: [{ name: 'origin', url: 'https://gitlab.com/me/repo.git' }], gh: { available: true, loggedIn: true } }),
    'not-github',
  )
})
