/**
 * Stage 4 of the update tool: the atomic SWAP.
 *
 * Why RENAME_EXCHANGE and not "rename live away, rename staged in": the latter
 * is two syscalls with a window in which the live path does not exist at all,
 * and a recompose (or any lazy import) landing in that window sees a missing
 * package. RENAME_EXCHANGE is one syscall: every reader observes either the
 * complete old tree or the complete new one, and the old tree is left at the
 * staging path — which is exactly the rollback copy, at no extra cost.
 *
 * Constraints checked here, because violating one means the swap is not atomic:
 *   - both paths exist and are directories;
 *   - neither is inside the other;
 *   - both are on the same filesystem (st_dev equal) — rename(2) cannot cross
 *     filesystems, so staging under /tmp would silently become copy+delete.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, realpathSync, renameSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXCHANGE = join(HERE, 'exchange.py')

/** Reasons a swap must not be attempted. Empty array means "safe to try". */
export function preflight(liveDir, stagedDir) {
  const problems = []
  for (const [label, dir] of [['liveDir', liveDir], ['stagedDir', stagedDir]]) {
    if (!existsSync(dir)) problems.push(`${label} does not exist: ${dir}`)
    else if (!lstatSync(dir).isDirectory()) problems.push(`${label} is not a directory: ${dir}`)
  }
  if (problems.length > 0) return problems

  const live = realpathSync(liveDir)
  const staged = realpathSync(stagedDir)
  if (live === staged) problems.push('liveDir and stagedDir are the same directory')
  if (staged.startsWith(`${live}/`)) problems.push('stagedDir is inside liveDir; exchanging would tear liveDir')
  if (live.startsWith(`${staged}/`)) problems.push('liveDir is inside stagedDir')
  if (statSync(live).dev !== statSync(staged).dev) {
    problems.push('the two directories are not on the same filesystem; rename(2) cannot exchange them atomically')
  }
  return problems
}

/**
 * Swap the two trees. Returns `{ mode }` — 'exchange' (atomic) — or
 * `{ error }`. There is deliberately no non-atomic fallback: a caller that
 * wants one must ask for it explicitly and accept a visible window.
 */
export function swapTrees(liveDir, stagedDir, { allowNonatomic = false } = {}) {
  const problems = preflight(liveDir, stagedDir)
  if (problems.length > 0) return { error: problems.join('; ') }

  try {
    execFileSync('python3', [EXCHANGE, liveDir, stagedDir], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
    return { mode: 'exchange' }
  } catch (error) {
    const reason = String(error?.stderr ?? error?.message ?? error).trim()
    if (!allowNonatomic) {
      return { error: `RENAME_EXCHANGE unavailable (${reason}); refusing the non-atomic fallback` }
    }
    const parked = `${liveDir}.swap-old-${process.pid}`
    try {
      renameSync(liveDir, parked)
      renameSync(stagedDir, liveDir)
      renameSync(parked, stagedDir)
      return { mode: 'nonatomic' }
    } catch (fallbackError) {
      return { error: `non-atomic fallback failed: ${String(fallbackError?.message ?? fallbackError)}` }
    }
  }
}

/** Reverse an earlier exchange — the rollback, when the stage still holds the old generation. */
export function rollbackSwap(liveDir, stagedDir) {
  return swapTrees(liveDir, stagedDir)
}

/**
 * After an exchange, git's index stat metadata still describes the old inodes
 * for the live path, so `git status` reports the whole package as modified.
 * Refresh it (never rewrites file contents).
 */
export function refreshIndex(checkout) {
  try {
    execFileSync('git', ['-C', checkout, 'update-index', '--refresh', '-q'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
    return { ok: true }
  } catch (error) {
    // `update-index --refresh` exits 1 when files are still different; that is
    // a report, not a failure of the refresh itself.
    return { ok: true, detail: String(error?.stderr ?? error?.message ?? error).trim() }
  }
}

export const resolvePath = (p) => resolve(p)
