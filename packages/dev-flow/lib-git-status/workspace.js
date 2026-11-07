/**
 * Locate the git workspace the panel should describe.
 *
 * The panel follows the Session the user is looking at, exactly like the rest
 * of DSH does: the browser half sends that Session's id, and its immutable
 * header `cwd` is the workspace. Nothing else can tell "the current repo"
 * apart — the web host process itself runs wherever the launcher started it
 * (often the fallback directory), which is not the user's workspace.
 *
 * Resolution order:
 *   1. the explicit `cwd` handed in by the caller (Session header cwd)
 *   2. the Session header cwd for `sessionId`, through the live Session
 *      registry, then session persistence
 *   3. `$DSH_WORKSPACE` / `$DSH_CWD` / the process cwd (tests, bare installs)
 *
 * A requested directory that is not inside a git worktree is reported as
 * `plain` without falling through to another repo: the panel always describes
 * the workspace the user asked for, never a neighbour's.
 *
 * All probing is read-only: `git -C <dir> rev-parse --show-toplevel`.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runCommand } from './run.js'

/** A directory counts as a git worktree when `.git` exists (file or dir). */
export function hasGitDir(dir) {
  return existsSync(join(dir, '.git'))
}

/** Nearest directory in the chain that contains `.git`, or null. */
export function nearestGitRoot(startDir) {
  if (typeof startDir !== 'string' || startDir.length === 0) return null
  let current = startDir
  for (let guard = 0; guard < 64; guard += 1) {
    if (hasGitDir(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/**
 * `git rev-parse --show-toplevel` for a directory; null when not a repo.
 */
export async function gitTopLevel(dir) {
  const out = await runCommand('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { allowFailure: true })
  const top = typeof out === 'string' ? out.trim().split('\n')[0] : null
  return top || null
}

/**
 * Read the workspace cwd of one Session without activating its Agent: the live
 * Session header first (cheap, no event log), then the durable header through
 * session persistence. Null whenever the peer is missing, the session is
 * unknown, or its header carries no cwd.
 * @param {object} deps
 * @param {object} [deps.sessions] the `sessions` service
 * @param {object} [deps.sessionPersistence] the `sessionPersistence` service
 * @param {string} sessionId
 * @returns {Promise<string|null>} absolute cwd, or null
 */
export async function sessionCwdOf({ sessions, sessionPersistence } = {}, sessionId) {
  const id = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
  if (id === null) return null
  try {
    const live = sessions?.get?.(id)
    const cwd = live?.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  } catch {
    /* fall through to persistence */
  }
  try {
    const stored = await sessionPersistence?.stat?.(id)
    const cwd = stored?.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  } catch {
    /* unknown session */
  }
  return null
}

/**
 * Candidate workspace directories, most specific first, de-duplicated.
 * The Session cwd comes first; the rest only fill in when it is missing.
 * @param {object} [opts]
 * @param {string} [opts.cwd] Session workspace, already resolved by the caller
 * @param {string} [opts.env] passthrough of process.env for testing
 */
export function workspaceCandidates(opts = {}) {
  const env = opts.env ?? process.env
  const out = []
  const push = (dir) => {
    if (typeof dir === 'string' && dir.length > 0 && !out.includes(dir)) out.push(dir)
  }
  push(opts.cwd)
  push(env.DSH_WORKSPACE)
  push(env.DSH_CWD)
  push(process.cwd())
  return out
}

/**
 * Pick the workspace the snapshot should describe.
 * The FIRST candidate decides: when it exists it decides the answer — git root
 * via the nearest-`.git`-ancestor probe, then a `git rev-parse` fallback that
 * also honors GIT_DIR worktrees — and a non-git first candidate is reported as
 * `plain` without falling through to other candidates, so another repo's facts
 * never leak in. Later candidates only fill in when earlier ones are missing.
 * Returns { dir: string|null, reason: 'git'|'plain'|'none' }.
 * @param {object} [opts]
 * @param {string} [opts.cwd] Session workspace cwd, the authoritative choice
 * @param {string} [opts.env] passthrough env for tests
 */
export async function pickWorkspace(opts = {}) {
  const candidates = workspaceCandidates(opts)
  for (let i = 0; i < candidates.length; i += 1) {
    const dir = candidates[i]
    if (!hasGitDir(dir)) {
      const viaFs = nearestGitRoot(dir)
      const top = viaFs ?? (await gitTopLevel(dir))
      if (top) return { dir: top, reason: 'git' }
      // The designated workspace decides; don't leak another repo's info.
      if (i === 0) return { dir, reason: 'plain' }
      continue
    }
    return { dir, reason: 'git' }
  }
  return { dir: null, reason: 'none' }
}
