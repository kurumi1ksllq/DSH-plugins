/**
 * Three-way diff between a manifest (what should exist) and a snapshot (what
 * does exist on this machine).
 *
 * The status a target machine reports is the whole point of this module, and
 * getting it wrong is worse than having no panel at all:
 *
 *   current       Present and matching. Nothing to do.
 *   missing       Absent, but installable here. This is the only status that
 *                 offers an install action.
 *   blocked       Absent and NOT installable here — wrong platform, or a
 *                 required external tool is unavailable. A server without a GPU
 *                 must report the ASR skill as `blocked`, not `missing`; telling
 *                 the user to "install it" would be advice that cannot work.
 *   outdated      Present but a different version than the manifest names.
 *   disabled      Present but switched off. Not an error, and not a sync
 *                 action either — the user turned it off on purpose.
 *   local-only    Present here, absent from the manifest. Reported so the
 *                 user can publish it, never deleted automatically.
 *
 * `self` entries are always `skip`: the sync capability cannot install itself
 * from a manifest it is reading.
 */

import { execFileSync } from 'node:child_process'

import { entryKey, platformFits } from './manifest.js'

export const STATUSES = ['current', 'outdated', 'missing', 'blocked', 'disabled', 'local-only', 'skip']

/**
 * Which external capabilities this host actually has.
 *
 * Probed, not assumed: `requires: ['officecli']` must resolve against the real
 * PATH, otherwise the panel would claim a capability is installable when the
 * command it depends on does not exist.
 */
export function probeCapabilities(options = {}) {
  const platform = options.platform ?? process.platform
  const hasCommand = options.hasCommand ?? defaultHasCommand
  const gpu = options.gpu ?? true
  return { platform, hasCommand, gpu }
}

function defaultHasCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return false
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    execFileSync(probe, [command], { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve whether an entry can be installed here.
 *
 * Returns `{ ok, reason }`. `reason` is the user-facing explanation shown next
 * to a blocked row, so it names the missing thing concretely.
 */
export function checkEligibility(entry, capabilities) {
  if (entry.self === true) {
    return { ok: false, reason: '同步插件自身，不在同步范围内' }
  }
  if (!platformFits(entry.platform, capabilities.platform)) {
    return { ok: false, reason: `仅支持 ${entry.platform}，本机是 ${capabilities.platform}` }
  }
  for (const requirement of entry.requires ?? []) {
    if (requirement === 'gpu') {
      if (capabilities.gpu !== true) return { ok: false, reason: '需要 GPU，本机没有' }
      continue
    }
    if (capabilities.hasCommand(requirement) !== true) {
      return { ok: false, reason: `缺少依赖命令 ${requirement}` }
    }
  }
  return { ok: true, reason: null }
}

/**
 * Compare a manifest against a snapshot.
 *
 * `snapshot` may be null (nothing installed yet, or the profile could not be
 * read) — every manifest entry is then `missing` or `blocked`, which is the
 * correct answer for a fresh install.
 */
export function diffManifest(manifest, snapshot, options = {}) {
  const capabilities = options.capabilities ?? probeCapabilities(options)
  const rows = []

  const installedPlugins = new Map()
  for (const pkg of snapshot?.packages ?? []) {
    if (typeof pkg?.name === 'string') installedPlugins.set(pkg.name, pkg)
  }
  const installedMcp = new Map()
  for (const server of snapshot?.mcp ?? []) {
    if (typeof server?.server === 'string') installedMcp.set(server.server, server)
  }
  const installedSkills = new Map()
  for (const skill of snapshot?.skills ?? []) {
    if (typeof skill?.name === 'string') installedSkills.set(skill.name, skill)
  }

  const seen = new Set()

  for (const entry of manifestEntries(manifest)) {
    const key = entryKey(entry)
    seen.add(key)
    const eligibility = checkEligibility(entry, capabilities)
    const present = lookupInstalled(entry, { installedPlugins, installedMcp, installedSkills })

    if (present === null) {
      rows.push({
        ...row(entry, key),
        status: entry.self === true ? 'skip' : eligibility.ok ? 'missing' : 'blocked',
        reason: eligibility.reason,
      })
      continue
    }

    if (present.enabled === false || present.disabled === true) {
      rows.push({ ...row(entry, key), status: 'disabled', reason: '已安装但被关闭' })
      continue
    }

    if (typeof entry.version === 'string' && typeof present.version === 'string' && entry.version !== present.version) {
      rows.push({
        ...row(entry, key),
        status: 'outdated',
        reason: `本机 ${present.version}，清单 ${entry.version}`,
      })
      continue
    }

    rows.push({ ...row(entry, key), status: 'current', reason: null })
  }

  // Present here, absent from the manifest. Never auto-removed: the manifest
  // is what one machine chose to publish, not a whitelist of what may exist.
  for (const [name, pkg] of installedPlugins) {
    if (name.startsWith('@deepseek-ai/')) continue
    const key = `plugin:${name}`
    if (seen.has(key)) continue
    rows.push({
      kind: 'plugin',
      name,
      key,
      version: typeof pkg.version === 'string' ? pkg.version : undefined,
      source: 'local',
      platform: 'any',
      requires: [],
      self: false,
      status: 'local-only',
      reason: '本机有，清单没有',
    })
  }

  for (const [name, skill] of installedSkills) {
    const key = `skill:${name}`
    if (seen.has(key)) continue
    // A disabled stub is a tombstone the manifest deliberately skips, so
    // calling it local-only would invite the user to publish something that
    // buildManifest would drop again. Name it for what it is.
    const isStub = skill.disabled === true || skill.modelInvocable === false
    rows.push({
      kind: 'skill',
      name,
      key,
      platform: 'any',
      requires: [],
      self: false,
      status: isStub ? 'disabled' : 'local-only',
      reason: isStub ? '已停用的桩，不会发布' : '本机有，清单没有',
    })
  }

  return rows.sort(sortRows)
}

function manifestEntries(manifest) {
  return [...(manifest?.plugins ?? []), ...(manifest?.mcp ?? []), ...(manifest?.skills ?? [])]
}

function lookupInstalled(entry, maps) {
  if (entry.kind === 'plugin') return maps.installedPlugins.get(entry.name) ?? null
  if (entry.kind === 'mcp') return maps.installedMcp.get(entry.name) ?? null
  if (entry.kind === 'skill') return maps.installedSkills.get(entry.name) ?? null
  return null
}

function row(entry, key) {
  return {
    kind: entry.kind,
    name: entry.name,
    key,
    version: entry.version,
    source: entry.source,
    platform: entry.platform,
    requires: entry.requires ?? [],
    self: entry.self === true,
  }
}

/** Actionable first, then present, then informational. */
const STATUS_ORDER = { missing: 0, outdated: 1, blocked: 2, disabled: 3, current: 4, 'local-only': 5, skip: 6 }
const KIND_ORDER = { plugin: 0, mcp: 1, skill: 2 }

function sortRows(a, b) {
  const byStatus = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
  if (byStatus !== 0) return byStatus
  const byKind = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99)
  if (byKind !== 0) return byKind
  return a.name.localeCompare(b.name)
}

/** Counts per status, for the panel header. */
export function summarizeDiff(rows) {
  const counts = {}
  for (const status of STATUSES) counts[status] = 0
  for (const item of rows) {
    counts[item.status] = (counts[item.status] ?? 0) + 1
  }
  counts.total = rows.length
  counts.actionable = counts.missing + counts.outdated
  return counts
}

/** The rows an install pass may touch: only the ones the user selected. */
export function selectableRows(rows) {
  return rows.filter((item) => item.status === 'missing' || item.status === 'outdated')
}
