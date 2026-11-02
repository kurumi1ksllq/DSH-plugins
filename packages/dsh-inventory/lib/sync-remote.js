/**
 * Remote manifest transport.
 *
 * Reading a one-file manifest must not require cloning a repository. The old
 * path shelled out to `git clone --depth 1` for every check, which needs git on
 * PATH, writes a temporary checkout, and takes seconds for a 4 KB file.
 *
 * Order of preference:
 *   1. `raw.githubusercontent.com` over plain HTTPS — no git, no auth for a
 *      public repository, one request.
 *   2. GitHub contents API — needed for a private repository, and the only path
 *      that reports *why* a fetch failed (401 vs 404 vs empty).
 *   3. `git clone` — last resort, for hosts that are neither of the above.
 *
 * A manifest URL is parsed once into { owner, repo, ref, path }; everything
 * downstream works from that instead of string-pasting URLs.
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** A git-host repository reference: owner/repo plus optional ref and path. */
export const DEFAULT_MANIFEST_PATH = 'dsh-manifest.json'

/**
 * Per-host URL templates and auth conventions.
 *
 * gitee's v5 API takes the token as an `access_token` query parameter (a
 * Bearer header is accepted on some endpoints only), and its raw content lives
 * under the main domain, not a `raw.` subdomain — both differ from GitHub.
 */
export const HOSTS = {
  'github.com': {
    rawUrl: (o, r, ref, path) => `https://raw.githubusercontent.com/${o}/${r}/${ref}/${path}`,
    apiUrl: (o, r, ref, path) => `https://api.github.com/repos/${o}/${r}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    repoApiUrl: (o, r) => `https://api.github.com/repos/${o}/${r}`,
    cloneUrl: (o, r) => `https://github.com/${o}/${r}.git`,
    apiHeaders: (token) => ({
      Accept: 'application/vnd.github+json',
      ...(typeof token === 'string' && token.length > 0 ? { Authorization: `Bearer ${token}` } : {}),
    }),
    tokenInQuery: false,
  },
  'gitee.com': {
    rawUrl: (o, r, ref, path) => `https://gitee.com/${o}/${r}/raw/${ref}/${path}`,
    apiUrl: (o, r, ref, path) => `https://gitee.com/api/v5/repos/${o}/${r}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    repoApiUrl: (o, r) => `https://gitee.com/api/v5/repos/${o}/${r}`,
    cloneUrl: (o, r) => `https://gitee.com/${o}/${r}.git`,
    apiHeaders: () => ({ Accept: 'application/json' }),
    tokenInQuery: true,
  },
}

export function hostProfile(host) {
  return HOSTS[host] ?? HOSTS['github.com']
}

/**
 * Accept the shapes a user actually types into a text box:
 *   `owner/repo`
 *   `https://github.com/owner/repo`
 *   `https://github.com/owner/repo.git`
 *   `git@github.com:owner/repo.git`
 * plus optional `/tree/<ref>/<path>` or `/blob/<ref>/<path>` suffixes.
 *
 * `options.host` re-targets the same shapes at another git host (gitee.com);
 * the bare `owner/repo` form is host-independent. Returns
 * `{ owner, repo, ref, path, host }` or `{ error }`.
 */
export function parseRepoUrl(input, options = {}) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { error: '仓库地址为空' }
  }
  const host = typeof options.host === 'string' && options.host.length > 0 ? options.host : 'github.com'
  let text = input.trim()

  // Bare `owner/repo` — the most common form.
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    const [owner, repo] = text.split('/')
    return { owner, repo, ref: null, path: null, host }
  }

  // scp-like `git@host:owner/repo.git`
  const scp = text.match(/^git@([A-Za-z0-9.-]+):([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (scp !== null) {
    if (scp[1] !== host) return { error: `仓库地址属于 ${scp[1]}，当前模式需要 ${host}` }
    return { owner: scp[2], repo: scp[3], ref: null, path: null, host }
  }

  text = text.replace(/^git\+/, '')
  let url
  try {
    url = new URL(text)
  } catch {
    return { error: `无法解析仓库地址：${input}` }
  }
  if (!new RegExp(`(^|\\.)${host.replace(/\./g, '\\.')}$`).test(url.hostname)) {
    return { error: `只支持 ${host}，收到 ${url.hostname}` }
  }
  const parts = url.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/')
  if (parts.length < 2 || parts[0].length === 0 || parts[1].length === 0) {
    return { error: `地址缺少 owner/repo：${input}` }
  }
  const owner = parts[0]
  const repo = parts[1]
  let ref = null
  let path = null
  // /tree/<ref>/<path...> or /blob/<ref>/<path...>
  if (parts.length >= 4 && (parts[2] === 'tree' || parts[2] === 'blob')) {
    ref = parts[3]
    const rest = parts.slice(4).join('/')
    if (rest.length > 0) path = rest
  }
  return { owner, repo, ref, path, host }
}

/** Canonical `owner/repo` for display and comparison. */
export function repoSlug(parsed) {
  if (parsed === null || typeof parsed !== 'object' || parsed.error) return ''
  return `${parsed.owner}/${parsed.repo}`
}

/** The raw-content URL for a manifest. */
export function rawUrl(parsed, { ref = 'main', path = DEFAULT_MANIFEST_PATH } = {}) {
  const branch = parsed?.ref ?? ref
  const file = parsed?.path ?? path
  return hostProfile(parsed?.host).rawUrl(parsed.owner, parsed.repo, branch, file)
}

/** The API URL for a manifest, used when raw fails or auth is available. */
export function apiUrl(parsed, { ref = 'main', path = DEFAULT_MANIFEST_PATH } = {}) {
  const branch = parsed?.ref ?? ref
  const file = parsed?.path ?? path
  return hostProfile(parsed?.host).apiUrl(parsed.owner, parsed.repo, branch, file)
}

/** The API URL with the token attached the way this host expects it. */
function apiUrlWithAuth(parsed, ref, path, token) {
  const profile = hostProfile(parsed?.host)
  const url = apiUrl(parsed, { ref, path })
  if (profile.tokenInQuery !== true || typeof token !== 'string' || token.length === 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
}

/** GitHub's JSON contents payload wraps the file in base64. */
function decodeContents(payload) {
  if (payload === null || typeof payload !== 'object') return null
  if (typeof payload.content !== 'string' || payload.encoding !== 'base64') return null
  try {
    return Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8')
  } catch {
    return null
  }
}

/**
 * Fetch manifest text.
 *
 * Never throws: returns `{ text }` or `{ error }` so a caller can render "the
 * repository has no manifest" as a state rather than a crash.
 *
 * All three transports share one ref, so a repository whose default branch is
 * `master` used to fail all three when that ref is the default `main`. The real
 * default branch is therefore learned at most once per call (one probe, one
 * retry, no loops) and reused by the raw, contents-API and git paths alike. The
 * probe is best-effort: when it fails the fetch behaves exactly as before.
 */
export async function fetchManifestText(parsed, options = {}) {
  const ref = options.ref ?? 'main'
  const path = options.path ?? DEFAULT_MANIFEST_PATH
  const token = options.token ?? null
  const timeoutMs = options.timeoutMs ?? 15000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const attempts = []

  // Lazily learned default branch, memoized for this call only. `undefined`
  // means "not probed yet"; `null` means "probed and learned nothing", which
  // must not be probed a second time by a later path.
  let defaultBranch
  const learnDefaultBranch = async () => {
    if (defaultBranch !== undefined) return defaultBranch
    defaultBranch = null
    if (typeof fetchImpl !== 'function') return defaultBranch
    try {
      const headers = hostProfile(parsed?.host).apiHeaders(token)
      const response = await withTimeout(
        fetchImpl(hostProfile(parsed?.host).repoApiUrl(parsed.owner, parsed.repo), { headers }),
        timeoutMs,
      )
      if (response.ok) {
        const payload = await response.json()
        if (typeof payload?.default_branch === 'string' && payload.default_branch.length > 0) {
          defaultBranch = payload.default_branch
        }
      }
    } catch {
      // Offline or private repo without a token: stay silent and non-fatal, the
      // caller still has its configured ref and the remaining transports.
      defaultBranch = null
    }
    return defaultBranch
  }
  // The branch to retry with after `asRef` failed; `null` when probing cannot
  // help (nothing learned, or the learned branch is the one that just failed).
  const fallbackRef = async (asRef) => {
    const learned = await learnDefaultBranch()
    return learned !== null && learned !== asRef ? learned : null
  }

  if (typeof fetchImpl === 'function') {
    // 1. raw.githubusercontent.com
    try {
      const response = await withTimeout(fetchImpl(rawUrl(parsed, { ref, path })), timeoutMs)
      if (response.ok) {
        const text = await response.text()
        if (text.length > 0) return { text, via: 'raw' }
        attempts.push('raw: 空文件')
      } else {
        attempts.push(`raw: HTTP ${response.status}`)
        // 404 on the configured ref usually means the default branch is not
        // `main`. Probe the repository's real default branch and retry once
        // before giving up — `parseRepoUrl`'s `/tree/<ref>/` escape hatch
        // exists, but nobody reads docs to fix a 404.
        if (response.status === 404) {
          const retryRef = await fallbackRef(ref)
          if (retryRef !== null) {
            const retried = await readRaw(retryRef, { parsed, path, timeoutMs, fetchImpl })
            if (retried.text !== undefined) return retried
            attempts.push(`raw(${retryRef}): ${retried.error}`)
          }
        }
      }
    } catch (error) {
      attempts.push(`raw: ${error?.message ?? error}`)
    }

    // 2. Contents API (private repos, and better error reporting). A 404 here
    // is as likely to be a wrong ref as a missing file, so the same single
    // retry applies: a private repository has no usable raw path at all, and
    // this is the only transport that can work for it.
    try {
      const first = await readContents(ref, { parsed, path, token, timeoutMs, fetchImpl })
      if (first.text !== undefined) return first
      attempts.push(`api: ${first.error}`)
      if (first.notFound === true) {
        const retryRef = await fallbackRef(ref)
        if (retryRef !== null) {
          const retried = await readContents(retryRef, { parsed, path, token, timeoutMs, fetchImpl })
          if (retried.text !== undefined) return retried
          attempts.push(`api(${retryRef}): ${retried.error}`)
        }
      }
    } catch (error) {
      attempts.push(`api: ${error?.message ?? error}`)
    }
  } else {
    attempts.push('无 fetch 实现')
  }

  // 3. git clone, last resort. When the default branch was learned and the
  // configured ref fails to clone *because that branch does not exist*, clone
  // the learned branch instead: a repo reachable only over git still has a
  // default branch we may know about.
  const cloned = await fetchViaClone(parsed, { ref, path, timeoutMs, gitBin: options.gitBin, clone: options.clone })
  if (cloned.text !== undefined) return { text: cloned.text, via: 'git' }
  attempts.push(`git: ${cloned.error}`)
  if (
    cloned.branchMissing === true &&
    defaultBranch !== undefined &&
    defaultBranch !== null &&
    defaultBranch !== ref
  ) {
    const retried = await fetchViaClone(parsed, {
      ref: defaultBranch,
      path,
      timeoutMs,
      gitBin: options.gitBin,
      clone: options.clone,
    })
    if (retried.text !== undefined) return { text: retried.text, via: 'git' }
    attempts.push(`git(${defaultBranch}): ${retried.error}`)
  }

  return {
    error: `无法读取清单（${attempts.join('；')}）。若仓库默认分支不是 main，请在同步配置里把 ref 改成实际分支，或用仓库地址加 /tree/<分支>/ 后缀。`,
  }
}

/** One raw-content attempt. Returns `{ text, via }` or `{ error }`. */
async function readRaw(ref, { parsed, path, timeoutMs, fetchImpl }) {
  try {
    const response = await withTimeout(fetchImpl(rawUrl(parsed, { ref, path })), timeoutMs)
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const text = await response.text()
    if (text.length === 0) return { error: '空文件' }
    return { text, via: 'raw' }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

/**
 * One contents-API attempt. Returns `{ text, via }` or `{ error, notFound }`;
 * `notFound` lets the caller decide whether a ref retry is worthwhile.
 */
async function readContents(ref, { parsed, path, token, timeoutMs, fetchImpl }) {
  try {
    const headers = hostProfile(parsed?.host).apiHeaders(token)
    const response = await withTimeout(
      fetchImpl(apiUrlWithAuth(parsed, ref, path, token), { headers }),
      timeoutMs,
    )
    if (!response.ok) return { error: `HTTP ${response.status}`, notFound: response.status === 404 }
    const payload = await response.json()
    const text = decodeContents(payload)
    if (typeof text !== 'string' || text.length === 0) return { error: '内容为空' }
    return { text, via: 'api' }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

/**
 * `git clone --depth 1` into a temp dir, read one file, always clean up.
 *
 * `clone` is an injectable seam: it receives the argument list plus options and
 * rejects like the real runner, so unit tests can exercise the branch logic
 * without a network clone.
 *
 * Returns `{ text }`, or `{ error, branchMissing }` where `branchMissing` is
 * true only when the failure clearly says the branch does not exist — a second
 * clone with another branch would otherwise just burn a network round-trip.
 */
async function fetchViaClone(parsed, { ref, path, timeoutMs, gitBin, clone }) {
  const git = typeof gitBin === 'string' && gitBin.length > 0 ? gitBin : 'git'
  const runner = typeof clone === 'function' ? clone : (args, opts) => run(git, args, opts)
  const url = hostProfile(parsed?.host).cloneUrl(parsed.owner, parsed.repo)
  let dir = null
  try {
    dir = mkdtempSync(join(tmpdir(), 'dsh-sync-'))
    await runner(['clone', '--depth', '1', '--branch', ref, '--single-branch', '--quiet', url, dir], {
      timeout: timeoutMs,
      windowsHide: true,
    })
    return { text: readFileSync(join(dir, path), 'utf8') }
  } catch (error) {
    const message = String(error?.message ?? error).split('\n')[0]
    return { error: message, branchMissing: looksLikeMissingRef(`${message}\n${error?.stderr ?? ''}`) }
  } finally {
    if (dir !== null) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // A leftover temp dir is not worth failing a read over.
      }
    }
  }
}

/**
 * Did `git clone --branch X` fail because X does not exist? Only then is a
 * second clone with the probed default branch worth the network round-trip.
 */
function looksLikeMissingRef(text) {
  return /remote branch .* not found|couldn't find remote ref|could not find remote branch|not found in upstream/i.test(
    text,
  )
}

/**
 * Read one manifest from a self-hosted HTTP endpoint.
 *
 * The endpoint is one URL under the operator's control (nginx `dav` location,
 * a tiny upload service, anything that answers GET/PUT). GET returns the
 * manifest JSON itself; 404 means "not published yet", which the caller treats
 * as an empty remote rather than a failure.
 *
 * Never throws: `{ text }` or `{ error }`, with `notFound` flagging the 404.
 */
export async function fetchHttpText(url, options = {}) {
  const token = options.token ?? null
  const timeoutMs = options.timeoutMs ?? 15000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return { error: '无 fetch 实现' }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url.trim())) {
    return { error: `HTTP 模式需要完整的 http(s) 直链：${url}` }
  }
  const headers = { Accept: 'application/json' }
  if (typeof token === 'string' && token.length > 0) headers.Authorization = `Bearer ${token}`
  try {
    const response = await withTimeout(fetchImpl(url.trim(), { headers }), timeoutMs)
    if (response.status === 404) return { notFound: true }
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const text = await response.text()
    if (text.length === 0) return { error: '响应为空' }
    return { text }
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

function withTimeout(promise, timeoutMs) {
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) return promise
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时 ${timeoutMs}ms`)), timeoutMs)),
  ])
}
