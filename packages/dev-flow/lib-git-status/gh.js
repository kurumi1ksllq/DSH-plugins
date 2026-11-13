/**
 * GitHub data through the `gh` CLI — the only forge integration in v1.
 *
 * Why the CLI and not the API: the login/token problem is already solved by
 * `gh auth login`, and no token is ever stored or read by this plugin. When
 * `gh` is missing, not logged in, or the remote is not GitHub, the snapshot
 * simply has no PR/issue data and the panel shows a hint instead.
 */

import { runCommand } from './run.js'

/**
 * Derive `owner/repo` from a GITHUB remote URL (ssh or https).
 *
 * Only github.com counts. `git@gitlab.com:me/repo.git` has exactly the same
 * `user@host:owner/repo` shape, and returning `me/repo` for it built a
 * github.com/<me>/<repo> link — someone else's repository, opened in the
 * panel's "open on GitHub" affordance (the forge is not GitHub at all).
 *
 * An explicit port is consumed, never captured: without `(?::\d+)?` the https
 * form read `https://github.com:443/me/repo` as `443/me/repo`. That used to
 * only spoil one deep link; once the slug started naming the target of every
 * gh query (issue #199) it would have pointed gh at a repository that does not
 * exist, which is worse than passing no slug at all.
 * @returns {string|null}
 */
export function slugFromRemoteUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null
  const scp = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url)
  if (scp) return `${scp[1]}/${scp[2]}`
  const ssh = /^ssh:\/\/git@github\.com(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url)
  if (ssh) return `${ssh[1]}/${ssh[2]}`
  const https = /^(?:https?:\/\/)?(?:[^/@\s]+@)?(?:www\.)?github\.com(?::\d+)?[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url)
  if (https) return `${https[1]}/${https[2]}`
  return null
}

/**
 * The remote that names the forge repository, or null.
 *
 * One resolver for BOTH consumers — the forge hint and the `--repo` slug — so
 * they cannot disagree. They did: the hint accepted a GitHub URL on ANY remote
 * while the slug only read `origin ?? remotes[0]`, so a repo whose origin was
 * GitLab and whose upstream was GitHub passed the gate and then queried with no
 * `--repo` at all, leaving issue #199 unfixed for exactly that shape.
 *
 * The order mirrors gh's own: `upstream` wins, then `origin`, then anything
 * that parses. gh prefers `upstream` because that is the fork-clone convention —
 * the PRs and issues live in the upstream repository, not in the fork. Taking
 * `origin` unconditionally would point a fork clone at its own empty fork and
 * re-create the "finished work looks unfinished" symptom.
 * @param {Array<{name:string,url:string}>} remotes
 * @returns {{name:string,url:string,slug:string}|null}
 */
export function forgeRemoteOf(remotes) {
  if (!Array.isArray(remotes) || remotes.length === 0) return null
  const named = (name) => remotes.find((remote) => remote?.name === name)
  const ordered = [named('upstream'), named('origin'), ...remotes].filter(Boolean)
  for (const remote of ordered) {
    const slug = slugFromRemoteUrl(remote.url)
    if (slug !== null) return { name: remote.name, url: remote.url, slug }
  }
  return null
}

/**
 * `gh` presence and login.
 *
 * The login probe is TWO independent facts, because they fail apart:
 *   - host env: `GH_TOKEN` / `GITHUB_TOKEN` present (the web service ships one)
 *   - CLI session: `gh auth status` succeeds
 * A service started with `GH_TOKEN` is authenticated for every `gh pr/issue`
 * call even when no `gh auth login` session file exists. Reading only the
 * session file reported "not-logged-in" and skipped the forge queries, so a
 * token-carrying deployment showed no PRs at all.
 * @param {object} [env] environment to read (process.env by default)
 */
export async function ghStatus(env = process.env) {
  const version = await runCommand('gh', ['--version'], { allowFailure: true, timeoutMs: 5000 })
  if (typeof version !== 'string' || version.length === 0) {
    return { available: false, loggedIn: false, reason: 'not-installed', source: null }
  }
  const token =
    (typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0 ? 'GH_TOKEN' : null) ??
    (typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.length > 0 ? 'GITHUB_TOKEN' : null)
  const auth = await runCommand('gh', ['auth', 'status'], { allowFailure: true, timeoutMs: 8000 })
  if (typeof auth === 'string' && auth.length > 0) {
    return { available: true, loggedIn: true, reason: null, source: 'cli' }
  }
  if (token !== null) {
    return { available: true, loggedIn: true, reason: null, source: token.toLowerCase() }
  }
  return { available: true, loggedIn: false, reason: 'not-logged-in', source: null }
}

/**
 * Why the forge queries cannot produce data, so the panel can name the gate
 * that failed instead of a generic "gh failed".
 * @param {object} opts
 * @param {Array<{name:string,url:string}>} opts.remotes configured remotes
 * @param {object} opts.gh the `ghStatus()` answer
 * @returns {string|null} hint key, or null when the queries should run
 */
export function forgeHintFor({ remotes, gh }) {
  if (!gh?.available) return 'not-installed'
  if (!gh?.loggedIn) return 'not-logged-in'
  if (!Array.isArray(remotes) || remotes.length === 0) return 'no-remote'
  // Same resolver the slug comes from: a hint of null now guarantees a usable
  // slug, which is what lets `--repo` be relied on rather than hoped for.
  if (forgeRemoteOf(remotes) === null) return 'not-github'
  return null
}

/**
 * `--repo <owner/repo>` for every gh query, or nothing when the slug is unknown.
 *
 * gh resolves the target repository by reading the workspace's git remotes, and
 * it only recognises a remote whose URL points at a known GitHub host. On a
 * machine whose git config rewrites github.com through a mirror
 * (`url.<mirror>.insteadOf https://github.com/`), `git remote -v` reports the
 * mirror URL, gh refuses to run at all ("none of the git remotes configured for
 * this repository point to a known GitHub host"), and every query came back
 * empty — the panel then drew the board from leftover local branches alone,
 * showing months-old merged issues as still in development (issue #199).
 *
 * The slug is parsed from `git config --local`, which that rewriting does not
 * touch, so naming it explicitly makes the queries independent of it.
 * @param {string|null} slug owner/repo, or null when it could not be parsed
 * @returns {string[]} extra argv entries, empty when the slug is unknown
 */
export function repoArgs(slug) {
  if (typeof slug !== 'string') return []
  // Exactly `owner/repo`. A wrong --repo is worse than none: gh would query a
  // repository that does not exist and fail, whereas no flag at least lets gh
  // try its own resolution. Guards the port-parsing class of bug at the last
  // point before argv.
  if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) return []
  return ['--repo', slug]
}

/**
 * How many merged PRs a snapshot looks at.
 *
 * This was 20, which silently mislabelled older branches: with 86 merged PRs in
 * the repository, `issue-145-…`'s merge (PR #193) fell outside the window, the
 * branch had no merge evidence, and the board drew a finished task as still in
 * development while flagging its own `.flow` file as stale (issue #199).
 *
 * `gh pr list` orders by CREATED-at, not merged-at (verified against this
 * repository's 86 merged PRs), so the window can still miss a long-open PR that
 * merged yesterday. Raising the number narrows that window but does not close
 * it: a repository with more than this many merged PRs re-creates the defect.
 * The durable fix is a bounded per-branch lookup for branches still lacking
 * merge evidence, which scales with the local branch list instead of history.
 */
export const MERGED_PR_LIMIT = 200

/** Open PRs for the current repo. */
export async function openPullRequests(repoDir, slug) {
  const out = await runCommand(
    'gh',
    ['pr', 'list', '--state', 'open', '--limit', '30',
     '--json', 'number,title,author,headRefName,baseRefName,isDraft,url,mergeable',
     ...repoArgs(slug)],
    { cwd: repoDir, allowFailure: true, timeoutMs: 15_000 },
  )
  if (typeof out !== 'string') return null // gh failed → panel shows the reason
  try {
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return null
  }
}

/** Recently merged PRs, to flag local branches whose PR already landed. */
export async function recentlyMergedPullRequests(repoDir, slug) {
  const out = await runCommand(
    'gh',
    ['pr', 'list', '--state', 'merged', '--limit', String(MERGED_PR_LIMIT),
     '--json', 'number,title,headRefName,mergedAt,url',
     ...repoArgs(slug)],
    { cwd: repoDir, allowFailure: true, timeoutMs: 15_000 },
  )
  if (typeof out !== 'string') return null
  try {
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return null
  }
}

/** Open issues for the current repo. */
export async function openIssues(repoDir, slug) {
  const out = await runCommand(
    'gh',
    ['issue', 'list', '--state', 'open', '--limit', '30',
     '--json', 'number,title,author,labels,url',
     ...repoArgs(slug)],
    { cwd: repoDir, allowFailure: true, timeoutMs: 15_000 },
  )
  if (typeof out !== 'string') return null
  try {
    const parsed = JSON.parse(out)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return null
  }
}

/** Check states that mean the run failed for good. */
const FAILED_CHECK_STATES = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED'])
/** Check states that mean the run finished clean. */
const PASSED_CHECK_STATES = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

/**
 * Collapse `gh pr checks --json state` into the CI three-state contract.
 *
 * The panel must never show "no CI" as "CI green": an empty list means the
 * repository has no workflow for this PR (`none`), while a run still in flight
 * means we do not know yet (`unknown`). A failure outranks everything — a red
 * check is actionable even while another job is still running.
 * @param {Array<{state?:string}>} checks
 * @returns {'green'|'red'|'none'|'unknown'}
 */
export function classifyChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'none'
  let sawPending = false
  for (const check of checks) {
    const state = typeof check?.state === 'string' ? check.state.toUpperCase() : ''
    if (FAILED_CHECK_STATES.has(state)) return 'red'
    if (!PASSED_CHECK_STATES.has(state)) sawPending = true
  }
  return sawPending ? 'unknown' : 'green'
}

/**
 * CI state of one PR, for the task board's CI column.
 *
 * One `gh` call per PR, so callers run these behind a small concurrency pool.
 * Exit code 1 with a body is normal: `gh pr checks` exits non-zero while checks
 * are failing or pending, so the BODY decides, not the exit status. That is
 * only true because the call opts into `keepStdoutOnFailure`.
 * @returns {Promise<'green'|'red'|'none'|'unknown'>}
 */
export async function prChecks(repoDir, prNumber, slug) {
  if (!Number.isInteger(prNumber) || prNumber <= 0) return 'unknown'
  if (typeof repoDir !== 'string' || repoDir.length === 0) return 'unknown'
  // `keepStdoutOnFailure` is REQUIRED here: `gh pr checks` exits 1 when it has
  // no checks to report and 8 while checks are pending, and both cases still
  // print to stdout. Dropping that output turned "no CI" into "unknown", so the
  // panel never asked the user whether to create a workflow.
  const out = await runCommand(
    'gh',
    ['pr', 'checks', String(prNumber), '--json', 'state', ...repoArgs(slug)],
    { cwd: repoDir, allowFailure: true, keepStdoutOnFailure: true, timeoutMs: 15_000 },
  )
  if (typeof out !== 'string') return 'unknown'
  const text = out.trim()
  // Whitespace-only output means the command failed without saying anything
  // useful; that is "we do not know", never "this repo has no CI".
  if (text.length === 0) return 'unknown'
  // `gh pr checks` prints "no checks reported on <branch>" and exits 1 when the
  // PR has no runs at all — that is `none`, not an unknown failure.
  if (/no checks reported/i.test(text)) return 'none'
  try {
    return classifyChecks(JSON.parse(text))
  } catch {
    return 'unknown'
  }
}
