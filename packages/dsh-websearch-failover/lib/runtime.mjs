// Runtime state for the websearch-failover bundle: the user-editable provider
// order, enable/disable overrides, the last probed balance per provider, and
// local call statistics. Everything here is advisory: a missing or corrupt file
// means "no overrides", never a failed search.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const RUNTIME_VERSION = 1

function envValue(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Resolution order:
 *   1. `$WEBSEARCH_FAILOVER_RUNTIME`
 *   2. `$DSH_HOME/websearch-failover/runtime.json`
 *   3. `~/.dsh/websearch-failover/runtime.json`
 */
export function defaultRuntimePath() {
  const explicit = envValue('WEBSEARCH_FAILOVER_RUNTIME')
  if (explicit) return explicit
  const home = envValue('DSH_HOME') || path.join(os.homedir(), '.dsh')
  return path.join(home, 'websearch-failover', 'runtime.json')
}

export function emptyRuntime() {
  return { version: RUNTIME_VERSION, order: [], disabled: {}, balances: {}, stats: {}, updatedAt: 0 }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id.length === 0 || out.includes(id)) continue
    out.push(id)
  }
  return out
}

function normalizeDisabled(value) {
  if (!isPlainObject(value)) return {}
  const out = {}
  for (const [id, flag] of Object.entries(value)) {
    if (typeof id === 'string' && id.trim().length > 0 && flag === true) out[id] = true
  }
  return out
}

function normalizeBalances(value) {
  if (!isPlainObject(value)) return {}
  const out = {}
  for (const [id, balance] of Object.entries(value)) {
    if (typeof id !== 'string' || !isPlainObject(balance)) continue
    out[id] = balance
  }
  return out
}

function normalizeStats(value) {
  if (!isPlainObject(value)) return {}
  const out = {}
  for (const [id, entry] of Object.entries(value)) {
    if (typeof id !== 'string' || !isPlainObject(entry)) continue
    out[id] = entry
  }
  return out
}

/** Normalize an arbitrary object into a valid runtime record. */
export function normalizeRuntime(value) {
  if (!isPlainObject(value)) return emptyRuntime()
  return {
    version: RUNTIME_VERSION,
    order: normalizeIdList(value.order),
    disabled: normalizeDisabled(value.disabled),
    balances: normalizeBalances(value.balances),
    stats: normalizeStats(value.stats),
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
  }
}

/** Read the runtime file, treating a missing or corrupt file as empty state. */
export function readRuntime(runtimePath = defaultRuntimePath()) {
  try {
    return normalizeRuntime(JSON.parse(fs.readFileSync(runtimePath, 'utf8')))
  } catch {
    return emptyRuntime()
  }
}

/** Persist the runtime file atomically (temp file + rename). */
export function writeRuntime(state, runtimePath = defaultRuntimePath()) {
  const record = { ...normalizeRuntime(state), updatedAt: Date.now() }
  try {
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true })
    const temp = `${runtimePath}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(record, null, 2), 'utf8')
    fs.renameSync(temp, runtimePath)
    return true
  } catch {
    return false
  }
}

/**
 * Apply the user's order and enable/disable overrides to a provider list.
 * Array position is priority: the first provider is tried first. Disabled
 * providers are removed; unknown ids in `order` are ignored.
 * @param {Array<{id: string}>} providers
 * @param {object} runtime
 */
export function applyRuntime(providers, runtime) {
  const list = Array.isArray(providers) ? providers.filter((p) => p && typeof p.id === 'string') : []
  const state = normalizeRuntime(runtime)
  const kept = list.filter((p) => state.disabled[p.id] !== true)

  const rank = new Map()
  state.order.forEach((id, index) => rank.set(id, index))

  return kept
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) => {
      const left = rank.has(a.provider.id) ? rank.get(a.provider.id) : Number.POSITIVE_INFINITY
      const right = rank.has(b.provider.id) ? rank.get(b.provider.id) : Number.POSITIVE_INFINITY
      if (left !== right) return left - right
      return a.index - b.index
    })
    .map((entry) => entry.provider)
}

/** Replace the priority order. Invalid payloads leave the existing order alone. */
export function reorder(runtime, ids) {
  const state = normalizeRuntime(runtime)
  if (!Array.isArray(ids)) return state
  return { ...state, order: normalizeIdList(ids), updatedAt: Date.now() }
}

/** Turn one provider on or off. A missing/blank id is ignored. */
export function setEnabled(runtime, id, enabled) {
  const state = normalizeRuntime(runtime)
  if (typeof id !== 'string' || id.trim().length === 0) return state
  const target = id.trim()
  const disabled = { ...state.disabled }
  if (enabled === false) disabled[target] = true
  else delete disabled[target]
  return { ...state, disabled, updatedAt: Date.now() }
}

/** Record one attempt against a provider's local statistics. */
export function recordResult(runtime, id, outcome, { at = Date.now(), message } = {}) {
  const state = normalizeRuntime(runtime)
  if (typeof id !== 'string' || id.trim().length === 0) return state
  const target = id.trim()
  const previous = isPlainObject(state.stats[target]) ? state.stats[target] : {}
  const calls = Number.isFinite(previous.calls) ? previous.calls : 0
  const successes = Number.isFinite(previous.successes) ? previous.successes : 0
  const failures = Number.isFinite(previous.failures) ? previous.failures : 0
  const success = outcome === 'ok'
  const detail = typeof message === 'string' && message.length > 0 ? message.slice(0, 300) : null

  return {
    ...state,
    stats: {
      ...state.stats,
      [target]: {
        calls: calls + 1,
        successes: successes + (success ? 1 : 0),
        failures: failures + (success ? 0 : 1),
        lastUsedAt: new Date(Number.isFinite(at) ? at : Date.now()).toISOString(),
        lastOutcome: String(outcome ?? 'unknown'),
        lastError: success ? (previous.lastError ?? null) : detail,
      },
    },
    updatedAt: Date.now(),
  }
}

/** Store the last probed balance for one provider. */
export function setBalance(runtime, id, balance) {
  const state = normalizeRuntime(runtime)
  if (typeof id !== 'string' || id.trim().length === 0 || !isPlainObject(balance)) return state
  return {
    ...state,
    balances: { ...state.balances, [id.trim()]: balance },
    updatedAt: Date.now(),
  }
}

/**
 * A promise-chain mutex: every queued run starts only after the previous one
 * settles, and a failing run never poisons the queue (#103 T1.web). The
 * refresh route uses this so two concurrent POST /api/refresh calls cannot
 * interleave their read-modify-write of runtime.json (last-writer used to
 * drop the other's balance readings).
 */
export function createMutex() {
  let tail = Promise.resolve()
  return {
    run(fn) {
      const run = tail.then(fn)
      tail = run.then(() => {}, () => {})
      return run
    },
  }
}
