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

import { redactForTransport, scanForPaths, scanForSecrets } from './redact.js'

export const MANIFEST_COMMIT_MESSAGE = 'chore(dsh-manifest): update capability manifest'

/** GitHub API base, overridable so tests never touch the network. */
export const API_BASE = 'https://api.github.com'

function authHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'dsh-inventory',
  }
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
export async function lookupFile({ owner, repo, path, ref, token, fetchImpl = globalThis.fetch, apiBase = API_BASE, timeoutMs = 15000 }) {
  if (typeof token !== 'string' || token.length === 0) {
    return { error: '没有配置 GitHub token，无法写入仓库' }
  }
  const url = `${apiBase}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`
  let response
  try {
    response = await withTimeout(fetchImpl(url, { headers: authHeaders(token) }), timeoutMs)
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
    fetchImpl = globalThis.fetch,
    apiBase = API_BASE,
    timeoutMs = 20000,
  } = options

  const prepared = prepareManifestText(manifest)

  const existing = await lookupFile({ owner, repo, path, ref, token, fetchImpl, apiBase, timeoutMs })
  if (existing.error !== undefined) return { error: existing.error, report: prepared.report }

  // Nothing to publish: an unchanged manifest must not produce a commit.
  // `generatedAt` changes on every build by design, so the comparison ignores
  // it — the semantic content is what decides whether history gets noise.
  if (!force && existing.sha !== null && existing.text !== null
    && stripGeneratedAt(existing.text) === stripGeneratedAt(prepared.text)) {
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

  const url = `${apiBase}/repos/${owner}/${repo}/contents/${path}`
  let response
  try {
    response = await withTimeout(
      fetchImpl(url, { method: 'PUT', headers: authHeaders(token), body: JSON.stringify(body) }),
      timeoutMs,
    )
  } catch (error) {
    return { error: `写入仓库失败：${error?.message ?? error}`, report: prepared.report }
  }
  if (!response.ok) {
    return { error: await describeHttpError(response, `写入 ${path}`), report: prepared.report }
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
 * Manifest text with the `generatedAt` line removed.
 *
 * Only used for the unchanged check: it must tolerate a malformed timestamp
 * rather than crash the publish path, and it never feeds the write itself.
 */
function stripGeneratedAt(text) {
  return text
    .split('\n')
    .filter((line) => !/"generatedAt"\s*:/.test(line))
    .join('\n')
    .trim()
}
