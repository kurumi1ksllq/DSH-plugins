// Ordered multi-provider web search with quota-aware failover.
// No dependencies. Node >= 20 (global fetch / AbortSignal.timeout).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export class SearchError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export const DEFAULT_COOLDOWN = { quota: 1800, auth: 86400, error: 60 };
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_LIMIT = 8;

// ---------------------------------------------------------------- config

export function defaultConfigPath() {
  if (process.env.WEBSEARCH_FAILOVER_CONFIG) return process.env.WEBSEARCH_FAILOVER_CONFIG;
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const candidates = [path.join(home, 'websearch-failover', 'providers.json'), path.join(scriptDir(), '..', 'providers.json')];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function scriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function defaultStatePath() {
  if (process.env.WEBSEARCH_FAILOVER_STATE) return process.env.WEBSEARCH_FAILOVER_STATE;
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'websearch-failover-state.json');
}

export function loadConfig(configPath = defaultConfigPath()) {
  if (!fs.existsSync(configPath)) {
    throw new SearchError(
      `provider config not found: ${configPath}. Copy providers.example.json to providers.json and fill in key env names.`,
      'CONFIG_MISSING',
      { configPath },
    );
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const defaults = {
    limit: raw.defaults?.limit ?? DEFAULT_LIMIT,
    timeoutMs: raw.defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cooldown: { ...DEFAULT_COOLDOWN, ...(raw.defaults?.cooldown ?? {}) },
    stopOnFirstSuccess: raw.defaults?.stopOnFirstSuccess ?? true,
  };
  const providers = (raw.providers ?? [])
    .filter((p) => p && p.id && p.kind)
    .filter((p) => p.enabled !== false)
    .map((p, index) => ({ priority: index, ...p }))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  if (providers.length === 0) throw new SearchError('no enabled providers in config', 'CONFIG_EMPTY', { configPath });
  return { configPath, defaults, providers };
}

// ---------------------------------------------------------------- keys

export function resolveKey(provider) {
  if (typeof provider.apiKey === 'string' && provider.apiKey.length > 0) return provider.apiKey;
  for (const name of [provider.apiKeyEnv, ...(provider.apiKeyEnvFallbacks ?? [])].filter(Boolean)) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  if (provider.keyFile) {
    try {
      const value = fs.readFileSync(provider.keyFile, 'utf8').trim().split(/\r?\n/)[0];
      if (value.length > 0) return value;
    } catch {
      /* fall through */
    }
  }
  if (provider.keyOptional === true) return '';
  throw new SearchError(
    `no API key for provider "${provider.id}" (env ${provider.apiKeyEnv ?? '<unset>'} is empty)`,
    'KEY_MISSING',
    { providerId: provider.id },
  );
}

// ---------------------------------------------------------------- state

export function readState(statePath = defaultStatePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { providers: parsed.providers ?? {} };
  } catch {
    return { providers: {} };
  }
}

function writeState(state, statePath) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, statePath);
  } catch {
    /* state is advisory; never fail a search over it */
  }
}

function cooldownActive(entry, now) {
  if (!entry || typeof entry.until !== 'number') return false;
  return entry.until > now;
}

// ---------------------------------------------------------------- errors

// `次`/`上限` were dropped on purpose: alone they match ordinary error copy
// ("调用次数超限的接口", "超出重试次数") that has nothing to do with billing.
const QUOTA_RE = /quota|credit|insufficient|balance|exceeded|rate.?limit|too many requests|额度|余额|配额|超出|用尽/i;
const AUTH_RE = /invalid api key|unauthorized|authentication|forbidden|invalid.?key|api.?key/i;

export function classifyFailure({ status, bodyText, error }) {
  const text = `${bodyText ?? ''} ${error?.message ?? ''}`;
  if (status === 429 || status === 402) return { kind: 'quota', retryAfter: parseRetryAfter(bodyText) };
  if (status === 401) return { kind: 'auth' };
  if (status === 403) return QUOTA_RE.test(text) ? { kind: 'quota' } : { kind: 'auth' };
  if (QUOTA_RE.test(text)) return { kind: 'quota', retryAfter: parseRetryAfter(bodyText) };
  if (AUTH_RE.test(text)) return { kind: 'auth' };
  if (status === 400 || status === 422) return { kind: 'bad_request' };
  return { kind: 'error' };
}

function parseRetryAfter(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    for (const key of ['retry_after', 'retryAfter', 'retry_after_seconds']) {
      const value = Number(parsed?.[key] ?? parsed?.error?.[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  } catch {
    /* not json */
  }
  return undefined;
}

// ---------------------------------------------------------------- fetch helpers

async function httpJson(url, init, timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  let response;
  let text;
  try {
    response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
    text = await response.text();
  } catch (error) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted === true) throw new SearchError('search aborted', 'ABORTED', { cause: error });
    const kind = classifyFailure({ error });
    throw new SearchError(`request failed: ${error?.message ?? String(error)}`, 'TRANSPORT', { failureKind: kind.kind, cause: error });
  }
  clearTimeout(timer);
  signal?.removeEventListener('abort', onAbort);
  let json;
  try {
    json = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const failure = classifyFailure({ status: response.status, bodyText: text });
    throw new SearchError(`HTTP ${response.status}: ${truncate(text, 400)}`, 'HTTP_ERROR', {
      status: response.status,
      failureKind: failure.kind,
      retryAfter: failure.retryAfter,
      bodyText: text,
    });
  }
  if (json === undefined) throw new SearchError(`unparseable response body: ${truncate(text, 200)}`, 'BAD_BODY', { failureKind: 'error' });
  return json;
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function getPath(object, dotted) {
  if (!dotted) return undefined;
  let node = object;
  for (const part of dotted.split('.')) {
    if (node == null) return undefined;
    node = Array.isArray(node) && /^\d+$/.test(part) ? node[Number(part)] : node[part];
  }
  return node;
}

function normalize(sources, limit) {
  const seen = new Set();
  const out = [];
  for (const source of sources) {
    if (!source?.url || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push({
      title: source.title ?? '',
      url: source.url,
      ...(source.snippet ? { snippet: String(source.snippet).replace(/\s+/g, ' ').slice(0, 600) } : {}),
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function mapList(list, map, limit) {
  const rows = Array.isArray(list) ? list : list == null ? [] : [list];
  return normalize(
    rows.map((row) => ({
      title: map.title ? getPath(row, map.title) : undefined,
      url: map.url ? getPath(row, map.url) : undefined,
      snippet: map.snippet ? getPath(row, map.snippet) : undefined,
      publishedAt: map.publishedAt ? getPath(row, map.publishedAt) : undefined,
    })),
    limit,
  );
}

// ---------------------------------------------------------------- adapters

export const ADAPTERS = {
  async tavily(p, { query, limit, key }, signal) {
    const json = await httpJson(
      p.endpoint ?? 'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          api_key: key,
          query,
          max_results: limit,
          search_depth: p.searchDepth ?? 'basic',
          include_answer: false,
        }),
      },
      p.timeoutMs,
      signal,
    );
    return mapList(json.results, { title: 'title', url: 'url', snippet: 'content' }, limit);
  },

  async serper(p, { query, limit, key }, signal) {
    const json = await httpJson(
      p.endpoint ?? 'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ q: query, num: limit }),
      },
      p.timeoutMs,
      signal,
    );
    const rows = [...(json.organic ?? []), ...(json.news ?? []), ...(json.peopleAlsoAsk ?? [])];
    return mapList(rows, { title: 'title', url: 'link', snippet: 'snippet' }, limit);
  },

  async brave(p, { query, limit, key }, signal) {
    const url = new URL(p.endpoint ?? 'https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(limit));
    const json = await httpJson(
      url,
      { method: 'GET', headers: { 'X-Subscription-Token': key, accept: 'application/json' } },
      p.timeoutMs,
      signal,
    );
    return mapList(json.web?.results, { title: 'title', url: 'url', snippet: 'description', publishedAt: 'age' }, limit);
  },

  async bocha(p, { query, limit, key }, signal) {
    const json = await httpJson(
      p.endpoint ?? 'https://api.bochaai.com/v1/web-search',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, count: limit, summary: true }),
      },
      p.timeoutMs,
      signal,
    );
    const data = json.data ?? json;
    return mapList(data.webPages?.value, { title: 'name', url: 'url', snippet: 'summary' }, limit);
  },

  async exa(p, { query, limit, key }, signal) {
    const json = await httpJson(
      p.endpoint ?? 'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, numResults: limit, contents: { text: { maxCharacters: 400 } } }),
      },
      p.timeoutMs,
      signal,
    );
    return mapList(json.results, { title: 'title', url: 'url', snippet: 'text', publishedAt: 'publishedDate' }, limit);
  },

  async jina(p, { query, limit, key }, signal) {
    const url = new URL(p.endpoint ?? 'https://s.jina.ai/');
    const json = await httpJson(
      new URL(encodeURIComponent(query), url),
      {
        method: 'GET',
        headers: { accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      },
      p.timeoutMs,
      signal,
    );
    const list = json.data ?? json.results ?? json;
    return mapList(list, { title: 'title', url: 'url', snippet: 'content', publishedAt: 'publishedTime' }, limit);
  },

  async searxng(p, { query, limit, key }, signal) {
    const url = new URL(p.endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const headers = { accept: 'application/json' };
    // T4.web: SearXNG instances authenticate three ways in the wild —
    // default Bearer, HTTP Basic, or a named header. `auth.type` picks one;
    // absent, the historical Bearer behaviour is unchanged.
    const auth = p.auth ?? null;
    if (auth?.type === 'basic') {
      const user = typeof auth.usernameEnv === 'string' ? (process.env[auth.usernameEnv] ?? '') : '';
      const pass = typeof auth.passwordEnv === 'string' ? (process.env[auth.passwordEnv] ?? '') : '';
      headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    } else if (auth?.type === 'header' && typeof auth.header === 'string' && auth.header.trim() !== '') {
      if (typeof key === 'string' && key.length > 0) headers[auth.header.trim()] = key;
    } else if (typeof key === 'string' && key.length > 0) {
      headers.authorization = `Bearer ${key}`;
    }
    const json = await httpJson(url, { method: 'GET', headers }, p.timeoutMs, signal);
    return mapList(json.results, { title: 'title', url: 'url', snippet: 'content', publishedAt: 'publishedDate' }, limit);
  },

  async parallel(p, { query, limit, key }, signal) {
    const json = await httpJson(
      p.endpoint ?? 'https://api.parallel.ai/v1/search',
      {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          objective: query,
          search_queries: p.searchQueries ?? [query],
          mode: p.mode ?? 'fast',
          max_chars_total: p.maxCharsTotal ?? 6000,
        }),
      },
      p.timeoutMs,
      signal,
    );
    return mapList(json.results, { title: 'title', url: 'url', snippet: 'excerpts.0', publishedAt: 'publish_date' }, limit);
  },

  async firecrawl(p, { query, limit, key }, signal) {
    const json = await httpJson(
      p.endpoint ?? 'https://api.firecrawl.dev/v1/search',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, limit, ...(p.sources ? { sources: p.sources } : {}) }),
      },
      p.timeoutMs,
      signal,
    );
    const list = json.data ?? json.results ?? [];
    return mapList(list, { title: 'title', url: 'url', snippet: 'description', publishedAt: 'publishedAt' }, limit);
  },

  // Fully configurable: request template + JSON path mapping.
  async custom(p, { query, limit, key }, signal) {
    const spec = p.request;
    if (!spec?.url) throw new SearchError(`provider "${p.id}" has no request.url`, 'CONFIG_INVALID');
    const fill = (value) =>
      typeof value === 'string'
        ? value
            .replaceAll('${query}', query)
            .replaceAll('${key}', key)
            .replaceAll('${limit}', String(limit))
        : value;
    const headers = Object.fromEntries(
      Object.entries(spec.headers ?? {}).map(([k, v]) => [k, fill(v)]),
    );
    let url = fill(spec.url);
    let body;
    if (spec.body !== undefined) {
      body = JSON.stringify(replaceDeep(spec.body, fill));
      headers['content-type'] ??= 'application/json';
    } else if (spec.query !== undefined) {
      const target = new URL(url);
      for (const [k, v] of Object.entries(spec.query)) target.searchParams.set(k, fill(v));
      url = target.toString();
    }
    const json = await httpJson(url, { method: spec.method ?? (body ? 'POST' : 'GET'), headers, ...(body ? { body } : {}) }, p.timeoutMs, signal);
    const list = getPath(json, p.response?.sourcesPath);
    return mapList(list, p.response?.map ?? { title: 'title', url: 'url', snippet: 'snippet' }, limit);
  },
};

function replaceDeep(node, fill) {
  if (typeof node === 'string') return fill(node);
  if (Array.isArray(node)) return node.map((item) => replaceDeep(item, fill));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, replaceDeep(v, fill)]));
  }
  return node;
}

export const KINDS = Object.keys(ADAPTERS);

// ---------------------------------------------------------------- engine

/**
 * Try providers in priority order until one returns sources.
 * Quota/auth/transport failures put that provider on cooldown so the next
 * search skips it instead of burning another request.
 */
/**
 * T4.web ALL_FAILED guidance: when every provider failed, the agent reading
 * this error is the one that can actually fix it — but only if the error says
 * HOW. The text names the two real remedies (check/enable providers in the
 * Tools page panel; wait out quota cooldowns) instead of a bare failure list.
 */
function t4Guidance(attempts) {
  const cooling = attempts.filter((a) => a.outcome === 'skipped').length;
  const failed = attempts.length - cooling;
  return (
    '全部搜索提供方都失败了。' +
    (cooling > 0 ? `${cooling} 个在冷却中（多为配额/认证问题），` : '') +
    `${failed} 个尝试失败。请检查 Tools 页的 Web 搜索提供方面板：确认至少启用了一个提供方且其 key 已配置 ` +
    '(enabled=true、apiKeyEnv 指向的环境变量有值)，或等待配额冷却结束；也可以在面板中调整优先级后重试。'
  );
}

export async function search({ query, limit, config, statePath, force = false, signal, now = Date.now() }) {
  if (!query || query.trim().length === 0) throw new SearchError('empty query', 'BAD_QUERY');
  const { providers, defaults } = config;
  const state = readState(statePath);
  const want = Math.max(1, Math.min(Number(limit ?? defaults.limit) || defaults.limit, 50));
  const attempts = [];
  let stateDirty = false;

  // T4.web 冷却过期清理: entries whose cooldown has elapsed are dead weight —
  // they linger in the state file forever (until the provider happens to
  // succeed) and make the panel show stale cooldown rows. Prune them up
  // front; pruning IS a state change worth persisting.
  for (const [id, entry] of Object.entries(state.providers)) {
    if (!cooldownActive(entry, now)) {
      delete state.providers[id];
      stateDirty = true;
    }
  }

  for (const provider of providers) {
    const cooldown = state.providers[provider.id];
    if (!force && cooldownActive(cooldown, now)) {
      attempts.push({
        provider: provider.id,
        outcome: 'skipped',
        reason: cooldown.reason ?? 'cooldown',
        until: new Date(cooldown.until).toISOString(),
      });
      continue;
    }

    const started = Date.now();
    try {
      const key = resolveKey(provider);
      const adapter = ADAPTERS[provider.kind];
      if (!adapter) throw new SearchError(`unknown provider kind "${provider.kind}" (known: ${KINDS.join(', ')})`, 'CONFIG_INVALID');
      const sources = await adapter({ ...provider, timeoutMs: provider.timeoutMs ?? defaults.timeoutMs }, { query, limit: want, key }, signal);
      const elapsedMs = Date.now() - started;
      if (sources.length === 0) {
        attempts.push({ provider: provider.id, outcome: 'empty', elapsedMs });
        continue;
      }
      attempts.push({ provider: provider.id, outcome: 'ok', elapsedMs, count: sources.length });
      if (state.providers[provider.id]) {
        delete state.providers[provider.id];
        stateDirty = true;
      }
      if (stateDirty) writeState(state, statePath);
      return { provider: provider.id, kind: provider.kind, query, sources, attempts, truncated: sources.length >= want };
    } catch (error) {
      if (error?.code === 'ABORTED' || signal?.aborted === true) {
        // T4.web ABORTED 计数: attribute the abort to the provider that was
        // in flight, so the panel's stats show the cancellation instead of
        // silently dropping the attempt.
        attempts.push({
          provider: provider.id,
          outcome: 'aborted',
          elapsedMs: Date.now() - started,
        });
        if (stateDirty) writeState(state, statePath);
        // Attach the attempt list so index.js can record the aborted attempt
        // the same way it records ALL_FAILED ones.
        error.attempts = attempts;
        throw error;
      }
      const kind = error?.failureKind ?? (error?.code === 'KEY_MISSING' ? 'auth' : 'error');
      const elapsedMs = Date.now() - started;
      const seconds = error?.retryAfter ?? defaults.cooldown[kind] ?? defaults.cooldown.error;
      if (kind !== 'bad_request') {
        state.providers[provider.id] = {
          until: now + seconds * 1000,
          reason: kind,
          code: error?.code ?? 'ERROR',
          message: truncate(String(error?.message ?? error), 300),
          at: new Date(now).toISOString(),
        };
        stateDirty = true;
      }
      attempts.push({
        provider: provider.id,
        outcome: 'failed',
        kind,
        code: error?.code,
        status: error?.status,
        message: truncate(String(error?.message ?? error), 300),
        elapsedMs,
        cooldownSeconds: kind === 'bad_request' ? 0 : seconds,
      });
      continue;
    }
  }

  if (stateDirty) writeState(state, statePath);
  throw new SearchError(
    `${t4Guidance(attempts)} all ${providers.length} provider(s) failed or cooling down; attempts: ${attempts
      .map((a) => `${a.provider}=${a.outcome}${a.kind ? `(${a.kind})` : ''}`)
      .join(', ')}`,
    'ALL_FAILED',
    { attempts },
  );
}

/**
 * Test every configured provider once, ignoring priority and cooldowns, and
 * never writing cooldown state. Use to find out which keys are alive.
 */
export async function probeAll({ config, signal, query = 'deepseek harness', limit = 3 }) {
  const results = [];
  for (const provider of config.providers) {
    const started = Date.now();
    try {
      const key = resolveKey(provider);
      const adapter = ADAPTERS[provider.kind];
      if (!adapter) throw new SearchError(`unknown provider kind "${provider.kind}"`, 'CONFIG_INVALID');
      const sources = await adapter(
        { ...provider, timeoutMs: provider.timeoutMs ?? config.defaults.timeoutMs },
        { query, limit, key },
        signal,
      );
      results.push({
        provider: provider.id,
        kind: provider.kind,
        ok: sources.length > 0,
        elapsedMs: Date.now() - started,
        count: sources.length,
        sample: sources.slice(0, 2).map((s) => `${s.title || '(no title)'} — ${s.url}`),
      });
    } catch (error) {
      results.push({
        provider: provider.id,
        kind: provider.kind,
        ok: false,
        elapsedMs: Date.now() - started,
        failureKind: error?.failureKind,
        code: error?.code,
        status: error?.status,
        message: truncate(String(error?.message ?? error), 300),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------- reporting

export function formatResult(result) {
  const lines = [];
  lines.push(`provider: ${result.provider} (${result.kind})`);
  lines.push(`query:    ${result.query}`);
  lines.push(`sources:  ${result.sources.length}`);
  result.sources.forEach((s, i) => {
    lines.push('');
    lines.push(`${i + 1}. ${s.title || '(no title)'}`);
    lines.push(`   ${s.url}`);
    if (s.publishedAt) lines.push(`   ${s.publishedAt}`);
    if (s.snippet) lines.push(`   ${s.snippet}`);
  });
  const failures = result.attempts.filter((a) => a.outcome !== 'ok');
  if (failures.length > 0) {
    lines.push('');
    lines.push('attempts:');
    for (const a of result.attempts) {
      const detail = a.outcome === 'failed' ? `${a.kind ?? ''} ${a.message ?? ''}` : a.reason ?? '';
      const cd = a.cooldownSeconds ? ` cooldown=${a.cooldownSeconds}s` : '';
      lines.push(`  - ${a.provider}: ${a.outcome} ${detail}${cd}`.trimEnd());
    }
  }
  return lines.join('\n');
}
