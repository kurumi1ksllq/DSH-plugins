/**
 * Config surface for dsh-plugin-sync.
 *
 * Kept in its own module so the test suite can exercise config merging without
 * loading the plugin (which reaches for `ctx.webServer`).
 */

/** Manifest file expected at the root of the target repository. */
export const MANIFEST_NAME = 'dsh-plugins.json'

export const DEFAULTS = {
  /** Target git repository URL. Empty disables the plugin entirely. */
  repo: '',
  /** Branch or tag to read. */
  ref: 'main',
  /** 'remote' = the manifest wins; 'local' = never write, only report. */
  direction: 'remote',
  /** Actually install/update. false = report only. */
  apply: false,
  /** Milliseconds to wait for git before giving up. */
  gitTimeoutMs: 30000,
  /** Skip the check entirely on boot (still reachable via the check route). */
  skipBoot: false,
  /** Plugin names never written by this plugin, even in apply mode. */
  exclude: ['dsh-plugin-sync'],
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Merge caller config over DEFAULTS, dropping undefined and unknown keys. */
export function mergeConfig(raw) {
  const merged = { ...DEFAULTS }
  if (!isObject(raw)) return merged
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || !(key in DEFAULTS)) continue
    if (key === 'exclude') {
      merged.exclude = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : DEFAULTS.exclude
      continue
    }
    merged[key] = value
  }
  if (merged.direction !== 'local') merged.direction = 'remote'
  merged.gitTimeoutMs = Number.isFinite(merged.gitTimeoutMs) ? Math.max(1000, merged.gitTimeoutMs) : DEFAULTS.gitTimeoutMs
  return merged
}
