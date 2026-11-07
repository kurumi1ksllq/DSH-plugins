/**
 * Path safety shared by every host-side read of the git-status panel.
 *
 * A request path is attacker-controlled (a subresource fetch is same-origin),
 * so lexical checks alone are not enough: the file the route ends up reading
 * must be a real file that physically lives inside the git worktree. Symlinks
 * are rejected on both halves of the path (the path itself and any directory
 * it walks through), because a symlinked directory is how a lexical check is
 * escaped without any `..` in the string.
 */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Is `target` the directory `root` itself, or somewhere below it?
 * Both arguments must already be absolute, resolved paths.
 */
export function isInsideRoot(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Lexical gate: rejects absolute paths, NUL bytes and `..` segments. */
export function isPlausibleRepoPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  if (path.startsWith('/') || path.includes('\0') || path.includes('\r')) return false
  return !path.split(/[/\\]/).includes('..')
}

/**
 * Resolve one repo-relative path to the absolute path a route may read.
 *
 * @param {string} repoDir git worktree root (as reported by `git rev-parse`)
 * @param {string} path repo-relative, forward-slash separated
 * @param {object} [opts]
 * @param {boolean} [opts.allowSymlink] false (default): the final component
 *   must not be a symlink; directories along the path are always resolved and
 *   checked against the root.
 * @param {boolean} [opts.allowMissing] true for a path `git status` reports as
 *   deleted: the file is gone, but its diff is still a diff of this repo. The
 *   containment and symlink checks still run on the location itself.
 * @returns {Promise<string|null>} absolute real path inside the root, or null
 *   when the path is malformed, missing, outside the worktree, or a symlink.
 */
export async function resolveInsideRepo(repoDir, path, opts = {}) {
  if (!isPlausibleRepoPath(path)) return null
  let root
  try {
    root = await realpath(repoDir)
  } catch {
    return null
  }
  const candidate = resolve(root, path)
  if (!isInsideRoot(root, candidate)) return null
  if (opts.allowMissing === true) {
    // The nearest EXISTING ancestor decides where this location really points
    // (a symlinked directory still escapes the root), then the leaf is added
    // back. Nothing is read from a missing file — only `git diff` is.
    const dir = await realpathInside(root, dirnameOf(candidate))
    return dir === null ? null : join(dir, basenameOf(candidate))
  }
  let real
  try {
    // realpath resolves every symlinked component, so `escape/secret.txt`
    // lands outside the root and is refused below.
    real = await realpath(candidate)
  } catch {
    return null // nonexistent path, dangling link
  }
  if (!isInsideRoot(root, real)) return null
  try {
    const own = await stat(candidate)
    if (opts.allowSymlink !== true) {
      const info = await lstatSafe(candidate)
      if (info === null || info.isSymbolicLink()) return null
    }
    if (!own.isFile()) return null
  } catch {
    return null
  }
  return real
}

/** Real path of the nearest existing ancestor of `dir`, when inside the root. */
async function realpathInside(root, dir) {
  let current = dir
  for (;;) {
    if (!isInsideRoot(root, current)) return null
    try {
      const real = await realpath(current)
      return isInsideRoot(root, real) ? real : null
    } catch {
      const parent = dirnameOf(current)
      if (parent === current) return null
      current = parent
    }
  }
}

function dirnameOf(path) {
  const at = path.lastIndexOf(sep)
  return at > 0 ? path.slice(0, at) : sep
}

function basenameOf(path) {
  return path.slice(path.lastIndexOf(sep) + 1)
}

async function lstatSafe(path) {
  try {
    const { lstat } = await import('node:fs/promises')
    return await lstat(path)
  } catch {
    return null
  }
}

/** `git rev-parse --show-toplevel` for `dir`, or null. */
export async function gitRootOf(dir, run) {
  const out = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { allowFailure: true })
  if (typeof out !== 'string') return null
  const root = out.trim()
  return root.length > 0 ? root : null
}

export { join }
