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
 * @returns {string|null}
 */
export function slugFromRemoteUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null
  const scp = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url)
  if (scp) return `${scp[1]}/${scp[2]}`
  const ssh = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url)
  if (ssh) return `${ssh[1]}/${ssh[2]}`
  const https = /^(?:https?:\/\/)?(?:[^/@\s]+@)?(?:www\.)?github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url)
  if (https) return `${https[1]}/${https[2]}`
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
  const slug = remotes.map((r) => slugFromRemoteUrl(r.url)).find((s) => s !== null)
  if (slug === undefined) return 'not-github'
  return null
}

/** Open PRs for the current repo. */
export async function openPullRequests(repoDir) {
  const out = await runCommand(
    'gh',
    ['pr', 'list', '--state', 'open', '--limit', '30',
     '--json', 'number,title,author,headRefName,baseRefName,isDraft,url,mergeable'],
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
export async function recentlyMergedPullRequests(repoDir) {
  const out = await runCommand(
    'gh',
    ['pr', 'list', '--state', 'merged', '--limit', '20',
     '--json', 'number,title,headRefName,mergedAt,url'],
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
export async function openIssues(repoDir) {
  const out = await runCommand(
    'gh',
    ['issue', 'list', '--state', 'open', '--limit', '30',
     '--json', 'number,title,author,labels,url'],
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
