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
  ghStatus,
  openIssues,
  openPullRequests,
  recentlyMergedPullRequests,
  slugFromRemoteUrl,
} from './gh.js'
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
 * @param {string} iso
 * @param {number} [now]
 */
export function relativeTime(iso, now = Date.now()) {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'} ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.round(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
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

  const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0] ?? null
  const gh = await ghStatus(env)
  // Named reason for a missing forge section: not installed / not logged in /
  // no remote at all / remote is not GitHub. Without it the panel can only say
  // "gh failed", which is wrong for a local repo with no remote.
  const forgeHint = forgeHintFor({ remotes, gh })
  let prs = null
  let mergedPrs = null
  let issues = null
  if (forgeHint === null) {
    ;[prs, mergedPrs, issues] = await Promise.all([
      openPullRequests(workspace.dir),
      recentlyMergedPullRequests(workspace.dir),
      openIssues(workspace.dir),
    ])
  }

  return {
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
    },
    gh,
    forgeHint,
    repoSlug: origin ? slugFromRemoteUrl(origin.url) : null,
    prs,
    mergedPrs,
    issues,
  }
}

/**
 * Read-only diff for one changed path (issue #22). Resolves the workspace the
 * same way `getSnapshot` does, so the diff always belongs to the repo the panel
 * is describing — never to whatever directory the host process sits in.
 * @param {object} opts same options as `getSnapshot`
 * @param {string} path repo-relative path
 * @returns {Promise<{path:string,diff:string,truncated:boolean}|null>}
 */
export async function getDiff(opts = {}, path) {
  const env = opts.env ?? process.env
  const sessionCwd = opts.sessionCwd ?? (await sessionCwdOf(opts, opts.sessionId))
  const workspace = await pickWorkspace({ cwd: sessionCwd ?? undefined, env })
  if (workspace.reason !== 'git' || !workspace.dir) return null
  if (typeof path !== 'string' || path.length === 0) return null
  // A path that escapes the worktree is not a path this panel may read.
  if (path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) return null
  return fileDiffOf(workspace.dir, path)
}
