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
import { fetchManifestText, parseRepoUrl, repoSlug } from './sync-remote.js'
import { publicState, readState, writeState } from './sync-state.js'
import { prepareManifestText, publishManifest } from './sync-publish.js'
import { applyItems } from './sync-apply.js'

/**
 * Build the status payload.
 *
 * `snapshot` is the cached inventory snapshot — the evidence of what this
 * machine has. It is never written to here.
 */
export async function syncStatus({ snapshot, state = readState(), options = {} } = {}) {
  const parsed = parseRepoUrl(state.repo)
  const base = {
    state: publicState(state),
    capabilities: {
      canPublish: typeof state.token === 'string' && state.token.length > 0 && parsed.error === undefined,
      canPull: parsed.error === undefined,
      reason: parsed.error ?? null,
    },
  }

  // No repository configured yet: that is a normal first-run state, not an
  // error. Report the local side so the panel can still show what exists.
  if (parsed.error !== undefined) {
    return { ...base, manifest: null, rows: [], counts: summarizeDiff([]) }
  }

  const fetched = await fetchManifestText(parsed, {
    ref: state.ref,
    path: state.path,
    token: state.token,
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
  return {
    ...base,
    via: fetched.via,
    manifest: {
      repo: repoSlug(parsed),
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
  const parsed = parseRepoUrl(state.repo)
  if (parsed.error !== undefined) return { ok: false, error: parsed.error }
  if (typeof state.token !== 'string' || state.token.length === 0) {
    return { ok: false, error: '还没有配置 GitHub token' }
  }
  const manifest = buildManifest(snapshot, {
    annotations: state.annotations,
    now,
    repo: repoSlug(parsed),
    ref: state.ref,
  })
  const result = await publishManifest({
    owner: parsed.owner,
    repo: parsed.repo,
    path: parsed.path ?? state.path,
    ref: state.ref,
    token: state.token,
    manifest,
    force: options.force === true,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  if (result.ok === true && result.unchanged !== true) {
    writeState({ lastPushAt: now })
  }
  return result
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
  const keys = Array.isArray(selection) ? selection.filter((k) => typeof k === 'string') : []
  if (keys.length === 0) return { ok: false, error: '没有选中任何项', results: [] }

  const parsed = parseRepoUrl(state.repo)
  if (parsed.error !== undefined) return { ok: false, error: parsed.error, results: [] }

  const fetched = await fetchManifestText(parsed, {
    ref: state.ref,
    path: state.path,
    token: state.token,
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
  })

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
  if (typeof patch?.ref === 'string' && patch.ref.trim().length > 0) next.ref = patch.ref.trim()
  if (typeof patch?.path === 'string' && patch.path.trim().length > 0) next.path = patch.path.trim()
  // An explicit empty string clears the token; `undefined` leaves it alone.
  if (typeof patch?.token === 'string') next.token = patch.token.trim()
  if (patch?.annotations !== null && typeof patch?.annotations === 'object' && !Array.isArray(patch?.annotations)) {
    next.annotations = patch.annotations
  }
  return publicState(writeState(next))
}
