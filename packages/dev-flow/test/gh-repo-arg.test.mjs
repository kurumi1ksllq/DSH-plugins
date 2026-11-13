import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { openIssues, openPullRequests, prChecks, recentlyMergedPullRequests } from '../lib-git-status/gh.js'
import { getSnapshot, invalidateSnapshot } from '../lib-git-status/snapshot.js'

const GIT = process.env.GIT_IN_PATH ?? 'git'

/**
 * A stub `gh` that reproduces a mirror-configured machine.
 *
 * gh resolves its target repository from the workspace remotes. When git is
 * configured with `url.<mirror>.insteadOf https://github.com/`, `git remote -v`
 * reports the mirror URL, gh no longer recognises the host, and EVERY repository
 * query exits non-zero with "none of the git remotes configured for this
 * repository point to a known GitHub host". Only an explicit `--repo` gets an
 * answer.
 *
 * That is the shape of issue #199: the panel showed months-old merged issues as
 * still in development because all forge data came back empty and the board fell
 * back to drawing cards from leftover local branches.
 *
 * `--version` and `auth status` are host facts rather than repository queries, so
 * the stub answers them unconditionally — otherwise `ghStatus()` would report
 * "gh not installed" and the forge queries would never be reached at all.
 */
function stubGh({ argvFile, issues = [], prs = [], merged = [], checks = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gh-repo-arg-'))
  const record = argvFile === undefined ? '' : `printf '%s\\n' "$*" >> '${argvFile}'\n`
  const script = [
    '#!/bin/sh',
    record,
    'if [ "$1" = "--version" ]; then echo "gh version 2.62.0"; exit 0; fi',
    'if [ "$1 $2" = "auth status" ]; then echo "Logged in to github.com"; exit 0; fi',
    'case "$*" in',
    '  *"--repo me/repo"*) ;;',
    '  *) echo "none of the git remotes configured for this repository point to a known GitHub host." >&2; exit 4 ;;',
    'esac',
    'case "$1 $2" in',
    `  "issue list") printf '%s' '${JSON.stringify(issues)}' ;;`,
    `  "pr list") case "$*" in *"--state merged"*) printf '%s' '${JSON.stringify(merged)}' ;; *) printf '%s' '${JSON.stringify(prs)}' ;; esac ;;`,
    `  "pr checks") printf '%s' '${JSON.stringify(checks)}' ;;`,
    `  *) printf '%s' '[]' ;;`,
    'esac',
    '',
  ].join('\n')
  writeFileSync(join(dir, 'gh'), script)
  chmodSync(join(dir, 'gh'), 0o755)
  return dir
}

async function withPath(dir, fn) {
  const previous = process.env.PATH
  process.env.PATH = `${dir}:${previous}`
  try {
    return await fn()
  } finally {
    process.env.PATH = previous
  }
}

/** A repo whose origin is GitHub, as `git config --local` reports it. */
function initRepoWithOrigin() {
  const dir = mkdtempSync(join(tmpdir(), 'gh-repo-arg-repo-'))
  execFileSync(GIT, ['init', '-b', 'main'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.name', 'Test'], { cwd: dir })
  execFileSync(GIT, ['remote', 'add', 'origin', 'https://github.com/me/repo.git'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  execFileSync(GIT, ['add', '.'], { cwd: dir })
  execFileSync(GIT, ['commit', '-m', 'init'], { cwd: dir })
  execFileSync(GIT, ['checkout', '-q', '-b', 'issue-1-first'], { cwd: dir })
  writeFileSync(join(dir, 'b.txt'), 'more\n')
  execFileSync(GIT, ['add', '.'], { cwd: dir })
  execFileSync(GIT, ['commit', '-m', 'work'], { cwd: dir })
  return dir
}

const issuePayload = [
  { number: 7, title: 'an issue', author: { login: 'me' }, labels: [], url: 'https://github.com/me/repo/issues/7' },
]

test('openIssues names the repository, so a mirror-rewritten remote cannot break it', async () => {
  const dir = stubGh({ issues: issuePayload })
  const got = await withPath(dir, () => openIssues('/tmp', 'me/repo'))
  assert.equal(got?.[0]?.number, 7)
})

test('openIssues without a slug is what the stub refuses — so this suite can go red', async () => {
  const dir = stubGh({ issues: issuePayload })
  assert.equal(await withPath(dir, () => openIssues('/tmp')), null)
})

test('openPullRequests and prChecks name the repository too', async () => {
  const dir = stubGh({ prs: [{ number: 3, headRefName: 'issue-1-first' }], checks: [{ state: 'SUCCESS' }] })
  assert.equal((await withPath(dir, () => openPullRequests('/tmp', 'me/repo')))?.[0]?.number, 3)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 3, 'me/repo')), 'green')
})

test('recentlyMergedPullRequests asks for more than the newest 20 merges', async () => {
  const argvFile = join(mkdtempSync(join(tmpdir(), 'gh-argv-')), 'argv.txt')
  const dir = stubGh({ argvFile, merged: [{ number: 9, headRefName: 'issue-1-first' }] })
  const got = await withPath(dir, () => recentlyMergedPullRequests('/tmp', 'me/repo'))
  assert.equal(got?.[0]?.number, 9)
  // The window is what made finished tasks look unfinished: the repo has 86
  // merged PRs, so a window of 20 left older branches without merge evidence.
  const mergedCall = readFileSync(argvFile, 'utf8')
    .split('\n')
    .find((line) => line.includes('--state merged'))
  assert.ok(mergedCall !== undefined, 'the merged query must have run')
  const limit = /--limit (\d+)/.exec(mergedCall)
  assert.ok(limit !== null, 'the merged query must bound its window explicitly')
  assert.ok(Number(limit[1]) > 20, `a window of ${limit[1]} cannot see every merge a branch may have`)
})

test('getSnapshot threads the repository into every forge query', async () => {
  const repo = initRepoWithOrigin()
  const dir = stubGh({ issues: issuePayload, prs: [], merged: [], checks: [] })
  invalidateSnapshot()
  const snapshot = await withPath(dir, () => getSnapshot({ force: true, sessionCwd: repo, env: {} }))
  assert.equal(snapshot.repoSlug, 'me/repo')
  assert.equal(snapshot.forgeHint, null)
  assert.equal(snapshot.issues?.[0]?.number, 7, 'the board needs the forge data, not just the slug')
  const card = snapshot.board.columns.flatMap((c) => c.cards).find((c) => c.issue === 7)
  assert.ok(card !== undefined, 'the issue must reach the board')
})
