/**
 * P1 regressions from the PR #23 review: the small defects that outlive a
 * passing test suite because nothing ever asserted them.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { relativeTime, statusShaOf } from '../lib/snapshot.js'
import { fileDiffOf, redactRemoteUrl, remotesOf, statusOf } from '../lib/git-info.js'
import { slugFromRemoteUrl } from '../lib/gh.js'
import { isInsideRoot, isPlausibleRepoPath, resolveInsideRepo } from '../lib/path-guard.js'
import { DEFAULT_MAX_BUFFER, runCommand } from '../lib/run.js'

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

// ---- relativeTime: floor, never round -------------------------------------

const NOW = Date.parse('2026-11-02T12:00:00.000Z')
const isoAgo = (ms) => new Date(NOW - ms).toISOString()

test('relativeTime floors instead of rounding up', () => {
  const s = (n) => n * 1000
  // 59.5 s used to print "1 minute ago" — an event one minute in the future.
  assert.equal(relativeTime(isoAgo(s(59.5)), NOW), '59 seconds ago')
  assert.equal(relativeTime(isoAgo(s(59)), NOW), '59 seconds ago')
  assert.equal(relativeTime(isoAgo(s(60)), NOW), '1 minute ago')
  assert.equal(relativeTime(isoAgo(s(90)), NOW), '1 minute ago')
  assert.equal(relativeTime(isoAgo(s(3599)), NOW), '59 minutes ago')
  assert.equal(relativeTime(isoAgo(s(3600)), NOW), '1 hour ago')
  // 23.6 h used to be rounded to "1 day" and then re-rounded at every step.
  assert.equal(relativeTime(isoAgo(s(23.6 * 3600)), NOW), '23 hours ago')
  assert.equal(relativeTime(isoAgo(s(24 * 3600)), NOW), '1 day ago')
  assert.equal(relativeTime(isoAgo(s(29.9 * 86400)), NOW), '29 days ago')
  assert.equal(relativeTime(isoAgo(s(30 * 86400)), NOW), '1 month ago')
  assert.equal(relativeTime(isoAgo(s(364 * 86400)), NOW), '12 months ago')
  assert.equal(relativeTime(isoAgo(s(365 * 86400)), NOW), '1 year ago')
  assert.equal(relativeTime(isoAgo(0), NOW), '0 seconds ago')
  // Clock skew must not produce "-3 seconds ago".
  assert.equal(relativeTime(new Date(NOW + 5000).toISOString(), NOW), '0 seconds ago')
})

test('relativeTime tolerates junk', () => {
  assert.equal(relativeTime('', NOW), null)
  assert.equal(relativeTime(undefined, NOW), null)
  assert.equal(relativeTime('not a date', NOW), null)
})

// ---- file names: trailing spaces survive ----------------------------------

test('statusOf keeps trailing and inner spaces in file names', async () => {
  const dir = initRepo('gs-space-')
  const names = ['trail .txt', 'two  spaces.txt', ' lead.txt']
  for (const name of names) writeFileSync(join(dir, name), 'x\n')
  const status = await statusOf(dir)
  const paths = status.changes.map((c) => c.path).sort()
  assert.deepEqual(paths, [...names].sort(), 'split(" ") used to eat the extra spaces')

  const diff = await fileDiffOf(dir, join(dir, 'trail .txt'), { allowAddedFallback: true })
  assert.match(diff.diff, /trail \.txt/, 'the diff header names the real file')
})

// ---- remotes: parsing, slug and credentials -------------------------------

test('remotesOf parses `git remote -v` (space before the (fetch) suffix)', async () => {
  const dir = initRepo('gs-remote-')
  git(dir, 'remote', 'add', 'origin', 'git@github.com:me/repo.git')
  git(dir, 'remote', 'add', 'fork', 'https://github.com/other/fork.git')
  const remotes = await remotesOf(dir)
  assert.deepEqual(remotes.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'fork', url: 'https://github.com/other/fork.git' },
    { name: 'origin', url: 'git@github.com:me/repo.git' },
  ], 'a strict tab-(fetch) regex matched nothing, so every snapshot had remotes: []')
})

test('remotesOf never hands a token to the panel', async () => {
  const dir = initRepo('gs-remote-token-')
  git(dir, 'remote', 'add', 'origin', 'https://user:ghp_S3CRET@github.com/me/repo.git')
  const remotes = await remotesOf(dir)
  assert.equal(remotes.length, 1)
  assert.equal(remotes[0].url.includes('ghp_S3CRET'), false)
  assert.match(remotes[0].url, /^https:\/\/.*@github\.com\/me\/repo\.git$/)
})

test('redactRemoteUrl covers the shapes a token hides in', () => {
  assert.equal(redactRemoteUrl('https://user:ghp_x@github.com/me/r.git'), 'https://user@github.com/me/r.git')
  assert.equal(redactRemoteUrl('https://ghp_x@github.com/me/r.git'), 'https://***@github.com/me/r.git')
  assert.equal(redactRemoteUrl('https://oauth2:abc@gitlab.com/me/r.git'), 'https://***@gitlab.com/me/r.git')
  assert.equal(redactRemoteUrl('git@github.com:me/r.git'), 'git@github.com:me/r.git')
  assert.equal(redactRemoteUrl('https://github.com/me/r.git'), 'https://github.com/me/r.git')
  assert.equal(redactRemoteUrl(''), '')
})

test('slugFromRemoteUrl only answers for GitHub', () => {
  assert.equal(slugFromRemoteUrl('git@github.com:me/repo.git'), 'me/repo')
  assert.equal(slugFromRemoteUrl('ssh://git@github.com/me/repo.git'), 'me/repo')
  assert.equal(slugFromRemoteUrl('https://github.com/me/repo.git'), 'me/repo')
  assert.equal(slugFromRemoteUrl('https://user:token@github.com/me/repo'), 'me/repo')
  // Any other host has the same `user@host:owner/repo` shape; returning a slug
  // for it built a github.com link to somebody else's repository.
  assert.equal(slugFromRemoteUrl('git@gitlab.com:me/repo.git'), null)
  assert.equal(slugFromRemoteUrl('git@gitea.example:me/repo.git'), null)
  assert.equal(slugFromRemoteUrl('https://gitlab.com/me/repo'), null)
  assert.equal(slugFromRemoteUrl(''), null)
})

// ---- path guard ------------------------------------------------------------

test('isInsideRoot and isPlausibleRepoPath cover the lexical edge cases', () => {
  assert.equal(isInsideRoot('/repo', '/repo'), true)
  assert.equal(isInsideRoot('/repo', '/repo/a/b'), true)
  assert.equal(isInsideRoot('/repo', '/repo-sibling/a'), false)
  assert.equal(isInsideRoot('/repo', '/etc/passwd'), false)
  assert.equal(isPlausibleRepoPath('a/b.txt'), true)
  assert.equal(isPlausibleRepoPath('/etc/passwd'), false)
  assert.equal(isPlausibleRepoPath('../x'), false)
  assert.equal(isPlausibleRepoPath('a/../../x'), false)
  assert.equal(isPlausibleRepoPath('a\0b'), false)
  assert.equal(isPlausibleRepoPath(''), false)
})

test('resolveInsideRepo refuses symlinks and missing files', async () => {
  const dir = initRepo('gs-guard-')
  writeFileSync(join(dir, 'plain.txt'), 'x\n')
  assert.ok(await resolveInsideRepo(dir, 'plain.txt'))
  assert.equal(await resolveInsideRepo(dir, 'missing.txt'), null)
  assert.equal(await resolveInsideRepo(dir, '/etc/passwd'), null)
  assert.equal(await resolveInsideRepo(dir, '../escape.txt'), null)
})

// ---- run.js: the output cap is real ---------------------------------------

test('runCommand stops reading past maxBuffer instead of buffering everything', async () => {
  const big = await runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(200000))'], {
    allowFailure: true,
    maxBuffer: 1000,
  })
  assert.equal(big, null, 'killed and reported as failure, not silently truncated')
  const small = await runCommand(process.execPath, ['-e', 'process.stdout.write("ok")'], { maxBuffer: 1000 })
  assert.equal(small, 'ok')
  assert.ok(DEFAULT_MAX_BUFFER >= 1_000_000)
})

test('fileDiffOf bounds what git may emit', async () => {
  const dir = initRepo('gs-bigdiff-')
  // A large untracked file: the read itself must be capped, not just the copy.
  writeFileSync(join(dir, 'huge.txt'), `${'y'.repeat(400)}\n`.repeat(2000))
  const out = await fileDiffOf(dir, 'huge.txt', { maxBytes: 500, allowAddedFallback: true })
  assert.equal(out.truncated, false, 'oversized files are refused, not truncated')
  assert.equal(out.diff, '')
})

// ---- statusShaOf -----------------------------------------------------------

test('statusShaOf covers both halves of a rename and ignores order', () => {
  // With --no-renames the two names are two entries; both must move the hash.
  const a = statusShaOf([{ path: 'b.txt', origPath: null }])
  const b = statusShaOf([{ path: 'b.txt', origPath: null }, { path: 'a.txt', origPath: null }])
  const c = statusShaOf([{ path: 'a.txt', origPath: null }, { path: 'b.txt', origPath: null }])
  assert.equal(a, statusShaOf([{ path: 'b.txt', origPath: null }]))
  assert.notEqual(a, b)
  assert.equal(b, c, 'order does not matter')
  assert.equal(statusShaOf([]), statusShaOf(null))
})
