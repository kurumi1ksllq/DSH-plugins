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
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'

import { LEGACY_ID, normalizeMachineId } from './fleet.js'

import { dshHome } from './dsh-home.js'

export const STATE_FILE = 'plugin-sync.json'

export const STATE_DEFAULTS = {
  repo: '',
  ref: 'main',
  path: 'dsh-manifest.json',
  /**
   * Transport mode:
   *   'github' — GitHub raw/contents API + git clone (default, unchanged).
   *   'gitee'  — same manifest file on gitee.com, read over raw/gitee API.
   *   'http'   — self-hosted direct endpoint (e.g. this server's nginx),
   *              `GET {url}` reads and `PUT {url}` publishes a JSON body.
   *              No GitHub involved at all; auth is `Authorization: Bearer <token>`.
   */
  mode: 'github',
  /**
   * Plugin repository address (not the manifest repository). Published inside
   * the manifest as `repoUrl` so a fresh machine can bootstrap a local clone
   * for repo-source plugins. Optional; empty means the manifest omits it.
   */
  repoUrl: '',
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
  /** T4.inv: the last pull/publish failure, kept so the panel can show WHY a
   * fleet is stale even after the process that saw the failure restarted. */
  lastFetchError: '',
  /** Epoch ms of when lastFetchError was recorded. */
  lastFetchErrorAt: 0,
  /** Epoch ms of the last successful publish. */
  lastPushAt: 0,
  /**
   * This machine's section id in a fleet (multi-machine) manifest. Generated
   * once and persisted: hostname alone is not stable enough (clones share
   * one), and a random id regenerated per process would orphan sections.
   */
  machineId: '',
}

/** `$DSH_HOME` — the one shared resolver lives in `./dsh-home.js`. */
export { dshHome } from './dsh-home.js'

/** Absolute path of the state file under the resolved DSH home. */
export function statePath(env = process.env) {
  return join(dshHome(env), STATE_FILE)
}

/** Read the state, merged over defaults. Never throws. */
export function readState(env = process.env) {
  const path = statePath(env)
  if (path === null || !existsSync(path)) return withMachineId({ ...STATE_DEFAULTS }, env)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return withMachineId({ ...STATE_DEFAULTS }, env)
    return withMachineId(mergeState(raw), env)
  } catch {
    return withMachineId({ ...STATE_DEFAULTS }, env)
  }
}

/**
 * Give a state without an id one, and remember it.
 *
 * Every publisher needs a stable section id before it can join a fleet, so the
 * first read mints and persists one. A read-only filesystem leaves the id
 * ephemeral (falls back to the legacy section) rather than failing.
 */
function withMachineId(state, env = process.env) {
  if (typeof state.machineId === 'string' && state.machineId.length > 0 && state.machineId !== LEGACY_ID) return state
  const minted = generateMachineId(env)
  state.machineId = minted
  try {
    const path = statePath(env)
    if (path !== null) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    }
  } catch {
    // Keep the minted id for this process; persisting is best-effort.
  }
  return state
}

function mergeState(raw) {
  return {
    repo: typeof raw.repo === 'string' ? raw.repo : STATE_DEFAULTS.repo,
    ref: typeof raw.ref === 'string' && raw.ref.length > 0 ? raw.ref : STATE_DEFAULTS.ref,
    path: typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : STATE_DEFAULTS.path,
    mode: ['github', 'gitee', 'http'].includes(raw.mode) ? raw.mode : STATE_DEFAULTS.mode,
    token: typeof raw.token === 'string' ? raw.token : STATE_DEFAULTS.token,
    annotations: raw.annotations !== null && typeof raw.annotations === 'object' && !Array.isArray(raw.annotations)
      ? raw.annotations
      : {},
    lastPullAt: typeof raw.lastPullAt === 'number' ? raw.lastPullAt : 0,
    lastPushAt: typeof raw.lastPushAt === 'number' ? raw.lastPushAt : 0,
    lastFetchError: typeof raw.lastFetchError === 'string' ? raw.lastFetchError : '',
    lastFetchErrorAt: typeof raw.lastFetchErrorAt === 'number' ? raw.lastFetchErrorAt : 0,
    machineId: typeof raw.machineId === 'string' ? normalizeMachineId(raw.machineId) : STATE_DEFAULTS.machineId,
    repoUrl: typeof raw.repoUrl === 'string' ? raw.repoUrl : STATE_DEFAULTS.repoUrl,
  }
}

/**
 * A stable fleet section id, created on first use.
 *
 * `<hostname>-<4 hex>` — readable in the panel, unique enough for a handful of
 * machines, and stable because it is written back to the state file at birth.
 * Collisions are self-healing anyway: the next publish overwrites the section
 * with this machine's view.
 */
function generateMachineId(env = process.env) {
  const raw = String(env?.DSH_MACHINE_ID ?? hostname() ?? 'dsh').trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  const base = (raw.length > 0 ? raw : 'dsh').slice(0, 48)
  const suffix = Math.random().toString(16).slice(2, 6)
  return normalizeMachineId(`${base}-${suffix}`)
}

/**
 * Module-level serialization queue for `writeState`.
 *
 * The read→merge→write sequence is only safe under a lock; two concurrent
 * `writeState` calls could each read the same "current" state and one would
 * clobber the other's keys. Node is single-process here, so chaining promises
 * is enough — no file lock, no dependency.
 */
let writeQueue = Promise.resolve()

/**
 * Write a partial update. Returns the merged state.
 *
 * Only the keys present in `patch` change; a caller saving `repo` cannot
 * accidentally erase the token. Concurrent calls are serialized, so a burst of
 * partial updates merges instead of racing.
 */
export function writeState(patch, env = process.env) {
  const result = writeQueue.then(() => {
    const path = statePath(env)
    const current = readState(env)
    const next = mergeState({ ...current, ...patch })
    if (path === null) return next
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    return next
  })
  // Keep the queue alive even when a write rejects, but keep it last so the
  // caller's rejection is not swallowed by the queue's own handling.
  writeQueue = result.catch(() => {})
  return result
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
    mode: state.mode,
    machineId: state.machineId,
    hasToken: typeof state.token === 'string' && state.token.length > 0,
    annotations: state.annotations,
    lastPullAt: state.lastPullAt,
    lastPushAt: state.lastPushAt,
    lastFetchError: state.lastFetchError ?? '',
    lastFetchErrorAt: state.lastFetchErrorAt ?? 0,
  }
}
