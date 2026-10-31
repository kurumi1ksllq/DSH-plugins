/**
 * Runtime state for the sync half, kept outside any repository.
 *
 * What lives here is the one thing that must never be published: the token used
 * to write to the manifest repository. Everything else (repository address,
 * ref, last sync time) is convenience, not secret.
 *
 * Location: `$DSH_HOME/plugin-sync.json` — sibling to `profiles/`, not inside
 * one. A profile is published wholesale; a file inside it would be a leak
 * waiting to happen the first time someone zips a profile.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const STATE_FILE = 'plugin-sync.json'

export const STATE_DEFAULTS = {
  repo: '',
  ref: 'main',
  path: 'dsh-manifest.json',
  /** GitHub token, stored here and nowhere else. */
  token: '',
  /**
   * Per-item metadata the snapshot cannot know: which platform an item works
   * on, and which external commands it needs. Keyed by `kind:name` (or bare
   * name, which `manifest.js` also accepts).
   */
  annotations: {},
  /** Epoch ms of the last successful pull. */
  lastPullAt: 0,
  /** Epoch ms of the last successful publish. */
  lastPushAt: 0,
}

/** `$DSH_HOME`, honouring the env override the rest of dsh uses. */
export function dshHome(env = process.env) {
  const explicit = env.DSH_HOME
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const home = env.HOME ?? env.USERPROFILE
  if (typeof home !== 'string' || home.length === 0) return null
  return join(home, '.dsh')
}

/** Absolute path of the state file, or null when no home can be resolved. */
export function statePath(env = process.env) {
  const home = dshHome(env)
  return home === null ? null : join(home, STATE_FILE)
}

/** Read the state, merged over defaults. Never throws. */
export function readState(env = process.env) {
  const path = statePath(env)
  if (path === null || !existsSync(path)) return { ...STATE_DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...STATE_DEFAULTS }
    return mergeState(raw)
  } catch {
    return { ...STATE_DEFAULTS }
  }
}

function mergeState(raw) {
  return {
    repo: typeof raw.repo === 'string' ? raw.repo : STATE_DEFAULTS.repo,
    ref: typeof raw.ref === 'string' && raw.ref.length > 0 ? raw.ref : STATE_DEFAULTS.ref,
    path: typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : STATE_DEFAULTS.path,
    token: typeof raw.token === 'string' ? raw.token : STATE_DEFAULTS.token,
    annotations: raw.annotations !== null && typeof raw.annotations === 'object' && !Array.isArray(raw.annotations)
      ? raw.annotations
      : {},
    lastPullAt: typeof raw.lastPullAt === 'number' ? raw.lastPullAt : 0,
    lastPushAt: typeof raw.lastPushAt === 'number' ? raw.lastPushAt : 0,
  }
}

/**
 * Write a partial update. Returns the merged state.
 *
 * Only the keys present in `patch` change; a caller saving `repo` cannot
 * accidentally erase the token.
 */
export function writeState(patch, env = process.env) {
  const path = statePath(env)
  const current = readState(env)
  const next = mergeState({ ...current, ...patch })
  if (path === null) return next
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  return next
}

/**
 * The state with the token removed, for any response that leaves the host.
 *
 * The panel needs to know whether a token is configured; it must never be able
 * to read the token back out.
 */
export function publicState(state) {
  return {
    repo: state.repo,
    ref: state.ref,
    path: state.path,
    hasToken: typeof state.token === 'string' && state.token.length > 0,
    annotations: state.annotations,
    lastPullAt: state.lastPullAt,
    lastPushAt: state.lastPushAt,
  }
}
