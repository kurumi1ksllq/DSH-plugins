/**
 * Remote manifest parsing and the installed-vs-wanted comparison.
 *
 * Both are pure functions over plain data: no filesystem, no network, no
 * process. That is what makes the interesting half of this plugin testable.
 */
import { MANIFEST_NAME } from './config.js'

export { MANIFEST_NAME }

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Parse and validate a remote manifest. Returns { plugins, problems }. */
export function parseManifest(raw) {
  const problems = []
  if (!isObject(raw)) return { plugins: [], problems: ['manifest is not an object'] }
  if (!Array.isArray(raw.plugins)) return { plugins: [], problems: ['manifest.plugins is not an array'] }

  const plugins = []
  for (const [index, entry] of raw.plugins.entries()) {
    if (!isObject(entry)) {
      problems.push(`plugins[${index}]: not an object`)
      continue
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      problems.push(`plugins[${index}]: missing name`)
      continue
    }
    if (typeof entry.version !== 'string' || entry.version.length === 0) {
      problems.push(`${entry.name}: missing version`)
      continue
    }
    plugins.push({
      name: entry.name,
      version: entry.version,
      spec: typeof entry.spec === 'string' ? entry.spec : undefined,
      repo: typeof entry.repo === 'string' ? entry.repo : undefined,
      optional: entry.optional === true,
    })
  }
  return { plugins, problems }
}

/**
 * Compare installed against the manifest.
 *
 * States, per plugin:
 *   missing   in the manifest, absent locally
 *   outdated  installed, version differs from the manifest
 *   current   installed at the manifest version
 *   extra     installed locally, absent from the manifest — reported only,
 *             never removed: the local profile may add plugins the shared
 *             manifest does not know about.
 *
 * Built-in `@deepseek-ai/*` packages are never reported as extra; they ship
 * with the app, not with this repository.
 */
export function diff(installed, wanted, options = {}) {
  const exclude = new Set(Array.isArray(options.exclude) ? options.exclude : [])
  const installedByName = new Map(installed.map((pkg) => [pkg.name, pkg]))
  const wantedByName = new Map(wanted.map((pkg) => [pkg.name, pkg]))

  const actions = []
  for (const want of wanted) {
    const have = installedByName.get(want.name)
    const excluded = exclude.has(want.name)
    if (have === undefined || !have.present) {
      actions.push({
        name: want.name,
        state: 'missing',
        wanted: want.version,
        installed: undefined,
        excluded,
        ...(want.spec === undefined ? {} : { spec: want.spec }),
      })
      continue
    }
    const state = have.version === want.version ? 'current' : 'outdated'
    actions.push({ name: want.name, state, wanted: want.version, installed: have.version, excluded })
  }

  const extras = []
  for (const have of installed) {
    if (wantedByName.has(have.name)) continue
    if (have.builtin) continue
    extras.push({ name: have.name, state: 'extra', installed: have.version })
  }

  const pending = actions.filter((a) => a.state === 'missing' || a.state === 'outdated')
  return {
    actions,
    extras,
    pending,
    /** Only the subset apply mode is allowed to touch. */
    applicable: pending.filter((a) => !a.excluded),
  }
}

/** Render the reconciliation as the short text a boot log can carry. */
export function summarize(state) {
  if (!state.ok) return `plugin-sync: skipped (${state.reason})`
  if (state.pending.length === 0) return `plugin-sync: up to date (${state.actions.length} plugins)`
  const missing = state.pending.filter((a) => a.state === 'missing').length
  const outdated = state.pending.filter((a) => a.state === 'outdated').length
  const parts = []
  if (missing > 0) parts.push(`${missing} missing`)
  if (outdated > 0) parts.push(`${outdated} outdated`)
  const tail = state.applied.length > 0 ? `, ${state.applied.length} applied` : ''
  return `plugin-sync: ${parts.join(', ')}${tail}`
}
