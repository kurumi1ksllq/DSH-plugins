/**
 * Publishing the manifest to a GitHub repository.
 *
 * Writes one file through the contents API. The API needs a token with
 * `contents:write` on that repository — nothing here tries to authenticate any
 * other way, because a public repository accepts anonymous *reads* but never
 * anonymous writes.
 *
 * Two behaviours matter and are easy to get wrong:
 *
 *   Creating vs updating  The contents API requires the current `sha` when
 *                         updating an existing file and rejects it when
 *                         creating one. The caller does not know which case it
 *                         is, so this module looks it up first.
 *   Not committing noise  An identical manifest is not re-committed. A publish
 *                         that changes nothing should say so, not add an empty
 *                         commit to the history.
 */

import { flattenFleet } from './fleet.js'
import { redactForTransport, scanForPaths, scanForSecrets } from './redact.js'

export const MANIFEST_COMMIT_MESSAGE = 'chore(dsh-manifest): update capability manifest'

/** GitHub API base, overridable so tests never touch the network. */
export const API_BASE = 'https://api.github.com'

/** Gitee v5 contents endpoint; the token travels as a query parameter. */
export function giteeContentsUrl(owner, repo, path, token) {
  const clean = String(path).replace(/^\/+/, '')
  const base = `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${clean}`
  return typeof token === 'string' && token.length > 0
    ? `${base}?access_token=${encodeURIComponent(token)}`
    : base
}

function authHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'dsh-inventory',
  }
}

function giteeHeaders() {
  return { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'dsh-inventory' }
}

/**
 * Prepare the outbound document.
 *
 * Returns the redacted JSON text plus the report of what was stripped, so the
 * panel can show "2 secrets and 7 host paths were removed" before the user
 * confirms. The report is produced from the ORIGINAL document, not the redacted
 * one, or it would always be empty.
 */
export function prepareManifestText(manifest) {
  const secrets = scanForSecrets(manifest)
  const paths = scanForPaths(manifest)
  const clean = redactForTransport(manifest)
  return {
    text: `${JSON.stringify(clean, null, 2)}\n`,
    report: {
      secretCount: secrets.length,
      secretPaths: secrets.map((s) => s.path),
      pathCount: paths.length,
      pathPaths: paths.map((p) => p.path),
    },
  }
}

/**
 * Look up the current file, if any.
 *
 * Returns `{ sha, text }` when it exists, `{ sha: null }` when it does not, or
 * `{ error }` when the lookup itself failed for a reason the caller must see
 * (bad token, wrong repository) rather than silently treat as "create new".
 */
export async function lookupFile({ owner, repo, path, ref, token, host = 'github.com', fetchImpl = globalThis.fetch, apiBase = API_BASE, timeoutMs = 15000 }) {
  if (typeof token !== 'string' || token.length === 0) {
    return { error: '没有配置写入用的 token，无法写仓库' }
  }
  const isGitee = host === 'gitee.com'
  const url = isGitee
    ? `${giteeContentsUrl(owner, repo, path, token)}&ref=${encodeURIComponent(ref)}`
    : `${apiBase}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`
  let response
  try {
    response = await withTimeout(fetchImpl(url, { headers: isGitee ? giteeHeaders() : authHeaders(token) }), timeoutMs)
  } catch (error) {
    return { error: `读取仓库文件失败：${error?.message ?? error}` }
  }
  if (response.status === 404) return { sha: null, text: null }
  if (!response.ok) {
    return { error: await describeHttpError(response, `读取 ${path}`) }
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    return { error: '仓库返回的不是合法 JSON' }
  }
  const sha = typeof payload?.sha === 'string' ? payload.sha : null
  const text = typeof payload?.content === 'string' && payload?.encoding === 'base64'
    ? Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8')
    : null
  return { sha, text }
}

/**
 * Create or update the manifest file.
 *
 * Returns `{ ok, created, unchanged, sha, report }` or `{ error }`.
 */
export async function publishManifest(options) {
  const {
    owner,
    repo,
    path = 'dsh-manifest.json',
    ref = 'main',
    token,
    manifest,
    message = MANIFEST_COMMIT_MESSAGE,
    force = false,
    host = 'github.com',
    fetchImpl = globalThis.fetch,
    apiBase = API_BASE,
    timeoutMs = 20000,
  } = options

  const prepared = prepareManifestText(manifest)

  const existing = await lookupFile({ owner, repo, path, ref, token, host, fetchImpl, apiBase, timeoutMs })
  if (existing.error !== undefined) return { error: existing.error, report: prepared.report }

  // Nothing to publish: an unchanged manifest must not produce a commit.
  // `generatedAt` changes on every build by design, so the comparison ignores
  // it — the semantic content is what decides whether history gets noise.
  //
  // `sameManifest` answers `null` when either side is not a usable JSON
  // document: an unparsable stored file is never "the same", so it gets
  // overwritten instead of silently skipped.
  if (!force && existing.sha !== null && sameManifest(existing.text, prepared.text) === true) {
    return {
      ok: true,
      created: false,
      unchanged: true,
      sha: existing.sha,
      report: prepared.report,
    }
  }

  const body = {
    message,
    content: Buffer.from(prepared.text, 'utf8').toString('base64'),
    branch: ref,
  }
  if (existing.sha !== null) body.sha = existing.sha

  const isGitee = host === 'gitee.com'
  const url = isGitee ? giteeContentsUrl(owner, repo, path, token) : `${apiBase}/repos/${owner}/${repo}/contents/${path}`
  let response
  try {
    response = await withTimeout(
      fetchImpl(url, {
        method: 'PUT',
        headers: isGitee ? giteeHeaders() : authHeaders(token),
        body: JSON.stringify(body),
      }),
      timeoutMs,
    )
  } catch (error) {
    return { error: `写入仓库失败：${error?.message ?? error}`, report: prepared.report }
  }
  if (!response.ok) {
    const error = await describeHttpError(response, `写入 ${path}`)
    // 409/422 with our sha attached means the file moved between the lookup
    // and the write — exactly the concurrent-publish race. Flagged so the
    // caller re-reads the winner's document and re-merges, instead of giving
    // up or blind-overwriting.
    const conflict = response.status === 409 || response.status === 422
    return conflict
      ? { ok: false, conflict: true, error, report: prepared.report }
      : { error, report: prepared.report }
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }
  return {
    ok: true,
    created: existing.sha === null,
    unchanged: false,
    sha: typeof payload?.content?.sha === 'string' ? payload.content.sha : undefined,
    report: prepared.report,
  }
}

/**
 * Publish to a self-hosted HTTP endpoint: one PUT with the manifest as body.
 *
 * The endpoint owns its own auth (`Authorization: Bearer <token>`) and is
 * expected to store the body verbatim, so a later GET returns the same JSON.
 * There is no create/update split, no sha, and no commit history — the file is
 * the state. `ETag`-style precondition headers are deliberately not sent: the
 * operator's endpoint is usually nginx dav, which ignores them anyway.
 *
 * Returns the same shape as `publishManifest` so the service layer can treat
 * the two transports uniformly; `created`/`unchanged` have no meaning here.
 */
export async function publishHttp({ url, token, manifest, etag = null, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
  const prepared = prepareManifestText(manifest)
  if (typeof url !== 'string' || !/^https?:\/\//.test(url.trim())) {
    return { error: `HTTP 模式需要完整的 http(s) 直链：${url}`, report: prepared.report }
  }
  const headers = { 'Content-Type': 'application/json' }
  if (typeof token === 'string' && token.length > 0) headers.Authorization = `Bearer ${token}`
  // Conditional write: only land the document if the remote is still the one we
  // read. 412 means another machine published first — reported as `conflict`
  // so the caller can re-read, re-merge and retry instead of clobbering it.
  // No ETag available (endpoint does not emit one): fall back to last write.
  if (typeof etag === 'string' && etag.length > 0) headers['If-Match'] = etag
  let response
  try {
    response = await withTimeout(
      fetchImpl(url.trim(), { method: 'PUT', headers, body: prepared.text }),
      timeoutMs,
    )
  } catch (error) {
    return { error: `写入直链失败：${error?.message ?? error}`, report: prepared.report }
  }
  if (response.status === 412 || response.status === 409) {
    return { ok: false, conflict: true, error: `远端已被其他机器更新（HTTP ${response.status}）`, report: prepared.report }
  }
  if (!response.ok) {
    return { error: `写入直链失败：HTTP ${response.status}`, report: prepared.report }
  }
  return { ok: true, created: false, unchanged: false, report: prepared.report }
}

/**
 * Turn an HTTP failure into something the user can act on.
 *
 * "Bad credentials" and "resource not accessible by personal access token" are
 * the two failures people actually hit, and both read as an opaque 401/403 in
 * the raw body.
 */
async function describeHttpError(response, action) {
  let detail = ''
  try {
    const payload = await response.json()
    detail = typeof payload?.message === 'string' ? payload.message : ''
  } catch {
    detail = ''
  }
  const suffix = detail.length > 0 ? `：${detail}` : ''
  if (response.status === 401) return `${action}失败：token 无效或已过期${suffix}`
  if (response.status === 403) return `${action}失败：token 没有该仓库的写入权限${suffix}`
  if (response.status === 404) return `${action}失败：仓库或分支不存在${suffix}`
  if (response.status === 409) return `${action}失败：文件冲突，请重试${suffix}`
  return `${action}失败：HTTP ${response.status}${suffix}`
}

function withTimeout(promise, timeoutMs) {
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) return promise
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时 ${timeoutMs}ms`)), timeoutMs)),
  ])
}

/**
 * Fields that differ on every build and carry no meaning for a consumer.
 *
 * `generatedAt` is the timestamp of the local build, not content: keeping it in
 * the comparison would make every publish create a commit. `report` is the
 * redaction report of the document that produced this file — a record of what
 * was stripped from *that* machine's snapshot — so a machine that happened to
 * hold one more host path must not be told its manifest "changed" and commit
 * again.
 */
const IGNORED_KEYS = new Set(['generatedAt', 'report'])

/**
 * Deep copy of `value` with every `IGNORED_KEYS` member dropped, keys sorted.
 *
 * Sorting is what makes the comparison order-blind: a stored file whose keys
 * were written in a different order (an older publisher, a hand edit, a
 * formatter) is the same manifest and must not produce a commit. Arrays keep
 * their order — that order is content.
 */
function withoutIgnored(value) {
  if (Array.isArray(value)) return value.map((item) => withoutIgnored(item))
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (IGNORED_KEYS.has(key)) continue
    out[key] = withoutIgnored(value[key])
  }
  return out
}

/**
 * Semantic comparison of two manifest documents.
 *
 * Stripping the `"generatedAt":` line out of the text was not enough: a stored
 * file written with different indentation, CRLF line endings, a trailing
 * newline, or with `generatedAt` moved to another position still compared as
 * "different" and produced a noise commit. Comparing the parsed JSON with the
 * volatile keys dropped tolerates every formatting the publisher — or a hand
 * edit — can produce, and it also ignores key order, because values are
 * compared rather than text — `withoutIgnored` sorts object keys.
 *
 * Fleet documents (v2) are compared through `flattenFleet`, so a stored v1
 * file and a fleet document whose single section matches it compare EQUAL —
 * otherwise the first publish after this plugin ships would always rewrite
 * the file just to change the envelope, and two machines publishing against
 * a legacy remote would each fight the other's envelope, not their content.
 *
 * Returns `true`/`false`, or `null` when either document does not parse; the
 * caller treats `null` as "cannot prove unchanged" and rewrites the file.
 */
export function sameManifest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null
  try {
    return sameJson(asComparableManifest(JSON.parse(a)), asComparableManifest(JSON.parse(b)))
  } catch {
    return null
  }
}

function asComparableManifest(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.fleetVersion === 2) {
    // Flatten instead of comparing envelopes: sections keyed by machine id and
    // the wrapper's volatile fields do not decide "did the content change".
    const flattened = flattenFleet(value)
    if (flattened !== null) {
      // A v1 file never carries `repoUrl`; dropping the empty default keeps a
      // legacy document and its own fleet rendering comparable.
      if (flattened.repoUrl === '') delete flattened.repoUrl
      return flattened
    }
  }
  return value
}

function sameJson(left, right) {
  return JSON.stringify(withoutIgnored(left)) === JSON.stringify(withoutIgnored(right))
}
