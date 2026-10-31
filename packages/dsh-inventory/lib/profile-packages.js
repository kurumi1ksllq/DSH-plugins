/**
 * Profile package inventory.
 *
 * A profile declares plugins two ways: `dependencies` (installed by pnpm) and
 * `dsh.profile.bundles` (composed into the loader tree). A bundle can be
 * built-in (`@deepseek-ai/*`, shipped inside the app) or missing from disk —
 * the latter is exactly the "declared but never installed" ghost this
 * inventory exists to surface.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILTIN_SCOPE = '@deepseek-ai/'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** The entry the loader would actually resolve for this package. */
function entryFile(pkg) {
  if (pkg === null || typeof pkg !== 'object') return null
  if (typeof pkg.main === 'string' && pkg.main.length > 0) return pkg.main
  const root = pkg.exports?.['.']
  if (typeof root === 'string') return root
  if (root !== null && typeof root === 'object' && typeof root.default === 'string') return root.default
  return 'index.js'
}

/** `@scope/pkg/sub/entry` -> `@scope/pkg`; `pkg/sub` -> `pkg`; a bare name stays. */
function packageBaseOf(name) {
  if (typeof name !== 'string' || name.length === 0) return null
  const parts = name.split('/')
  if (name.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : name
  return parts[0]
}

/** Record a phase, letting `active` win over any weaker observation. */
function notePhase(map, key, phase) {
  if (key === null || key === undefined || key.length === 0) return
  const current = map.get(key)
  if (current === undefined) {
    map.set(key, phase)
    return
  }
  if (phase === 'active') map.set(key, 'active')
}

/**
 * @param {string} profileDir - profile root containing package.json.
 * @param {Array<{name: string, fiberPhase: string|null}>} rows - live loader rows.
 * @returns {Array<object>} package facts sorted by name.
 */
export function collectPackages(profileDir, rows = []) {
  if (typeof profileDir !== 'string' || profileDir.length === 0) return []
  const profile = readJson(join(profileDir, 'package.json'))
  if (profile === null) return []

  const bundles = Array.isArray(profile?.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : []
  const dependencies = profile?.dependencies && typeof profile.dependencies === 'object' ? profile.dependencies : {}

  // A plugin package does not necessarily own a loader row named after itself:
  // bundles are composed, and their rows are named after the modules they
  // include (`dsh-doublecheck/grill`, `@deepseek-ai/dsh-llm`, ...). Resolving a
  // package by its own name alone reports running bundles as "not loaded".
  const phases = new Map()
  const subPhases = new Map()
  for (const row of rows) {
    if (!row || typeof row.name !== 'string') continue
    const phase = row.fiberPhase ?? null
    notePhase(phases, row.name, phase)
    const base = packageBaseOf(row.name)
    if (base !== null && base !== row.name) notePhase(subPhases, base, phase)
  }

  const declared = new Map()
  for (const [name, spec] of Object.entries(dependencies)) {
    declared.set(name, { spec, declaredBy: ['dependencies'] })
  }
  for (const name of bundles) {
    if (declared.has(name)) {
      if (!declared.get(name).declaredBy.includes('bundles')) declared.get(name).declaredBy.push('bundles')
      continue
    }
    declared.set(name, { spec: undefined, declaredBy: ['bundles'] })
  }

  const packages = []
  for (const [name, info] of declared) {
    const pkgRoot = join(profileDir, 'node_modules', name)
    const installedPkg = readJson(join(pkgRoot, 'package.json'))
    const builtin = name.startsWith(BUILTIN_SCOPE)
    const phase = phases.has(name) ? phases.get(name) : subPhases.get(name)
    // A directory with a package.json but no entry file does not resolve:
    // the loader reports the row with no fiber, which is a real failure the
    // inventory must not report as installed.
    const entry = entryFile(installedPkg)
    const hasEntry = entry !== null && existsSync(join(pkgRoot, entry))
    packages.push({
      name,
      version: typeof installedPkg?.version === 'string' ? installedPkg.version : undefined,
      spec: info.spec,
      declaredBy: info.declaredBy,
      installed: hasEntry || builtin,
      loaded: phase === 'active',
      // No row of its own or under its path: a bundle composed of other rows.
      // Not the same claim as "not loaded", so the panel must not imply that.
      rowless: phase === undefined,
      fiberPhase: phase ?? null,
      ...(installedPkg !== null && !hasEntry && !builtin ? { broken: `missing entry ${entry ?? '(unknown)'}` } : {}),
    })
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name))
}
