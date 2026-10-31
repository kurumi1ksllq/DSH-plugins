/**
 * Read installed plugin facts straight off a DSH profile.
 *
 * Deliberately independent of dsh-inventory: this plugin must work even when
 * the inventory bundle is absent, and it only needs version + spec, not the
 * live loader rows.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILTIN_SCOPE = '@deepseek-ai/'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * `file:///C:/x` or `file:///opt/x` -> a plain filesystem path.
 *
 * Uses `fileURLToPath` rather than decoding `url.pathname`: on Windows the
 * pathname keeps a `/C:/...` prefix that `join()` would then treat as relative,
 * and percent-encoded characters would stay encoded.
 */
export function baseUrlToDir(baseUrl) {
  if (typeof baseUrl !== 'string' && !(baseUrl instanceof URL)) return null
  if (typeof baseUrl === 'string' && baseUrl.length === 0) return null
  try {
    const url = baseUrl instanceof URL ? baseUrl : new URL(baseUrl)
    if (url.protocol !== 'file:') return null
    return fileURLToPath(url)
  } catch {
    return null
  }
}

/**
 * The profile directory this process is booting.
 *
 * Same precedence the inventory plugin uses: the composed profile's own baseUrl
 * first (it points at the profile root), then DSH_PROFILE_DIR, then the desktop
 * profile under DSH_HOME. Returns null when nothing resolves to a real profile.
 */
export function resolveProfileDir(ctx, env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME.length > 0 ? resolve(env.DSH_HOME) : join(homedir(), '.dsh')
  const candidates = [baseUrlToDir(ctx?.baseUrl), env.DSH_PROFILE_DIR, join(home, 'profiles', 'desktop')]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0 && existsSync(join(candidate, 'package.json'))) return candidate
  }
  return null
}

/**
 * Installed plugin facts: every dependency and every declared bundle, with the
 * version pnpm actually put in node_modules.
 */
export function readInstalled(profileDir) {
  if (typeof profileDir !== 'string' || profileDir.length === 0) return []
  const profile = readJson(join(profileDir, 'package.json'))
  if (profile === null) return []
  const dependencies = isObject(profile.dependencies) ? profile.dependencies : {}
  const bundles = Array.isArray(profile?.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : []
  const names = new Set([...Object.keys(dependencies), ...bundles.filter((b) => typeof b === 'string')])

  const installed = []
  for (const pkgName of names) {
    const manifest = readJson(join(profileDir, 'node_modules', pkgName, 'package.json'))
    const spec = dependencies[pkgName]
    installed.push({
      name: pkgName,
      version: typeof manifest?.version === 'string' ? manifest.version : undefined,
      spec,
      linked: typeof spec === 'string' && spec.startsWith('link:'),
      present: manifest !== null,
      builtin: pkgName.startsWith(BUILTIN_SCOPE),
    })
  }
  return installed.sort((a, b) => a.name.localeCompare(b.name))
}
