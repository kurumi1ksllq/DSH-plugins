/**
 * dsh-websearch-failover — host half.
 *
 * Registers one `ctx.web` search provider that walks the user's ordered
 * provider list (top = priority) with quota-aware cooldown, and serves the
 * small HTTP API behind the sidebar panel that shows each provider's balance
 * regardless of billing unit (credits / USD / percent / requests / tokens).
 *
 * Config:  $WEBSEARCH_FAILOVER_CONFIG  or  $DSH_HOME/websearch-failover/providers.json
 * Runtime: $WEBSEARCH_FAILOVER_RUNTIME or  $DSH_HOME/websearch-failover/runtime.json
 * Log:     $DSH_HOME/websearch-failover/plugin.log
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  SearchError,
  defaultConfigPath,
  defaultStatePath,
  loadConfig,
  readState,
  resolveKey,
  search as coreSearch,
} from './lib/core.mjs'
import {applyRuntime,
  defaultRuntimePath,
  readRuntime,
  recordResult,
  reorder as reorderRuntime,
  setBalance,
  setEnabled as setEnabledRuntime,
  writeRuntime,
  createMutex, resetStats } from './lib/runtime.mjs'
import { probeBalance } from './lib/balance.mjs'
import { API_BASE, createApiHandler } from './lib/api.mjs'
import { truncate } from './lib/http.mjs'

/** Registered provider id; pin it with `- id: web / config: searchProvider: ...`. */
export const SEARCH_PROVIDER_ID = 'websearch-failover'

/** HTTP route prefix claimed by this plugin (see lib/api.mjs). */
export { API_BASE }

/** Cordis service dependencies. */
export const inject = ['web', 'webServer']

function envValue(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function defaultLogPath() {
  const home = envValue('DSH_HOME') || path.join(os.homedir(), '.dsh')
  return path.join(home, 'websearch-failover', 'plugin.log')
}

function prettyLabel(id) {
  return String(id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Append one line to the plugin log. Logging is best-effort: a read-only or
 * missing log location must never fail a search.
 */
function appendLog(logPath, line) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch {
    /* diagnostics only */
  }
}

function formatAttempts(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return '(none)'
  return attempts
    .map((attempt) => {
      const suffix = attempt.kind ? `(${attempt.kind})` : attempt.reason ? `(${attempt.reason})` : ''
      return `${attempt.provider}=${attempt.outcome}${suffix}`
    })
    .join(', ')
}

/** Zeroed statistics for a provider that was never used. */
function statsOf(runtime, id) {
  const entry = isPlainObject(runtime.stats[id]) ? runtime.stats[id] : {}
  return {
    calls: Number.isFinite(entry.calls) ? entry.calls : 0,
    successes: Number.isFinite(entry.successes) ? entry.successes : 0,
    failures: Number.isFinite(entry.failures) ? entry.failures : 0,
    lastUsedAt: typeof entry.lastUsedAt === 'string' ? entry.lastUsedAt : null,
    lastOutcome: typeof entry.lastOutcome === 'string' ? entry.lastOutcome : null,
    lastError: typeof entry.lastError === 'string' ? entry.lastError : null,
  }
}

/**
 * Cordis plugin entry.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{configPath?: string, runtimePath?: string, statePath?: string, logPath?: string, providerId?: string}} [config]
 */
export function apply(ctx, config = {}) {
  const options = isPlainObject(config) ? config : {}
  const configPath =
    typeof options.configPath === 'string' && options.configPath.length > 0 ? options.configPath : defaultConfigPath()
  const runtimePath =
    typeof options.runtimePath === 'string' && options.runtimePath.length > 0 ? options.runtimePath : defaultRuntimePath()
  const statePath =
    typeof options.statePath === 'string' && options.statePath.length > 0 ? options.statePath : defaultStatePath()
  const logPath = typeof options.logPath === 'string' && options.logPath.length > 0 ? options.logPath : defaultLogPath()
  const providerId =
    typeof options.providerId === 'string' && options.providerId.length > 0 ? options.providerId : SEARCH_PROVIDER_ID

  // Config is hot: an edited providers.json takes effect on the next search.
  let cache = { mtimeMs: -1, size: -1, config: null }

  function loadConfigCached() {
    let stat
    try {
      stat = fs.statSync(configPath)
    } catch {
      // Missing file: let loadConfig produce its actionable CONFIG_MISSING error.
      cache = { mtimeMs: -1, size: -1, config: null }
      return loadConfig(configPath)
    }
    if (cache.config && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.config
    const loaded = loadConfig(configPath)
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, config: loaded }
    return loaded
  }

  /** Raw provider rows, including `enabled: false` ones the engine skips. */
  function readRawProviders() {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (!Array.isArray(raw.providers)) return []
      return raw.providers.filter((row) => row && typeof row.id === 'string' && row.id.length > 0 && row.kind)
    } catch {
      return []
    }
  }

  function keyOf(provider) {
    try {
      return resolveKey(provider)
    } catch {
      return ''
    }
  }

  function keyPresent(provider) {
    try {
      resolveKey(provider)
      return true
    } catch {
      return false
    }
  }

  /** Full panel snapshot: ordered providers, balances, cooldowns, local stats. */
  function snapshot() {
    const runtime = readRuntime(runtimePath)
    const cooldowns = readState(statePath).providers ?? {}
    const raw = readRawProviders()
    const ordered = applyRuntime(raw, { ...runtime, disabled: {} })
    const now = Date.now()

    return {
      ok: true,
      generatedAt: now,
      order: ordered.map((provider) => provider.id),
      providers: ordered.map((provider, index) => {
        const cooldown = cooldowns[provider.id]
        const active = cooldown !== undefined && typeof cooldown.until === 'number' && cooldown.until > now
        return {
          id: provider.id,
          kind: provider.kind,
          label:
            typeof provider.label === 'string' && provider.label.length > 0 ? provider.label : prettyLabel(provider.id),
          enabled: runtime.disabled[provider.id] !== true && provider.enabled !== false,
          rank: index + 1,
          keyPresent: keyPresent(provider),
          balance: isPlainObject(runtime.balances[provider.id]) ? runtime.balances[provider.id] : null,
          cooldown: active
            ? {
                active: true,
                until: cooldown.until,
                reason: typeof cooldown.reason === 'string' ? cooldown.reason : 'cooldown',
                message: truncate(cooldown.message ?? '', 300),
              }
            : { active: false, until: 0, reason: '', message: '' },
          stats: statsOf(runtime, provider.id),
        }
      }),
    }
  }

  /** Persist a new priority order and return the fresh snapshot. */
  function reorder(ids) {
    writeRuntime(reorderRuntime(readRuntime(runtimePath), ids), runtimePath)
    appendLog(logPath, `order -> ${Array.isArray(ids) ? ids.join(' > ') : '(invalid payload ignored)'}`)
    return snapshot()
  }

  /** Enable or disable one provider (persisted as a runtime override). */
  function setEnabled(id, enabled) {
    writeRuntime(setEnabledRuntime(readRuntime(runtimePath), id, enabled), runtimePath)
    appendLog(logPath, `provider ${id} -> ${enabled ? 'enabled' : 'disabled'}`)
    return snapshot()
  }

  /** Probe balances for every provider (or the given ids) in parallel.
   * Serialized through a mutex: two concurrent POSTs used to interleave at the
   * probe await and their read-modify-write of runtime.json would drop the
   * other's balance readings (#103 T1.web). */
  const refreshMutex = createMutex()
  function refresh(ids) {
    return refreshMutex.run(() => doRefresh(ids))
  }

  async function doRefresh(ids) {
    const targets = readRawProviders()
    const only = Array.isArray(ids) && ids.length > 0 ? new Set(ids.filter((id) => typeof id === 'string')) : null
    const selected = only ? targets.filter((provider) => only.has(provider.id)) : targets

    const readings = await Promise.all(
      selected.map(async (provider) => {
        const balance = await probeBalance(provider, { key: keyOf(provider), now: Date.now() })
        return { id: provider.id, balance }
      }),
    )

    let runtime = readRuntime(runtimePath)
    for (const reading of readings) runtime = setBalance(runtime, reading.id, reading.balance)
    writeRuntime(runtime, runtimePath)
    if (readings.length > 0) {
      appendLog(logPath, `balances: ${readings.map((reading) => `${reading.id}=${reading.balance.status}`).join(', ')}`)
    }
    return snapshot()
  }

  const searchProvider = {
    id: providerId,

    /** Cheap, synchronous local check: config present, provider enabled, one key resolvable. */
    available() {
      try {
        const loaded = loadConfigCached()
        const providers = applyRuntime(loaded.providers, readRuntime(runtimePath))
        if (providers.length === 0) return false
        return providers.some((provider) => keyPresent(provider))
      } catch {
        return false
      }
    },

    /**
     * Walk the ordered provider list and return the first non-empty result.
     * @param {{query: string, maxResults?: number}} request
     * @param {AbortSignal} [signal]
     */
    async search(request, signal) {
      const loaded = loadConfigCached()
      let runtime = readRuntime(runtimePath)
      const providers = applyRuntime(loaded.providers, runtime)
      if (providers.length === 0) {
        throw new SearchError('every provider is disabled in the Web Search Providers panel', 'NO_PROVIDER')
      }

      const query = typeof request?.query === 'string' ? request.query.trim() : ''
      if (query.length === 0) throw new SearchError('empty search query', 'BAD_QUERY')

      const requested = Number(request?.maxResults)
      const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : loaded.defaults.limit

      try {
        const result = await coreSearch({
          query,
          limit,
          config: { providers, defaults: loaded.defaults },
          statePath,
          signal,
        })

        for (const attempt of result.attempts) {
          if (attempt.outcome === 'ok') runtime = recordResult(runtime, attempt.provider, 'ok', { at: Date.now() })
          else if (attempt.outcome === 'failed') {
            runtime = recordResult(runtime, attempt.provider, 'failed', { at: Date.now(), message: attempt.message })
          } else if (attempt.outcome === 'empty') {
            runtime = recordResult(runtime, attempt.provider, 'empty', { at: Date.now(), message: 'empty result' })
          }
        }
        writeRuntime(runtime, runtimePath)
        appendLog(
          logPath,
          `search "${truncate(query, 80)}" -> ${result.provider} (${result.sources.length} sources) attempts: ${formatAttempts(result.attempts)}`,
        )

        return {
          sources: result.sources.map((source) => ({
            url: source.url,
            ...(source.title ? { title: source.title } : {}),
            ...(source.snippet ? { snippet: source.snippet } : {}),
            ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          })),
          truncated: false,
        }
      } catch (error) {
        for (const attempt of error?.attempts ?? []) {
          if (attempt.outcome === 'failed') {
            runtime = recordResult(runtime, attempt.provider, 'failed', {
              at: Date.now(),
              message: attempt.message ?? attempt.code ?? 'failed',
            })
          } else if (attempt.outcome === 'empty') {
            runtime = recordResult(runtime, attempt.provider, 'empty', { at: Date.now(), message: 'empty result' })
          } else if (attempt.outcome === 'aborted') {
            // T4.web ABORTED 计数: user-intent cancellation is tracked on its
            // own counter, not as a provider failure.
            runtime = recordResult(runtime, attempt.provider, 'aborted', { at: Date.now(), message: 'aborted' })
          }
        }
        writeRuntime(runtime, runtimePath)
        appendLog(
          logPath,
          `search "${truncate(query, 80)}" FAILED: ${truncate(error?.message ?? String(error), 300)} attempts: ${formatAttempts(error?.attempts)}`,
        )
        throw error
      }
    },
  }

  // T4.web resetStats: read-modify-write the CURRENT runtime, like reorder/setEnabled do.
  const resetStatsFn = (id) => {
    const next = resetStats(readRuntime(runtimePath), id)
    writeRuntime(next, runtimePath)
    return next
  }
  const apiHandler = createApiHandler({ snapshot, reorder, refresh, setEnabled, resetStats: resetStatsFn })

  ctx.effect(() => ctx.web.registerSearchProvider(searchProvider))
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_BASE, handler: apiHandler }))

  appendLog(logPath, `registered search provider "${providerId}" (config: ${configPath})`)
}
