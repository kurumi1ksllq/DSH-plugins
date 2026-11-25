import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  MERGED_PR_LIMIT,
  OPEN_LIST_LIMIT,
  forgeHintFor,
  forgeRemoteOf,
  openIssues,
  openPullRequests,
  prChecks,
  recentlyMergedPullRequests,
  repoArgs,
  slugFromRemoteUrl,
} from '../lib-git-status/gh.js'
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
function stubGh({ argvFile, checksArgvFile, issues = [], prs = [], merged = [], checks = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gh-repo-arg-'))
  const record = argvFile === undefined ? '' : `printf '%s\\n' "$*" >> '${argvFile}'\n`
  // Separate log for `pr checks`, so a test can count how many CI queries one
  // snapshot spawns without filtering every other call out of one file.
  const checksRecord = checksArgvFile === undefined
    ? ''
    : `case "$1 $2" in "pr checks") printf '%s\\n' "$*" >> '${checksArgvFile}' ;; esac\n`
  const script = [
    '#!/bin/sh',
    record,
    checksRecord,
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

// Fixture self-check, not product behaviour: it proves the stub really rejects a
// call without --repo. If this ever passes with a broken stub, every other case
// here is silently green for the wrong reason.
test('fixture: the stub rejects a query with no --repo, so the cases above can fail', async () => {
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
  // Pin the exported constant rather than the literal: asserting only `> 20`
  // let a future edit quietly shrink the window to 25 and stay green.
  assert.equal(Number(limit[1]), MERGED_PR_LIMIT)
  assert.ok(MERGED_PR_LIMIT > 20, 'the old window of 20 hid merges this repository still has branches for')
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
// ---- the resolver that names the repository --------------------------------
// The first cut of #199 fixed only the single-remote case. These cover the three
// shapes that were still broken, each found by review rather than by the suite:
// a port in the URL, an origin that is not GitHub, and a fork clone whose PRs
// live on `upstream`.

test('slugFromRemoteUrl consumes an explicit port instead of reading it as the owner', () => {
  // `https://github.com:443/me/repo` used to yield `443/me/repo`. That was only a
  // bad deep link until the slug started naming the target of every gh query —
  // then it became a query against a repository that does not exist.
  assert.equal(slugFromRemoteUrl('https://github.com:443/me/repo.git'), 'me/repo')
  assert.equal(slugFromRemoteUrl('ssh://git@github.com:22/me/repo.git'), 'me/repo')
})

test('repoArgs refuses a malformed slug, because a wrong --repo is worse than none', () => {
  assert.deepEqual(repoArgs('443/me/repo'), [])
  assert.deepEqual(repoArgs('me/repo/extra'), [])
  assert.deepEqual(repoArgs('me repo'), [])
  assert.deepEqual(repoArgs('me/repo'), ['--repo', 'me/repo'])
})

test('forgeRemoteOf prefers upstream over origin, as gh does for a fork clone', () => {
  // gh selects `upstream` when it exists (verified against gh 2.62.0). Naming
  // `origin` unconditionally would point a fork clone at its own fork, where no
  // PR or issue matches the local `issue-*` branches — #199's symptom again.
  const remotes = [
    { name: 'origin', url: 'https://github.com/me/fork.git' },
    { name: 'upstream', url: 'https://github.com/real/repo.git' },
  ]
  assert.equal(forgeRemoteOf(remotes)?.slug, 'real/repo')
})

test('forgeRemoteOf falls back to any GitHub remote when origin is not GitHub', () => {
  // The gate accepted this shape (some remote is GitHub) while the slug only read
  // origin (null) — so the queries ran with no --repo and failed exactly as before
  // the fix. Both now come from this one resolver.
  const remotes = [
    { name: 'origin', url: 'https://gitlab.com/me/repo.git' },
    { name: 'mirror', url: 'https://github.com/me/repo.git' },
  ]
  assert.equal(forgeRemoteOf(remotes)?.slug, 'me/repo')
  assert.equal(forgeHintFor({ remotes, gh: { available: true, loggedIn: true } }), null)
})

test('a repo whose only remote is not GitHub still degrades to no slug', () => {
  const remotes = [{ name: 'origin', url: 'https://gitlab.com/me/repo.git' }]
  assert.equal(forgeRemoteOf(remotes), null)
  assert.equal(forgeHintFor({ remotes, gh: { available: true, loggedIn: true } }), 'not-github')
})

test('getSnapshot reads the slug from upstream, not origin, in a fork clone', async () => {
  const repo = initRepoWithOrigin()
  execFileSync(GIT, ['remote', 'add', 'upstream', 'https://github.com/real/repo.git'], { cwd: repo })
  const dir = stubGh({ issues: [], prs: [], merged: [], checks: [] })
  invalidateSnapshot()
  const snapshot = await withPath(dir, () => getSnapshot({ force: true, sessionCwd: repo, env: {} }))
  assert.equal(snapshot.repoSlug, 'real/repo')
})
// ---- the CI column, and the window's actual payoff -------------------------
// Axis-B review found both of these uncovered: breaking the slug passthrough
// into prChecks left the whole suite green while the CI column silently turned
// 'unknown' in the real repository, and truncating the merged list back to 20 in
// JS (argv still saying 200) was invisible because the test only read argv.

test('getSnapshot passes the repository down to the CI lookup', async () => {
  const repo = initRepoWithOrigin()
  // One open PR whose head matches the local branch, and a green check for it.
  const dir = stubGh({
    prs: [{ number: 3, headRefName: 'issue-1-first', url: 'https://github.com/me/repo/pull/3' }],
    checks: [{ state: 'SUCCESS' }],
  })
  invalidateSnapshot()
  const snapshot = await withPath(dir, () => getSnapshot({ force: true, sessionCwd: repo, env: {} }))
  // 'unknown' is what a missing --repo degrades to — the silent failure mode
  // this whole fix exists to remove, now one level deeper than the PR list.
  assert.equal(snapshot.checks[3], 'green')
})

test('a merge older than the newest 20 still lands the branch in done', async () => {
  const repo = initRepoWithOrigin()
  // 25 merges; the branch under test is the OLDEST, i.e. the one a window of 20
  // would drop. gh orders by createdAt, so this is the real shape of the bug.
  const merged = []
  for (let i = 0; i < 24; i += 1) merged.push({ number: 100 + i, headRefName: `issue-${100 + i}-other` })
  merged.push({ number: 999, headRefName: 'issue-1-first' })
  const dir = stubGh({ merged })
  invalidateSnapshot()
  const snapshot = await withPath(dir, () => getSnapshot({ force: true, sessionCwd: repo, env: {} }))
  const card = snapshot.board.columns.flatMap((c) => c.cards).find((c) => c.issue === 1)
  assert.equal(card?.stage, 'done', 'a merge outside the newest 20 must still count as merge evidence')
})

// ---- #243: a 30-row window was a silent one -------------------------------

test('#243 the open PR and issue queries ask for far more than the old 30', async () => {
  const argvFile = join(mkdtempSync(join(tmpdir(), 'gh-argv-')), 'argv.txt')
  const dir = stubGh({
    argvFile,
    issues: issuePayload,
    prs: [{ number: 3, headRefName: 'issue-1-first' }],
  })
  await withPath(dir, () => openPullRequests('/tmp', 'me/repo'))
  await withPath(dir, () => openIssues('/tmp', 'me/repo'))
  const openCalls = readFileSync(argvFile, 'utf8').split('\n').filter((line) => line.includes('--state open'))
  assert.equal(openCalls.length, 2, 'both open lists must have run')
  for (const call of openCalls) {
    const limit = /--limit (\d+)/.exec(call)
    assert.ok(limit !== null, 'the open lists must bound their window explicitly')
    assert.equal(Number(limit[1]), OPEN_LIST_LIMIT)
  }
  // Pin the number itself. Asserting "bigger than 30" let the constant drift to
  // 31 and stay green, which is the same silent window with a new value.
  assert.equal(OPEN_LIST_LIMIT, 200)
})

test('#243 a list that fills the query cap is flagged in the snapshot', async () => {
  const repo = initRepoWithOrigin()
  const many = Array.from({ length: OPEN_LIST_LIMIT }, (_, i) => ({
    number: i + 1, title: `t${i + 1}`, author: { login: 'me' }, labels: [],
    url: `https://github.com/me/repo/issues/${i + 1}`,
  }))
  const full = stubGh({ issues: many })
  invalidateSnapshot()
  const flagged = await withPath(full, () => getSnapshot({ force: true, sessionCwd: repo, env: {} }))
  assert.equal(flagged.issuesTruncated, true, 'a full window must be reported as truncated')
  assert.equal(flagged.prsTruncated, false)

  const partial = stubGh({ issues: issuePayload })
  invalidateSnapshot()
  const short = await withPath(partial, () => getSnapshot({ force: true, sessionCwd: repo, env: {} }))
  assert.equal(short.issuesTruncated, false, 'a short window is simply the whole list')
})

test('#243 a full PR window is flagged too, and its checks are not fetched for unplaceable PRs', async () => {
  const repo = initRepoWithOrigin()
  const many = Array.from({ length: OPEN_LIST_LIMIT }, (_, i) => ({
    number: 100 + i, title: `p${i}`, headRefName: i === 0 ? 'issue-1-first' : `feature/${i}`,
    baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', url: `https://github.com/me/repo/pull/${100 + i}`,
  }))
  const checksLog = join(mkdtempSync(join(tmpdir(), 'gh-checks-')), 'checks.txt')
  const dir = stubGh({ prs: many, checksArgvFile: checksLog })
  invalidateSnapshot()
  const snapshot = await withPath(dir, () => getSnapshot({ force: true, sessionCwd: repo, env: {} }))
  assert.equal(snapshot.prsTruncated, true, 'a full PR window must be reported as truncated')
  // 200 open PRs must not mean 200 `gh pr checks` spawns: only the one PR whose
  // head branch exists locally gets a card.
  const calls = readFileSync(checksLog, 'utf8').split('\n').filter((line) => line.includes('pr checks'))
  assert.equal(calls.length, 1, `expected one checks call, got ${calls.length}`)
})
