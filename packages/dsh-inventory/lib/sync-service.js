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

import { buildManifest } from './manifest.js'
import {
  buildFleetDocument,
  flattenFleet,
  LEGACY_ID,
  machineCount,
  machineIds,
  mergeFleetDocument,
  parseFleetDocument,
} from './fleet.js'
import { diffManifest, probeCapabilities, summarizeDiff } from './sync-diff.js'
import { fetchHttpText, fetchManifestText, parseRepoUrl, repoSlug } from './sync-remote.js'
import { publicState, readState, writeState } from './sync-state.js'
import { prepareManifestText, publishHttp, publishManifest } from './sync-publish.js'
import { applyItems } from './sync-apply.js'

/**
 * T4.inv 远端 TTL: the panel re-renders often, and every render used to hit the
 * remote manifest API. A short-lived in-memory cache of the LAST GOOD fetch
 * (keyed by nothing — one process serves one config) bounds that traffic; the
 * TTL is caller-controlled and 0 (default) keeps the old always-refetch
 * behaviour. Cached entries are replaced wholesale by any successful fetch.
 * @type {{ at: number, payload: object } | null}
 */
let remoteCache = null

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
    return { text: fetched.text, via: 'http', ...(fetched.etag !== undefined ? { etag: fetched.etag } : {}) }
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
 * Read the remote as a fleet document, whatever version it stores.
 *
 * Everything downstream (status/apply) wants one flattened v1 view; publishing
 * additionally wants the parsed section map so it can merge its own section in.
 * Returns `{ fleet, machines, manifest, text, via, ... }` or `{ error }`.
 */
async function fetchFleet(state, { fetchImpl, timeoutMs }) {
  const fetched = await fetchManifest(state, { fetchImpl, timeoutMs })
  if (fetched.error !== undefined) {
    // "The manifest does not exist yet" is the state before a fleet's first
    // publish, not a failure: an empty fleet with no sections. Callers that
    // read in order to publish start from here; readers (status/apply) see the
    // empty view and report zero entries.
    if (fetched.notFound === true) {
      return { empty: true, fleet: { fleetVersion: 2, generatedAt: 0, machines: {} }, machines: {}, manifest: null }
    }
    return { error: fetched.error }
  }
  const parsed = parseFleetDocument(fetched.text)
  if (parsed.ok !== true) return { error: parsed.error }
  const manifest = flattenFleet(parsed.fleet)
  if (manifest === null) return { error: parsed.error ?? '舰队清单为空' }
  return { ...fetched, fleet: parsed.fleet, machines: parsed.machines, manifest, legacy: parsed.legacy === true }
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

  // Read-only path: the panel calls this on every render. Pass a state that
  // already *has* an id (or the legacy default) so the read never mints one —
  // minting would write the state file as a side effect of looking, and on a
  // read-only filesystem that attempt is wasted work on a render path.
  const readOnlyState = { ...state, machineId: state?.machineId || LEGACY_ID }
  // `options.now` may be a clock function OR a fixed epoch number (both are
  // used by tests); absent, it is the host clock.
  const now = typeof options.now === 'function'
    ? options.now()
    : Number.isFinite(options.now) ? options.now : Date.now()
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : 0
  if (ttlMs > 0 && remoteCache !== null && now - remoteCache.at < ttlMs) {
    // Fresh enough: serve the cached payload without touching the network.
    return { ...remoteCache.payload, fromCache: true, cacheAgeMs: now - remoteCache.at }
  }
  const fetched = await fetchFleet(readOnlyState, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  if (fetched.error !== undefined) {
    // T4.inv 失败记忆: the failure is PERSISTED so the panel can answer "why is
    // the fleet stale" even after the process that saw it restarted. The error
    // string is truncated to the same 200-char budget the audit uses.
    writeState({ lastFetchError: String(fetched.error).slice(0, 200), lastFetchErrorAt: now }, options.env)
    return { ...base, manifest: null, rows: [], counts: summarizeDiff([]), fetchError: fetched.error }
  }
  // Nothing published yet (or an empty fleet file): a first-run state with
  // zero remote entries, not a fetch failure.
  if (fetched.manifest === null) {
    return {
      ...base,
      manifest: {
        repo: transport.kind === 'http' ? transport.url : repoSlug(transport.parsed),
        ref: state.ref,
        generatedAt: null,
        counts: { plugins: 0, mcp: 0, skills: 0 },
        fleetMachines: 0,
        fleetIds: [],
        publishedByThisMachine: false,
      },
      rows: [],
      counts: summarizeDiff([]),
      via: fetched.via,
      empty: true,
    }
  }

  const capabilities = options.capabilities ?? probeCapabilities(options)
  const rows = diffManifest(fetched.manifest, snapshot, { capabilities })
  // A successful read of a usable manifest is a pull, even if nothing was
  // installed — otherwise the panel's lastPullAt stays 0 forever.
  const pulledAt = now
  // A success clears any remembered failure and fills the TTL cache.
  writeState({ lastPullAt: pulledAt, lastFetchError: '', lastFetchErrorAt: 0 }, options.env)
  const payload = {
    ...base,
    via: fetched.via,
    manifest: {
      repo: transport.kind === 'http' ? transport.url : repoSlug(transport.parsed),
      ref: fetched.manifest.ref ?? state.ref,
      generatedAt: fetched.manifest.generatedAt ?? null,
      counts: {
        plugins: fetched.manifest.plugins.length,
        mcp: fetched.manifest.mcp.length,
        skills: fetched.manifest.skills.length,
      },
      // Fleet facts for the panel: how many machines publish here, which
      // sections exist, and whether this machine has claimed one yet.
      fleetMachines: machineCount(fetched.fleet),
      fleetIds: machineIds(fetched.fleet),
      publishedByThisMachine: machineIds(fetched.fleet).includes(state.machineId),
    },
    rows,
    counts: summarizeDiff(rows),
  }
  remoteCache = { at: now, payload }
  return payload
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

/**
 * Publish this machine's section of the fleet manifest.
 *
 * Concurrency model — two machines publishing "at the same time" must compose,
 * not overwrite:
 *
 *   1. Read the remote document (any stored version) and parse it as a fleet.
 *   2. Merge ONLY this machine's section into the parsed document; every other
 *      machine's section passes through untouched.
 *   3. Write the merged document back under a precondition: an `If-Match: <etag>`
 *      PUT on the http transport, or the contents API's sha check on git hosts.
 *   4. On a precondition failure (412/409 on http; the git API's own conflict
 *      error) re-read and retry — another machine published between our read
 *      and write, and their sections must survive our write.
 *
 * So the answer to "two machines publish at once" is: both succeed, the remote
 * ends up with BOTH sections, and neither machine's entries erase the other's.
 * Retries are bounded (`PUBLISH_ATTEMPTS`); exhaustion reports the conflict
 * instead of clobbering.
 *
 * `options.force` keeps its old meaning on git hosts (ignore the unchanged
 * check); on http there is no history to force.
 */
export const PUBLISH_ATTEMPTS = 3

export async function syncPublish({ snapshot, state = readState(), options = {}, now = Date.now() }) {
  const transport = resolveTransport(state)
  if (transport.error !== undefined) return { ok: false, error: transport.error }
  if (typeof state.token !== 'string' || state.token.length === 0) {
    return { ok: false, error: '还没有配置写入用的 token' }
  }
  const machineId = state.machineId
  const manifest = buildManifest(snapshot, {
    annotations: state.annotations,
    now,
    repoUrl: state.repoUrl,
    repo: transport.kind === 'http' ? transport.url : repoSlug(transport.parsed),
    ref: state.ref,
    repoUrl: state.repoUrl,
  })

  let result = null
  let lastConflict = null
  for (let attempt = 1; attempt <= PUBLISH_ATTEMPTS; attempt += 1) {
    // (1) Read the current remote document. A 404/empty remote is a normal
    // first publish: the fleet starts from just this machine.
    const current = await fetchFleet(state, { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs })
    if (current.error !== undefined) {
      // A hard read failure (bad token, unreachable host) must not be worked
      // around by blind-writing over a document we could not see.
      return { ok: false, error: `发布前读取远端失败：${current.error}` }
    }
    // (2) Merge our section into everyone else's. An empty remote starts a
    // fresh fleet; a v1 base is taken over (its content was this machine's
    // old view) so the legacy section does not linger as a ghost.
    const baseFleet = current.empty === true
      ? { fleetVersion: 2, generatedAt: 0, machines: {} }
      : current.fleet
    const merged = mergeFleetDocument(baseFleet, machineId, manifest)
    if (merged === null) {
      return { ok: false, error: `舰队清单已满（最多 ${32} 台机器），无法再加入新的机器分节` }
    }

    // (3) Conditional write.
    result = transport.kind === 'http'
      ? await publishHttp({
          url: transport.url,
          token: state.token,
          manifest: merged,
          etag: current.etag ?? null,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
        })
      : await publishManifest({
          owner: transport.parsed.owner,
          repo: transport.parsed.repo,
          path: transport.parsed.path ?? state.path,
          ref: state.ref,
          token: state.token,
          manifest: merged,
          force: options.force === true,
          host: transport.parsed.host,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
        })

    if (result.ok === true) {
      result = {
        ...result,
        machineId,
        fleetMachines: machineCount(merged),
        fleetIds: machineIds(merged),
        generatedAt: manifest.generatedAt,
        // v1 → v2 migration is a content change even when this machine's own
        // view was already published: say so once instead of calling it noise.
        migrated: result.unchanged !== true && current.legacy === true,
      }
      // (3b) Verify the write actually landed with our section — the cheap
      // stand-in for a real CAS on endpoints that ignore If-Match. On git
      // hosts the contents API rejects a stale sha server-side, so no
      // verification pass is needed there.
      if (transport.kind === 'http' && result.unchanged !== true) {
        const verify = await fetchFleet(state, { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs })
        const landed = verify.error === undefined
          && verify.legacy !== true
          && machineIds(verify.fleet).includes(machineId)
        if (!landed) {
          // Someone else's write won, or the endpoint drops content: re-read
          // (their document) and re-merge, bounded by the attempt loop.
          if (attempt === PUBLISH_ATTEMPTS) {
            return { ok: false, conflict: true, error: '发布冲突：写入后校验发现内容被覆盖，且重试次数已用完，请稍后再试', report: result.report }
          }
          lastConflict = result
          result = null
          continue
        }
      }
      break
    }
    if (result.conflict === true) {
      // (4) Someone wrote between our read and our write. Re-read (their
      // document) and re-merge; our section lands on top of their state.
      lastConflict = result
      continue
    }
    // A non-conflict failure is terminal: auth, network, repository shape.
    return result
  }

  if (result === null || result.ok !== true) {
    const detail = lastConflict?.error ?? '未知冲突'
    return { ok: false, conflict: true, error: `发布冲突：重试 ${PUBLISH_ATTEMPTS} 次后仍失败（${detail}），请稍后再试`, report: lastConflict?.report }
  }

  // An unchanged publish wrote nothing, so it is not a push: bumping
  // `lastPushAt` there would make the panel claim a commit that never
  // happened, and hide the real age of the last one.
  if (result.unchanged !== true) writeState({ lastPushAt: now })
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
  // `options.now` mirrors `syncStatus`: an injected clock keeps the recorded
  // pull time deterministic instead of a hidden `Date.now()` here.
  const keys = Array.isArray(selection) ? selection.filter((k) => typeof k === 'string') : []
  if (keys.length === 0) return { ok: false, error: '没有选中任何项', results: [] }

  const transport = resolveTransport(state)
  if (transport.error !== undefined) return { ok: false, error: transport.error, results: [] }

  const fetched = await fetchFleet(state, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  })
  if (fetched.error !== undefined) return { ok: false, error: fetched.error, results: [] }

  const capabilities = options.capabilities ?? probeCapabilities(options)
  const rows = diffManifest(fetched.manifest, snapshot, { capabilities })
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
    repoUrl: fetched.manifest.repoUrl,
    gitBin: options.gitBin,
  })
  if (applied.ok === true) {
    const now = typeof options.now === 'function'
      ? options.now()
      : Number.isFinite(options.now) ? options.now : Date.now()
    writeState({ lastPullAt: now })
  }

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
