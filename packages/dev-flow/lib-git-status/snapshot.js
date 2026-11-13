/**
 * Snapshot assembly: one payload with everything the Git panel shows.
 *
 * The snapshot is cached for 30 seconds per (Session, resolved workspace) PAIR
 * (issue #21): the workspace is the Session's header cwd, which can change
 * inside one Session (`cd`, a new worktree, a sub-project), so keying by the
 * Session alone served the previous repo for up to 30 seconds. `?refresh=1`
 * (or `force`) rebuilds it.
 * Every collector is failure-isolated: a broken git or gh call degrades that
 * section instead of failing the whole route.
 */

import {
  aheadCommitsOf,
  branchesOf,
  fileDiffOf,
  recentCommitsOf,
  remotesOf,
  stashCountOf,
  stashListOf,
  statusOf,
} from './git-info.js'
import {
  forgeHintFor,
  forgeRemoteOf,
  ghStatus,
  openIssues,
  openPullRequests,
  prChecks,
  recentlyMergedPullRequests,
} from './gh.js'
import { createHash } from 'node:crypto'

import { resolveInsideRepo } from './path-guard.js'
import { readFlowStates } from './flow-state.js'
import { buildTaskBoard } from './task-board.js'
import { pickWorkspace, sessionCwdOf } from './workspace.js'

const CACHE_TTL_MS = 30_000

/** One entry per requested (Session id, resolved workspace) pair. */
const cache = new Map()

export function invalidateSnapshot() {
  cache.clear()
}

/**
 * Human "3 hours ago" for an ISO timestamp (issue #20). Stashes carry an
 * absolute date because `git stash list --date=relative` would corrupt the
 * `stash@{n}` selector, so the relative wording is derived here.
 *
 * The unit is chosen by elapsed magnitude and the count FLOORED, never
 * rounded: rounding promoted 59.5 s to "1 minute" and re-rounded at every
 * step (23.6 h became "1 day"), reporting an event that has not happened yet.
 * A unit is only entered once the elapsed time really reaches it, so the
 * wording never overstates the age.
 * @param {string} iso
 * @param {number} [now]
 */
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function relativeTime(iso, now = Date.now()) {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < MINUTE) return plural(seconds, 'second')
  if (seconds < HOUR) return plural(Math.floor(seconds / MINUTE), 'minute')
  if (seconds < DAY) return plural(Math.floor(seconds / HOUR), 'hour')
  if (seconds < MONTH) return plural(Math.floor(seconds / DAY), 'day')
  if (seconds < YEAR) return plural(Math.floor(seconds / MONTH), 'month')
  return plural(Math.floor(seconds / YEAR), 'year')
}

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

/**
 * Cache key: the Session AND the workspace it currently points at.
 * Both halves matter — two Sessions can share a workspace, and one Session can
 * move between workspaces.
 */
export function cacheKeyOf({ sessionId, workspace }) {
  const id = typeof sessionId === 'string' ? sessionId : ''
  const dir = typeof workspace === 'string' ? workspace : ''
  return `${id}\0${dir}`
}

/**
 * Build (or read from cache) the git-status snapshot.
 * @param {object} [opts]
 * @param {boolean} [opts.force] bypass the cache
 * @param {string} [opts.sessionId] Session whose header cwd is the workspace
 * @param {string} [opts.sessionCwd] explicit workspace cwd (overrides the Session)
 * @param {object} [opts.sessions] `sessions` service, to read a live header
 * @param {object} [opts.sessionPersistence] `sessionPersistence` service
 * @param {object} [opts.env] passthrough env for tests
 */
export async function getSnapshot(opts = {}) {
  const env = opts.env ?? process.env
  const sessionCwd = opts.sessionCwd ?? (await sessionCwdOf(opts, opts.sessionId))
  const workspace = await pickWorkspace({ cwd: sessionCwd ?? undefined, env })
  const key = cacheKeyOf({ sessionId: opts.sessionId, workspace: workspace.dir })

  const hit = cache.get(key)
  if (!opts.force && hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.payload
  }
  const payload = await buildSnapshot({ env, sessionCwd, workspace })
  cache.set(key, { at: Date.now(), payload })
  return payload
}

async function buildSnapshot({ env, sessionCwd, workspace }) {
  const base = {
    workspace: workspace.dir,
    sessionCwd: sessionCwd ?? null,
    isGit: false,
    git: null,
    gh: { available: false, loggedIn: false, reason: 'not-installed' },
    forgeHint: null,
    repoSlug: null,
    prs: null,
    mergedPrs: null,
    issues: null,
    // CI state per PR number ('green'|'red'|'none'|'unknown'), filled below.
    checks: {},
    // dev-flow task state read from docs/specs/.flow/<issue>.json, keyed by
    // issue number. A plain object, NOT a Map: the route JSON.stringify's this
    // payload, and a Map becomes `{}` on the wire — the browser would then show
    // every card with no progress at all.
    flowStates: {},
    // The board itself, computed here so the browser only renders. Re-deriving
    // it client-side meant two implementations that drifted.
    board: null,
    generatedAt: new Date().toISOString(),
  }

  if (workspace.reason !== 'git' || !workspace.dir) {
    return { ...base, isGit: false, reason: workspace.reason }
  }

  const [status, branches, commits, remotes, rawStashes, stashCount, aheadCommits] = await Promise.all([
    statusOf(workspace.dir),
    branchesOf(workspace.dir),
    recentCommitsOf(workspace.dir, 10),
    remotesOf(workspace.dir),
    stashListOf(workspace.dir),
    stashCountOf(workspace.dir),
    aheadCommitsOf(workspace.dir),
  ])
  // Stash rows carry an absolute date plus the relative wording the panel shows.
  const now = Date.now()
  const stashList = rawStashes.map((s) => ({
    ref: s.ref,
    when: relativeTime(s.when, now),
    subject: s.subject,
  }))

  // The remote that names the forge repository: upstream first, then origin,
  // then any remote that parses as GitHub. Used for BOTH the gate and the slug
  // so the two cannot disagree (they did — issue #199 review).
  const forgeRemote = forgeRemoteOf(remotes)
  const gh = await ghStatus(env)
  // Named reason for a missing forge section: not installed / not logged in /
  // no remote at all / remote is not GitHub. Without it the panel can only say
  // "gh failed", which is wrong for a local repo with no remote.
  const forgeHint = forgeHintFor({ remotes, gh })
  // GitHub deep links may only point at GitHub: `git@gitlab.com:me/repo.git`
  // has the same `owner/repo` shape, and github.com/<it> is someone else's repo.
  //
  // Resolved BEFORE the forge queries rather than after: every gh call names the
  // repository explicitly (issue #199). gh's own resolution reads the workspace
  // remotes, which `url.<mirror>.insteadOf` rewrites — gh then refuses to run and
  // every query returned empty.
  const repoSlug = forgeHint === 'not-github' ? null : forgeRemote?.slug ?? null

  let prs = null
  let mergedPrs = null
  let issues = null
  if (forgeHint === null) {
    ;[prs, mergedPrs, issues] = await Promise.all([
      openPullRequests(workspace.dir, repoSlug),
      recentlyMergedPullRequests(workspace.dir, repoSlug),
      openIssues(workspace.dir, repoSlug),
    ])
  }

  // CI state per open PR. One `gh` call each, so the pool stays small: the panel
  // is a task board, not a CI dashboard, and `unknown` degrades quietly.
  const checks = await checksOf(workspace.dir, prs, repoSlug)

  // Which issues the board will draw: everything open, plus whatever the local
  // `issue-<n>-*` branches name, so a repo without forge access still gets cards.
  const issueNumbers = [
    ...(Array.isArray(issues) ? issues.map((i) => i?.number) : []),
    ...branches.map((b) => issueNumberOf(b?.name)).filter((n) => n !== null),
  ]
  const flowMap = await readFlowStates(workspace.dir, issueNumbers)
  // Map → plain object so the state survives JSON.stringify on the way out.
  const flowStates = Object.fromEntries(flowMap)

  const snapshot = {
    ...base,
    // The Session's own directory, which may sit below the repo root.
    sessionCwd: sessionCwd ?? null,
    isGit: true,
    git: {
      status,
      branches,
      commits,
      remotes,
      stashes: stashCount,
      stashList,
      aheadCommits,
      // Everything the panel needs to build forge deep links (issue #22).
      currentBranch: status.detached ? null : status.branch,
      // Lets the diff route prove the client asks about the list it rendered.
      statusSha: statusShaOf(status.changes),
    },
    gh,
    forgeHint,
    repoSlug,
    prs,
    mergedPrs,
    issues,
    checks,
    flowStates,
  }
  // The board is derived on the host, once, from the same evidence the raw
  // fields carry — so the browser cannot disagree with the API about stages.
  snapshot.board = buildTaskBoard({ ...snapshot, flowStates: flowMap })
  return snapshot
}

/** Small pool so a repo with many PRs cannot flood the gh CLI. */
const CHECK_CONCURRENCY = 4

/**
 * CI state for every open PR, keyed by PR number.
 *
 * Failures are not fatal: a PR missing from the map reads as `unknown` on the
 * board, which is the honest answer when `gh` could not be asked.
 * @returns {Promise<Record<number, string>>}
 */
async function checksOf(repoDir, prs, repoSlug) {
  if (!Array.isArray(prs) || prs.length === 0) return {}
  const numbers = prs.map((p) => p?.number).filter((n) => Number.isInteger(n) && n > 0)
  const out = {}
  for (let i = 0; i < numbers.length; i += CHECK_CONCURRENCY) {
    const slice = numbers.slice(i, i + CHECK_CONCURRENCY)
    const states = await Promise.all(slice.map((n) => prChecks(repoDir, n, repoSlug)))
    slice.forEach((n, idx) => {
      out[n] = states[idx]
    })
  }
  return out
}

/** `issue-<n>-<desc>` → n; anything else → null. Mirrors the board's mapping. */
function issueNumberOf(branchName) {
  if (typeof branchName !== 'string') return null
  const match = /^issue-(\d+)-/.exec(branchName)
  if (!match) return null
  const n = Number(match[1])
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Stable hash of the changed-path set a snapshot carries. */
export function statusShaOf(changes) {
  const paths = new Set()
  for (const change of changes ?? []) {
    if (change?.path) paths.add(change.path)
    if (change?.origPath) paths.add(change.origPath)
  }
  return createHash('sha1').update([...paths].sort().join('\0')).digest('hex')
}

/**
 * Read-only diff for one changed path (issue #22). Resolves the workspace the
 * same way `getSnapshot` does, so the diff always belongs to the repo the panel
 * is describing — never to whatever directory the host process sits in.
 *
 * The path is NOT trusted: `/git-status/diff` answers any same-origin request.
 * Three gates must pass before a byte is read:
 *   1. the path is one `git status` currently reports (allowlist of
 *      `changes[].path` + `origPath`),
 *   2. it resolves — symlinks included — to a real file inside the worktree,
 *   3. only an untracked, non-symlink file may be rendered from its contents.
 * Without (1) and (3) a clean but committed file was served in full as a "new
 * file", under any name the caller invented.
 *
 * @param {object} opts same options as `getSnapshot` (+ `statusSha`)
 * @param {string} path repo-relative path
 * @returns {Promise<{status:'ok'|'missing'|'not-changed'|'truncated'|'outside',payload:object|null,statusSha:string|null}>}
 */
export async function getDiffResult(options = {}, path) {
  const opts = options ?? {}
  const env = opts.env ?? process.env
  const sessionCwd = opts.sessionCwd ?? (await sessionCwdOf(opts, opts.sessionId))
  const workspace = await pickWorkspace({ cwd: sessionCwd ?? undefined, env })
  if (workspace.reason !== 'git' || !workspace.dir) return { status: 'outside', payload: null, statusSha: null }
  if (typeof path !== 'string' || path.length === 0) return { status: 'missing', payload: null, statusSha: null }

  const status = await statusOf(workspace.dir)
  const sha = statusShaOf(status.changes)
  if (typeof opts.statusSha === 'string' && opts.statusSha.length > 0 && opts.statusSha !== sha) {
    // The client rendered a different list (file reverted, list refreshed):
    // refuse instead of guessing what it wants.
    return { status: 'not-changed', payload: null, statusSha: sha }
  }
  const change = status.changes.find((c) => c.path === path || c.origPath === path)
  if (change === undefined) {
    // `git status` carries only MAX_CHANGES entries: a path past the cap is
    // counted but not listed. Say so instead of pretending it has no diff.
    if (status.changesTruncated) return { status: 'truncated', payload: null, statusSha: sha }
    return { status: 'not-changed', payload: null, statusSha: sha }
  }

  // A deleted path has no file left to resolve, yet its diff is a real diff of
  // this repo; the containment (and symlink) checks run on the location.
  const deleted = change.worktree === 'D' || change.index === 'D'
  const absolute = await resolveInsideRepo(workspace.dir, path, { allowSymlink: false, allowMissing: deleted })
  if (absolute === null) return { status: 'outside', payload: null, statusSha: sha }

  const payload = await fileDiffOf(workspace.dir, absolute, {
    // A tracked path with no diff means "nothing changed", not "new file".
    allowAddedFallback: change.untracked === true,
    displayPath: path,
  })
  if (payload === null || payload.diff.length === 0) return { status: 'not-changed', payload: null, statusSha: sha }
  return { status: 'ok', payload, statusSha: sha }
}

/**
 * Backwards-compatible wrapper: the diff payload, or null when the path may
 * not be read or has no diff.
 * @param {object} opts same options as `getSnapshot`
 * @param {string} path repo-relative path
 */
export async function getDiff(opts = {}, path) {
  const result = await getDiffResult(opts, path)
  return result.status === 'ok' ? result.payload : null
}
