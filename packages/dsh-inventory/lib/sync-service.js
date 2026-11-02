/**
 * The sync service: the operations the panel can ask for.
 *
 *   status   What is configured, and what this machine has versus the manifest.
 *   publish  Build a manifest from this machine and write it to the repository.
 *   preview  Build a manifest without writing it, plus the redaction report.
 *   apply    Install exactly the items the user ticked.
 *
 * Two capabilities are reported separately rather than as one direction flag,
 * because they fail for unrelated reasons: publishing needs a token and write
 * access, pulling needs a reachable repository. A single `direction` would make
 * "can push but cannot pull" unrepresentable.
 */

import { buildManifest, entriesOf, parseManifest } from './manifest.js'
import { diffManifest, probeCapabilities, summarizeDiff } from './sync-diff.js'
import { fetchHttpText, fetchManifestText, parseRepoUrl, repoSlug } from './sync-remote.js'
import { publicState, readState, writeState } from './sync-state.js'
import { prepareManifestText, publishHttp, publishManifest } from './sync-publish.js'
import { applyItems } from './sync-apply.js'

/**
 * Resolve the transport for the configured mode.
 *
 *   github / gitee  A git host; returns a parsed `owner/repo` reference.
 *   http            A self-hosted direct URL; `repo` must be a full
 *                   `http(s)://…` link to the manifest file itself.
 *
 * Returns `{ kind: 'git-host', parsed }` or `{ kind: 'http', url }`; an
 * unparseable configuration comes back as `{ error }` so every caller can
 * fail with the same message the panel would have shown.
 */
export function resolveTransport(state) {
  const mode = state?.mode ?? 'github'
  if (mode === 'http') {
    if (typeof state.repo !== 'string' || !/^https?:\/\//.test(state.repo.trim())) {
      return { error: 'HTTP 模式的仓库地址应填写完整的 http(s) 直链，例如 http://服务器/manifests/dsh-manifest.json' }
    }
    return { kind: 'http', url: state.repo.trim() }
  }
  const host = mode === 'gitee' ? 'gitee.com' : 'github.com'
  const parsed = parseRepoUrl(state.repo, { host })
  if (parsed.error !== undefined) return { error: parsed.error }
  return { kind: 'git-host', parsed }
}

/** Read the manifest over the configured transport. */
async function fetchManifest(state, { fetchImpl, timeoutMs }) {
  const transport = resolveTransport(state)
  if (transport.error !== undefined) return { error: transport.error }
  if (transport.kind === 'http') {
    const fetched = await fetchHttpText(transport.url, {
      token: state.token,
      timeoutMs,
      fetchImpl,
    })
    // A 404 from the direct endpoint means "nothing published yet", which is a
    // normal first-run state — surface it as empty, not as an error.
    if (fetched.notFound === true) {
      return { text: JSON.stringify({ manifestVersion: 1, generatedAt: 0, repo: '', ref: state.ref, plugins: [], mcp: [], skills: [] }), via: 'http', empty: true }
    }
    if (fetched.error !== undefined) return { error: fetched.error }
    return { text: fetched.text, via: 'http' }
  }
  return fetchManifestText(transport.parsed, {
    ref: state.ref,
    path: state.path,
    token: state.token,
    fetchImpl,
    timeoutMs,
  })
}

/**
 * Build the status payload.
 *
 * `snapshot` is the cached inventory snapshot — the evidence of what this
 * machine has. It is never written to here.
 */
export async function syncStatus({ snapshot, state = readState(), options = {} } = {}) {
  // `options.now` lets a caller inject the clock, so the recorded pull time is
  // deterministic under test instead of being whatever the host clock said.
  const transport = resolveTransport(state)
  const base = {
    state: publicState(state),
    capabilities: {
      canPublish: typeof state.token === 'string' && state.token.length > 0 && transport.error === undefined,
      canPull: transport.error === undefined,
      reason: transport.error ?? null,
    },
  }

  // No repository configured yet: that is a normal first-run state, not an
  // error. Report the local side so the panel can still show what exists.
  if (transport.error !== undefined) {
    return { ...base, manifest: null, rows: [], counts: summarizeDiff([]) }
  }

  const fetched = await fetchManifest(state, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  if (fetched.error !== undefined) {
    return { ...base, manifest: null, rows: [], counts: summarizeDiff([]), fetchError: fetched.error }
  }

  const parsedManifest = parseManifest(fetched.text)
  if (parsedManifest.error !== undefined) {
    return { ...base, manifest: null, rows: [], counts: summarizeDiff([]), fetchError: parsedManifest.error }
  }

  const capabilities = options.capabilities ?? probeCapabilities(options)
  const rows = diffManifest(parsedManifest.manifest, snapshot, { capabilities })
  // A successful read of a usable manifest is a pull, even if nothing was
  // installed — otherwise the panel's lastPullAt stays 0 forever.
  const pulledAt = options.now ?? Date.now()
  writeState({ lastPullAt: pulledAt })
  return {
    ...base,
    via: fetched.via,
    manifest: {
      repo: transport.kind === 'http' ? transport.url : repoSlug(transport.parsed),
      ref: parsedManifest.manifest.ref ?? state.ref,
      generatedAt: parsedManifest.manifest.generatedAt ?? null,
      counts: {
        plugins: parsedManifest.manifest.plugins.length,
        mcp: parsedManifest.manifest.mcp.length,
        skills: parsedManifest.manifest.skills.length,
      },
    },
    rows,
    counts: summarizeDiff(rows),
  }
}

/** Build a manifest from this machine without writing it anywhere. */
export function syncPreview({ snapshot, state = readState(), now = Date.now() }) {
  const manifest = buildManifest(snapshot, {
    annotations: state.annotations,
    now,
    repoUrl: state.repoUrl,
    repo: repoSlug(parseRepoUrl(state.repo)),
    ref: state.ref,
  })
  return {
    manifest,
    ...prepareManifestText(manifest),
    counts: {
      plugins: manifest.plugins.length,
      mcp: manifest.mcp.length,
      skills: manifest.skills.length,
    },
  }
}

/** Publish this machine's manifest to the configured repository. */
export async function syncPublish({ snapshot, state = readState(), options = {}, now = Date.now() }) {
  const transport = resolveTransport(state)
  if (transport.error !== undefined) return { ok: false, error: transport.error }
  if (typeof state.token !== 'string' || state.token.length === 0) {
    return { ok: false, error: '还没有配置写入用的 token' }
  }
  const manifest = buildManifest(snapshot, {
    annotations: state.annotations,
    now,
    repoUrl: state.repoUrl,
    repo: transport.kind === 'http' ? transport.url : repoSlug(transport.parsed),
    ref: state.ref,
    repoUrl: state.repoUrl,
  })
  const result = transport.kind === 'http'
    ? await publishHttp({
        url: transport.url,
        token: state.token,
        manifest,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      })
    : await publishManifest({
        owner: transport.parsed.owner,
        repo: transport.parsed.repo,
        path: transport.parsed.path ?? state.path,
        ref: state.ref,
        token: state.token,
        manifest,
        force: options.force === true,
        host: transport.parsed.host,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      })
  // An unchanged publish wrote nothing, so it is not a push: bumping
  // `lastPushAt` there would make the panel claim a commit that never
  // happened, and hide the real age of the last one. Skipped publishes also
  // carry `generatedAt` so the panel can say *what* it found already up there.
  if (result.ok === true && result.unchanged !== true) {
    writeState({ lastPushAt: now })
    return result
  }
  return result.ok === true ? { ...result, generatedAt: manifest.generatedAt } : result
}

/**
 * Install a selection.
 *
 * The keys are validated against the current diff, not trusted: a key that is
 * absent from the manifest, or that the manifest marks blocked, is refused
 * here rather than passed to the installer. Otherwise a client could ask to
 * install something this host cannot run.
 */
export async function syncApply({ snapshot, state = readState(), selection, options = {} }) {
  // `options.now` mirrors `syncStatus`: an injected clock keeps the recorded
  // pull time deterministic instead of a hidden `Date.now()` here.
  const keys = Array.isArray(selection) ? selection.filter((k) => typeof k === 'string') : []
  if (keys.length === 0) return { ok: false, error: '没有选中任何项', results: [] }

  const transport = resolveTransport(state)
  if (transport.error !== undefined) return { ok: false, error: transport.error, results: [] }

  const fetched = await fetchManifest(state, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  if (fetched.error !== undefined) return { ok: false, error: fetched.error, results: [] }

  const parsedManifest = parseManifest(fetched.text)
  if (parsedManifest.error !== undefined) return { ok: false, error: parsedManifest.error, results: [] }

  const capabilities = options.capabilities ?? probeCapabilities(options)
  const rows = diffManifest(parsedManifest.manifest, snapshot, { capabilities })
  const byKey = new Map(rows.map((row) => [row.key, row]))

  const wanted = []
  const refused = []
  for (const key of keys) {
    const row = byKey.get(key)
    if (row === undefined) {
      refused.push({ key, ok: false, error: '清单里没有这一项' })
      continue
    }
    if (row.status !== 'missing' && row.status !== 'outdated') {
      const reason = row.reason === null || row.reason === undefined ? '' : `（${row.reason}）`
      refused.push({ key, ok: false, error: `状态是 ${row.status}，不需要安装${reason}` })
      continue
    }
    wanted.push(row)
  }
  if (wanted.length === 0) {
    return { ok: false, error: '选中的项都不能安装', results: refused, failed: refused.length }
  }

  const applied = await applyItems(wanted, {
    profileDir: options.profileDir,
    repoRoot: options.repoRoot,
    vaultDir: options.vaultDir,
    pnpmBin: options.pnpmBin,
    installTimeoutMs: options.installTimeoutMs,
    // From the remote manifest: a fresh machine bootstraps its plugin
    // repository clone from this instead of dead-ending on repo sources.
    repoUrl: parsedManifest.manifest.repoUrl,
    gitBin: options.gitBin,
  })
  if (applied.ok === true) writeState({ lastPullAt: options.now ?? Date.now() })

  const results = [...applied.results, ...refused].sort((a, b) => a.key.localeCompare(b.key))
  const failed = results.filter((r) => r.ok !== true)
  return {
    ok: failed.length === 0,
    results,
    applied: results.filter((r) => r.ok === true).length,
    failed: failed.length,
    ...(failed.length > 0 ? { error: `${failed.length} 项失败` } : {}),
  }
}

/** Save configuration from the panel. Only the keys provided are changed. */
export function syncConfigure(patch) {
  const next = {}
  if (typeof patch?.repo === 'string') next.repo = patch.repo.trim()
  if (['github', 'gitee', 'http'].includes(patch?.mode)) next.mode = patch.mode
  if (typeof patch?.repoUrl === 'string') next.repoUrl = patch.repoUrl.trim()
  if (typeof patch?.ref === 'string' && patch.ref.trim().length > 0) next.ref = patch.ref.trim()
  if (typeof patch?.path === 'string' && patch.path.trim().length > 0) next.path = patch.path.trim()
  // An explicit empty string clears the token; `undefined` leaves it alone.
  if (typeof patch?.token === 'string') next.token = patch.token.trim()
  if (patch?.annotations !== null && typeof patch?.annotations === 'object' && !Array.isArray(patch?.annotations)) {
    next.annotations = patch.annotations
  }
  return publicState(writeState(next))
}
