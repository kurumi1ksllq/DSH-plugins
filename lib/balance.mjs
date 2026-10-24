// Balance probing for the websearch-failover bundle.
//
// Providers bill in wildly different units (credits, dollars, requests,
// percent, tokens). Every probe is normalized to one record so the sidebar can
// draw a proportional bar no matter what the upstream reports.
export const BALANCE_UNITS = new Set(['credits', 'usd', 'percent', 'requests', 'tokens', 'unknown'])

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function clamp(value) {
  if (!Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value > 1) return 1
  return Math.round(value * 1e4) / 1e4
}

function getPath(object, dotted) {
  if (!dotted) return undefined
  let node = object
  for (const part of dotted.split('.')) {
    if (node == null) return undefined
    node = Array.isArray(node) && /^\d+$/.test(part) ? node[Number(part)] : node[part]
  }
  return node
}

/**
 * Normalize one balance reading.
 * @param {{remaining?: any, total?: any, used?: any, unit?: string, status?: string, source?: string, detail?: string, now?: number}} raw
 */
export function normalizeBalance(raw = {}) {
  const remaining = toNumber(raw.remaining)
  const total = toNumber(raw.total)
  const used = toNumber(raw.used)
  const unit = BALANCE_UNITS.has(raw.unit) ? raw.unit : raw.unit === undefined ? 'credits' : 'unknown'

  let ratio = null
  if (unit === 'percent' && remaining !== null && total === null) ratio = clamp(remaining / 100)
  else if (total !== null && total > 0) {
    if (remaining !== null) ratio = clamp(remaining / total)
    else if (used !== null) ratio = clamp(1 - used / total)
  }

  const status = raw.status === 'error' ? 'error' : remaining === null && used === null ? 'unknown' : 'ok'

  return {
    status,
    remaining,
    total,
    used,
    unit,
    ratio,
    source: typeof raw.source === 'string' && raw.source.length > 0 ? raw.source : 'api',
    detail: typeof raw.detail === 'string' ? raw.detail.slice(0, 300) : '',
    fetchedAt: Number.isFinite(raw.now) ? raw.now : Date.now(),
  }
}

function roundAmount(value) {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

/** Render a balance for the panel: "812.5 credits", "$4.20", "40%". */
export function formatBalance(balance) {
  const remaining = toNumber(balance?.remaining)
  if (remaining === null) return 'unknown'
  const unit = balance?.unit ?? 'unknown'
  if (unit === 'usd') return `$${remaining.toFixed(2)}`
  if (unit === 'percent') return `${roundAmount(remaining)}%`
  if (unit === 'credits') return `${roundAmount(remaining)} credits`
  if (unit === 'requests') return `${roundAmount(remaining)} requests`
  if (unit === 'tokens') return `${roundAmount(remaining)} tokens`
  return `${roundAmount(remaining)}`
}

// Built-in probes, keyed by provider kind. `request.url`/headers may contain
// `${key}`; response paths are dot-noted, may index arrays numerically, and may
// be a list of alternative paths (first one that resolves wins).
// Endpoints verified against the live APIs on 2026-10-24:
//   firecrawl v2 → { data: { remainingCredits, planCredits } } (v1 uses snake_case)
//   tavily       → { account: { plan_usage, plan_limit }, key: { usage, limit } }
const BUILTIN_SPECS = {
  firecrawl: {
    request: {
      method: 'GET',
      url: 'https://api.firecrawl.dev/v2/team/credit-usage',
      headers: { authorization: 'Bearer ${key}' },
    },
    response: {
      remainingPath: ['data.remainingCredits', 'data.remaining_credits'],
      totalPath: ['data.planCredits', 'data.plan_credits'],
    },
    unit: 'credits',
  },
  tavily: {
    request: { method: 'GET', url: 'https://api.tavily.com/usage', headers: { authorization: 'Bearer ${key}' } },
    response: { usedPath: 'account.plan_usage', totalPath: 'account.plan_limit' },
    unit: 'credits',
  },
}

function resolveSpec(provider) {
  const declared = provider?.balance
  if (declared && typeof declared === 'object' && declared.request && typeof declared.request === 'object') {
    return {
      request: declared.request,
      response: declared.response && typeof declared.response === 'object' ? declared.response : {},
      unit: declared.unit,
      detail: declared.detail,
    }
  }
  const builtin = BUILTIN_SPECS[provider?.kind]
  return builtin ? { ...builtin, detail: builtin.detail } : null
}

function fillTemplate(value, key) {
  if (typeof value === 'string') return value.replaceAll('${key}', key)
  if (Array.isArray(value)) return value.map((item) => fillTemplate(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, fillTemplate(item, key)]))
  }
  return value
}

function unknownBalance(detail, now) {
  return {
    status: 'unknown',
    remaining: null,
    total: null,
    used: null,
    unit: 'unknown',
    ratio: null,
    source: 'none',
    detail,
    fetchedAt: now,
  }
}

/**
 * Probe one provider's balance. Never throws: every failure becomes a record
 * with `status: 'error'` or `status: 'unknown'` plus a short `detail`.
 *
 * @param {object} provider provider config row
 * @param {{key?: string, now?: number, fetchImpl?: typeof fetch, timeoutMs?: number, signal?: AbortSignal}} [options]
 */
export async function probeBalance(provider, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const spec = resolveSpec(provider)
  if (!spec) return unknownBalance('no-balance-api', now)

  const key = typeof options.key === 'string' ? options.key : ''
  if (key.length === 0) return unknownBalance('key-missing', now)

  const request = spec.request
  const url = fillTemplate(String(request.url ?? ''), key)
  if (url.length === 0) return unknownBalance('no-balance-api', now)
  const method = String(request.method ?? 'GET').toUpperCase()
  const headers = {}
  for (const [name, value] of Object.entries(request.headers ?? {})) headers[name] = fillTemplate(value, key)
  if (headers.accept === undefined) headers.accept = 'application/json'
  let body
  if (request.body !== undefined) {
    body = JSON.stringify(fillTemplate(request.body, key))
    if (headers['content-type'] === undefined) headers['content-type'] = 'application/json'
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`balance probe timeout after ${timeoutMs}ms`)), timeoutMs)
  const onAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener?.('abort', onAbort, { once: true })

  let response
  let text
  try {
    response = await fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body }), signal: controller.signal, redirect: 'error' })
    text = await response.text()
  } catch (error) {
    return { ...unknownBalance(String(error?.message ?? error).slice(0, 300), now), status: 'error' }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener?.('abort', onAbort)
  }

  if (!response.ok) {
    return {
      ...unknownBalance(`HTTP ${response.status} ${String(text ?? '').slice(0, 160)}`, now),
      status: 'error',
      source: 'api',
    }
  }

  let json
  try {
    json = text && text.length > 0 ? JSON.parse(text) : undefined
  } catch {
    return { ...unknownBalance('unparseable balance response', now), status: 'error', source: 'api' }
  }
  if (json === undefined) return { ...unknownBalance('empty balance response', now), status: 'error', source: 'api' }

  const paths = spec.response ?? {}
  const readPath = (spec) => {
    const candidates = Array.isArray(spec) ? spec : [spec]
    for (const candidate of candidates) {
      const value = getPath(json, candidate)
      if (value !== undefined && value !== null) return value
    }
    return undefined
  }
  const total = toNumber(readPath(paths.totalPath))
  const used = toNumber(readPath(paths.usedPath))
  let remaining = toNumber(readPath(paths.remainingPath))
  if (remaining === null && used !== null && total !== null) remaining = total - used

  const balance = normalizeBalance({ remaining, total, used, unit: spec.unit, now, source: 'api', detail: spec.detail })
  return balance
}
