/**
 * Fleet manifest: several machines publishing into one document.
 *
 * The v1 manifest answers "what should a machine have" from ONE publisher. A
 * fleet publishes from several machines at once, and a whole-file overwrite
 * means the last writer silently erases everyone else's entries. The v2
 * document fixes the granularity instead of the symptom:
 *
 *   { fleetVersion: 2, generatedAt, machines: { "<machineId>": <v1 manifest> } }
 *
 * Each publisher owns exactly its section and never touches the others, so two
 * machines publishing concurrently compose instead of race — the loser of a
 * write re-reads, re-applies its section onto the winner's document, and
 * retries. Readers flatten the sections into one v1 view so the diff/apply
 * pipeline is unchanged.
 *
 * A stored v1 document (no `fleetVersion`, no `machines`) is a valid fleet with
 * one anonymous machine (`LEGACY_ID`): old files keep working, old readers
 * reading a v2 file via the v1 parser keep working at one machine's fidelity.
 */

export const FLEET_VERSION = 2

/** Section name for a pre-fleet v1 document, and the default when no id exists. */
export const LEGACY_ID = 'default'

/** Highest machine sections a single document carries. */
export const MAX_MACHINES = 32

/**
 * Stable identity for this machine's section.
 *
 * Deliberately NOT derived from the hostname: containers rename, and two
 * machines with the same image name would fight over one section. The caller
 * passes an id it persists (the sync state keeps one); an empty id falls back
 * to the legacy section so a misconfigured publisher cannot create garbage
 * sections — it degrades to exactly the old single-machine behaviour.
 */
export function normalizeMachineId(value) {
  if (typeof value !== 'string') return LEGACY_ID
  const id = value.trim().toLowerCase()
  // `machines` is a JSON object: a `__proto__` key would be an attacker-flavored
  // prototype pollution vector once parsed back. Refuse to publish it.
  if (id.length === 0 || id === '__proto__' || id === 'constructor' || id === 'prototype') return LEGACY_ID
  return id.slice(0, 64)
}

/** Wrap a v1 manifest as this machine's section of a fresh v2 document. */
export function buildFleetDocument(manifest, machineId) {
  const id = normalizeMachineId(machineId)
  return {
    fleetVersion: FLEET_VERSION,
    generatedAt: typeof manifest?.generatedAt === 'number' ? manifest.generatedAt : 0,
    machines: {
      [id]: manifest,
    },
  }
}

function safeObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

/** Package/prototype-pollution guard for a machine section id read off the wire. */
function isSafeSectionId(id) {
  return id !== '__proto__' && id !== 'constructor' && id !== 'prototype'
}

/**
 * Parse a remote document of either version.
 *
 * Returns `{ ok: true, fleet, machines }` where `machines` maps section id to
 * the raw section object, or `{ ok: false, error }` when the text is not a
 * usable JSON document at all. Sections that are not objects (a truncated
 * write, a hand edit) are dropped rather than failing the whole fleet — one
 * bad machine must not blind the others.
 */
export function parseFleetDocument(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `清单不是合法 JSON：${error?.message ?? error}` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '清单顶层必须是对象' }
  }
  if (raw.fleetVersion === FLEET_VERSION) {
    const machines = {}
    for (const [id, section] of Object.entries(safeObject(raw.machines))) {
      if (section === null || typeof section !== 'object' || Array.isArray(section)) continue
      machines[id] = section
    }
    if (Object.keys(machines).length === 0) {
      return { ok: false, error: '舰队清单里没有任何机器分节' }
    }
    return {
      ok: true,
      legacy: false,
      fleet: {
        fleetVersion: FLEET_VERSION,
        legacy: false,
        generatedAt: typeof raw.generatedAt === 'number' ? raw.generatedAt : 0,
        machines,
      },
      machines,
    }
  }
  // No fleet marker: a v1 document — or anything older. Treat it as one
  // machine's section so existing repositories keep working untouched.
  // `legacy` tells the publisher this section was synthesized from the
  // whole-file format: when a machine publishes, it takes that content over
  // into its own section (the v1 file was by definition one machine's view),
  // instead of leaving a stale ghost section behind forever.
  return {
    ok: true,
    legacy: true,
    fleet: {
      fleetVersion: FLEET_VERSION,
      legacy: true,
      generatedAt: typeof raw.generatedAt === 'number' ? raw.generatedAt : 0,
      machines: { [LEGACY_ID]: raw },
    },
    machines: { [LEGACY_ID]: raw },
  }
}

/**
 * Merge this machine's section into an existing fleet document.
 *
 * Pure function: `baseFleet` is never mutated. Sections other than ours pass
 * through untouched — that is the whole point of the split. Returns the
 * complete v2 document ready to serialize, or `null` when the fleet is full:
 * a runaway publisher must hit a hard stop, not silently evict the others.
 */
export function mergeFleetDocument(baseFleet, machineId, manifest) {
  const id = normalizeMachineId(machineId)
  const existing = safeObject(baseFleet?.machines)
  // A v1 base carries exactly one synthesized `default` section: the whole old
  // file. The publishing machine is taking that file over (it is about to
  // replace the content with its own fresh snapshot), so the legacy section is
  // absorbed into the machine's own section rather than kept — keeping it
  // would resurrect entries the machine just deleted, forever.
  const absorbLegacy = baseFleet?.legacy === true
  const others = Object.keys(existing).filter((key) => key !== id && !(absorbLegacy && key === LEGACY_ID))
  if (others.length >= MAX_MACHINES) return null
  const machines = {}
  for (const key of others.sort()) machines[key] = existing[key]
  machines[id] = manifest
  return {
    fleetVersion: FLEET_VERSION,
    generatedAt: Date.now(),
    machines,
  }
}

/**
 * Flatten a fleet document into one v1 manifest for the diff/apply pipeline.
 *
 * Sections are unioned by entry key; a key present in several sections resolves
 * deterministically — the section whose own `generatedAt` is newest wins, ties
 * broken by section id — so every reader converges on the same view no matter
 * the iteration order. The flattened header takes the newest section's facts.
 */
export function flattenFleet(fleet) {
  // Publishing refuses to mint a `__proto__` section (see normalizeMachineId),
  // so reading must refuse one too: a hostile document must not get further
  // through the reader than it could through the writer. `Object.entries`
  // would surface it as an ordinary key, so filter it here explicitly.
  const sections = Object.entries(safeObject(fleet?.machines)).filter(([id]) => isSafeSectionId(id))
  if (sections.length === 0) return null
  const ordered = sections.sort(([aId, a], [bId, b]) => {
    const at = typeof a?.generatedAt === 'number' ? a.generatedAt : 0
    const bt = typeof b?.generatedAt === 'number' ? b.generatedAt : 0
    if (bt !== at) return bt - at
    return aId.localeCompare(bId)
  })
  const newest = ordered[0][1]
  const flattened = {
    manifestVersion: 1,
    generatedAt: typeof newest?.generatedAt === 'number' ? newest.generatedAt : 0,
    repo: typeof newest?.repo === 'string' ? newest.repo : '',
    ref: typeof newest?.ref === 'string' && newest.ref.length > 0 ? newest.ref : 'main',
    repoUrl: typeof newest?.repoUrl === 'string' ? newest.repoUrl : '',
    plugins: [],
    mcp: [],
    skills: [],
  }
  const winners = new Map()
  for (const [id, section] of ordered) {
    for (const kind of ['plugins', 'mcp', 'skills']) {
      const list = Array.isArray(section?.[kind]) ? section[kind] : []
      for (const entry of list) {
        if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') continue
        const key = `${entry.kind ?? 'unknown'}:${entry.name}`
        if (!winners.has(key)) winners.set(key, { entry, kind, from: id })
      }
    }
  }
  for (const { entry, kind } of winners.values()) {
    const list = Array.isArray(entry.kind) ? null : flattened[kind]
    if (list === null) continue
    list.push(entry)
  }
  for (const kind of ['plugins', 'mcp', 'skills']) flattened[kind].sort(byName)
  return flattened
}

function byName(a, b) {
  return String(a.name).localeCompare(String(b.name))
}

/** Count the machine sections in a fleet document. */
export function machineCount(fleet) {
  return Object.keys(safeObject(fleet?.machines)).length
}

/** Section ids in a fleet document, sorted. */
export function machineIds(fleet) {
  return Object.keys(safeObject(fleet?.machines)).sort()
}

/** True when `id` has its own section in `fleet`. */
export function fleetHasMachine(fleet, machineId) {
  return Object.prototype.hasOwnProperty.call(safeObject(fleet?.machines), normalizeMachineId(machineId))
}
