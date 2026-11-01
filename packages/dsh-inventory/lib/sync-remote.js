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

/** A GitHub repository reference: owner/repo plus optional ref and path. */
export const DEFAULT_MANIFEST_PATH = 'dsh-manifest.json'

/**
 * Accept the shapes a user actually types into a text box:
 *   `owner/repo`
 *   `https://github.com/owner/repo`
 *   `https://github.com/owner/repo.git`
 *   `git@github.com:owner/repo.git`
 * plus optional `/tree/<ref>/<path>` or `/blob/<ref>/<path>` suffixes.
 *
 * Returns `{ owner, repo, ref, path }` or `{ error }`.
 */
export function parseRepoUrl(input) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { error: '仓库地址为空' }
  }
  let text = input.trim()

  // Bare `owner/repo` — the most common form.
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    const [owner, repo] = text.split('/')
    return { owner, repo, ref: null, path: null }
  }

  // scp-like `git@host:owner/repo.git`
  const scp = text.match(/^git@[A-Za-z0-9.-]+:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (scp !== null) {
    return { owner: scp[1], repo: scp[2], ref: null, path: null }
  }

  text = text.replace(/^git\+/, '')
  let url
  try {
    url = new URL(text)
  } catch {
    return { error: `无法解析仓库地址：${input}` }
  }
  if (!/(^|\.)github\.com$/.test(url.hostname)) {
    return { error: `只支持 github.com，收到 ${url.hostname}` }
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
  return { owner, repo, ref, path }
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
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${file}`
}

/** The API URL for a manifest, used when raw fails or auth is available. */
export function apiUrl(parsed, { ref = 'main', path = DEFAULT_MANIFEST_PATH } = {}) {
  const branch = parsed?.ref ?? ref
  const file = parsed?.path ?? path
  return `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${file}?ref=${encodeURIComponent(branch)}`
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
 */
export async function fetchManifestText(parsed, options = {}) {
  const ref = options.ref ?? 'main'
  const path = options.path ?? DEFAULT_MANIFEST_PATH
  const token = options.token ?? null
  const timeoutMs = options.timeoutMs ?? 15000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const attempts = []

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
        if (response.status === 404 && ref === 'main') {
          const defaulted = await fetchViaDefaultBranch(parsed, { path, token, timeoutMs, fetchImpl })
          if (defaulted.text !== undefined) return defaulted
          if (defaulted.defaultBranch !== null) {
            attempts.push(`默认分支是 ${defaulted.defaultBranch}，重试失败`)
          }
        }
      }
    } catch (error) {
      attempts.push(`raw: ${error?.message ?? error}`)
    }

    // 2. Contents API (private repos, and better error reporting)
    try {
      const headers = { Accept: 'application/vnd.github+json' }
      if (typeof token === 'string' && token.length > 0) headers.Authorization = `Bearer ${token}`
      const response = await withTimeout(fetchImpl(apiUrl(parsed, { ref, path }), { headers }), timeoutMs)
      if (response.ok) {
        const payload = await response.json()
        const text = decodeContents(payload)
        if (typeof text === 'string' && text.length > 0) return { text, via: 'api' }
        attempts.push('api: 内容为空')
      } else {
        attempts.push(`api: HTTP ${response.status}`)
      }
    } catch (error) {
      attempts.push(`api: ${error?.message ?? error}`)
    }
  } else {
    attempts.push('无 fetch 实现')
  }

  // 3. git clone, last resort.
  const cloned = await fetchViaClone(parsed, { ref, path, timeoutMs, gitBin: options.gitBin })
  if (cloned.text !== undefined) return { text: cloned.text, via: 'git' }
  attempts.push(`git: ${cloned.error}`)

  return { error: `无法读取清单（${attempts.join('；')}）。若仓库默认分支不是 main，请在同步配置里把 ref 改成实际分支，或用仓库地址加 /tree/<分支>/ 后缀。` }
}

/**
 * Ask GitHub which branch the repository actually defaults to, then fetch the
 * manifest from it.
 *
 * Returns `{ text, via, defaultBranch }` on success, `{ defaultBranch }` when
 * the branch was learned but the fetch still failed, or `{ defaultBranch: null }`
 * when even the probe failed (offline, private repo without token).
 */
async function fetchViaDefaultBranch(parsed, { path, token, timeoutMs, fetchImpl }) {
  let defaultBranch = null
  try {
    const headers = { Accept: 'application/vnd.github+json' }
    if (typeof token === 'string' && token.length > 0) headers.Authorization = `Bearer ${token}`
    const response = await withTimeout(
      fetchImpl(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers }),
      timeoutMs,
    )
    if (response.ok) {
      const payload = await response.json()
      if (typeof payload?.default_branch === 'string' && payload.default_branch.length > 0) {
        defaultBranch = payload.default_branch
      }
    }
  } catch {
    return { defaultBranch: null }
  }
  if (defaultBranch === null || defaultBranch === 'main') return { defaultBranch }

  try {
    const response = await withTimeout(fetchImpl(rawUrl(parsed, { ref: defaultBranch, path })), timeoutMs)
    if (response.ok) {
      const text = await response.text()
      if (text.length > 0) return { text, via: 'raw', defaultBranch }
    }
  } catch {
    // fall through
  }
  return { defaultBranch }
}

/** `git clone --depth 1` into a temp dir, read one file, always clean up. */
async function fetchViaClone(parsed, { ref, path, timeoutMs, gitBin }) {
  const git = typeof gitBin === 'string' && gitBin.length > 0 ? gitBin : 'git'
  const url = `https://github.com/${parsed.owner}/${parsed.repo}.git`
  let dir = null
  try {
    dir = mkdtempSync(join(tmpdir(), 'dsh-sync-'))
    await run(git, ['clone', '--depth', '1', '--branch', ref, '--single-branch', '--quiet', url, dir], {
      timeout: timeoutMs,
      windowsHide: true,
    })
    return { text: readFileSync(join(dir, path), 'utf8') }
  } catch (error) {
    return { error: String(error?.message ?? error).split('\n')[0] }
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

function withTimeout(promise, timeoutMs) {
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) return promise
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时 ${timeoutMs}ms`)), timeoutMs)),
  ])
}
