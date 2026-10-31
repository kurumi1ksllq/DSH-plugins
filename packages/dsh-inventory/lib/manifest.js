/**
 * Cross-machine capability manifest.
 *
 * The inventory answers "what does THIS machine have". A manifest answers "what
 * SHOULD a machine have" — so another DSH install can read it and decide, item
 * by item, what to install. The two are deliberately different documents:
 * a snapshot is evidence, a manifest is intent.
 *
 * Every entry carries the facts a *target* machine needs in order to decide
 * without guessing:
 *
 *   platform   'any' | 'win32' | 'linux' | 'darwin'
 *              The item is only installable on these hosts.
 *   requires   External capabilities the item needs at runtime
 *              (`officecli`, `gpu`, `vmware-workstation`, ...). A target that
 *              lacks one reports `blocked`, never `missing` — the item is not
 *              absent by accident, it is absent by design.
 *   self       The item is the sync plugin itself. Every target skips it
 *              rather than depending on a name hardcoded in defaults.
 *
 * The manifest never carries secrets. `redact.js` owns that.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MANIFEST_VERSION = 1
export const MANIFEST_FILE = 'dsh-manifest.json'

const PLATFORMS = new Set(['any', 'win32', 'linux', 'darwin'])

/** Normalise a platform value; anything unrecognised becomes 'any'. */
export function normalizePlatform(value) {
  if (typeof value !== 'string') return 'any'
  const text = value.trim().toLowerCase()
  if (text === 'windows') return 'win32'
  if (text === 'mac' || text === 'macos' || text === 'osx') return 'darwin'
  if (text === 'unix' || text === 'posix') return 'any'
  return PLATFORMS.has(text) ? text : 'any'
}

/** True when `item` can be installed on `platform` ('any' always can). */
export function platformFits(itemPlatform, platform) {
  const want = normalizePlatform(itemPlatform)
  if (want === 'any') return true
  return want === normalizePlatform(platform)
}

/**
 * Split a package spec into a portable source descriptor.
 *
 * Local `link:` specs embed an absolute path that is meaningless on another
 * machine. They become `repo`, meaning "install from the plugin repository this
 * manifest came from" — the target resolves it against its own clone.
 */
export function describeSource(spec) {
  if (typeof spec !== 'string' || spec.length === 0) return { source: 'unknown' }
  const text = spec.trim()
  if (text.startsWith('link:') || text.startsWith('file:')) return { source: 'repo' }
  if (/^(?:https?|git|git\+https|git\+ssh|ssh):/.test(text) || text.startsWith('github:')) {
    return { source: 'git', spec: text }
  }
  if (/^(?:workspace|npm):/.test(text)) return { source: 'npm', spec: text.replace(/^(?:workspace|npm):/, '') }
  return { source: 'npm', spec: text }
}

/**
 * Build the manifest from an inventory snapshot.
 *
 * `snapshot` is the object `getSnapshot()` returns; `options.annotations` is a
 * map of item key → { platform, requires, self } supplied by the caller (the
 * knowledge of what needs what cannot be derived from a filesystem).
 */
export function buildManifest(snapshot, options = {}) {
  const annotations = options.annotations ?? {}
  const now = options.now ?? Date.now()
  const repo = typeof options.repo === 'string' ? options.repo : ''
  const ref = typeof options.ref === 'string' ? options.ref : 'main'

  const plugins = []
  for (const pkg of snapshot?.packages ?? []) {
    const name = typeof pkg?.name === 'string' ? pkg.name : null
    if (name === null) continue
    // Official bundles are part of dsh itself, not something to replicate.
    if (name.startsWith('@deepseek-ai/')) continue
    const note = annotationFor(annotations, 'plugin', name)
    plugins.push({
      kind: 'plugin',
      name,
      version: typeof pkg.version === 'string' ? pkg.version : undefined,
      ...describeSource(pkg.spec),
      platform: normalizePlatform(note.platform),
      ...(Array.isArray(note.requires) && note.requires.length > 0 ? { requires: [...note.requires] } : {}),
      ...(note.self === true ? { self: true } : {}),
    })
  }

  const mcp = []
  for (const server of snapshot?.mcp ?? []) {
    const name = typeof server.server === 'string' ? server.server : null
    if (name === null) continue
    const note = annotationFor(annotations, 'mcp', name)
    mcp.push({
      kind: 'mcp',
      name,
      transport: server.transport,
      platform: normalizePlatform(note.platform),
      ...(Array.isArray(note.requires) && note.requires.length > 0 ? { requires: [...note.requires] } : {}),
      ...(note.self === true ? { self: true } : {}),
    })
  }

  const skills = []
  for (const skill of snapshot?.skills ?? []) {
    const name = typeof skill.name === 'string' ? skill.name : null
    if (name === null) continue
    // A disabled stub is a tombstone, not a capability to replicate.
    if (skill.disabled === true || skill.modelInvocable === false) continue
    const note = annotationFor(annotations, 'skill', name)
    skills.push({
      kind: 'skill',
      name,
      platform: normalizePlatform(note.platform),
      ...(Array.isArray(note.requires) && note.requires.length > 0 ? { requires: [...note.requires] } : {}),
      ...(note.self === true ? { self: true } : {}),
    })
  }

  return {
    manifestVersion: MANIFEST_VERSION,
    generatedAt: now,
    repo,
    ref,
    plugins: plugins.sort(byName),
    mcp: mcp.sort(byName),
    skills: skills.sort(byName),
  }
}

/**
 * Annotation lookup accepts both `kind:name` and the bare name.
 *
 * Hand-written manifests and the panel's own output disagreed on this: a
 * `platform: 'win32'` written as `dsh-git-bash-tool` silently vanished when the
 * lookup only tried `plugin:...`, which made a Windows-only plugin look portable
 * and offer itself to the Linux server. Accepting both is cheaper than a rule
 * nobody remembers.
 */
function annotationFor(annotations, kind, name) {
  const table = annotations !== null && typeof annotations === 'object' ? annotations : {}
  return table[`${kind}:${name}`] ?? table[name] ?? {}
}

function byName(a, b) {
  return a.name.localeCompare(b.name)
}

/**
 * Parse a manifest read from disk or the network.
 *
 * Returns `{ manifest }` on success or `{ error }` describing why it is
 * unusable — a target machine must be able to say "the repository has no
 * manifest" instead of failing with a stack trace.
 */
export function parseManifest(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { error: `manifest 不是合法 JSON：${error?.message ?? error}` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'manifest 顶层必须是对象' }
  }
  if (raw.manifestVersion !== MANIFEST_VERSION) {
    return { error: `manifest 版本不受支持：${raw.manifestVersion}（需要 ${MANIFEST_VERSION}）` }
  }
  const list = (value) => (Array.isArray(value) ? value.filter((row) => row && typeof row.name === 'string') : [])
  return {
    manifest: {
      manifestVersion: MANIFEST_VERSION,
      generatedAt: typeof raw.generatedAt === 'number' ? raw.generatedAt : 0,
      repo: typeof raw.repo === 'string' ? raw.repo : '',
      ref: typeof raw.ref === 'string' ? raw.ref : 'main',
      plugins: list(raw.plugins).map(normalizeEntry),
      mcp: list(raw.mcp).map(normalizeEntry),
      skills: list(raw.skills).map(normalizeEntry),
    },
  }
}

function normalizeEntry(row) {
  return {
    kind: typeof row.kind === 'string' ? row.kind : 'unknown',
    name: row.name,
    version: typeof row.version === 'string' ? row.version : undefined,
    source: typeof row.source === 'string' ? row.source : 'unknown',
    spec: typeof row.spec === 'string' ? row.spec : undefined,
    platform: normalizePlatform(row.platform),
    requires: Array.isArray(row.requires) ? row.requires.filter((r) => typeof r === 'string') : [],
    self: row.self === true,
  }
}

/** Every entry in a manifest, across all four kinds. */
export function entriesOf(manifest) {
  return [
    ...(manifest?.plugins ?? []),
    ...(manifest?.mcp ?? []),
    ...(manifest?.skills ?? []),
  ]
}

/** Stable identity for one entry: kind plus name. */
export function entryKey(entry) {
  return `${entry.kind}:${entry.name}`
}

/** Read a manifest from a profile directory, or null when there is none. */
export function readManifestFile(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return null
  const path = join(dir, MANIFEST_FILE)
  if (!existsSync(path)) return null
  try {
    return parseManifest(readFileSync(path, 'utf8')).manifest ?? null
  } catch {
    return null
  }
}
