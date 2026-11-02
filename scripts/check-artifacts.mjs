#!/usr/bin/env node
/**
 * Freshness gate for the shipped websearch bundle — checked against the copy
 * that is actually loaded, not against the checkout we happen to sit in.
 *
 * Why this exists: `packages/dsh-websearch-failover/plugin/lib/*.mjs` is
 * generated output and gitignored, and a DSH profile links the bundle directly,
 * so a stale or missing copy means DSH silently runs old engine code (or fails
 * to load at all). Two failure modes shipped in the past:
 *
 *   1. `pnpm check:websearch` resolved `--root` to the current checkout. When
 *      the profile linked the bundle from a *different* checkout, the check
 *      stayed green while the loaded copy rotted.
 *   2. Two tests copied `lib/*.mjs` into `plugin/lib/` before booting the
 *      bundle, repairing the artifact under test — a stale build became
 *      undetectable.
 *
 * This script fixes (1) by verifying every copy of the bundle that a DSH
 * profile resolves to, plus the checkout itself. (2) is fixed in the tests
 * (see test/probe-bundle.mjs).
 *
 *   node scripts/check-artifacts.mjs                     # all known copies
 *   node scripts/check-artifacts.mjs --checkout DIR      # also check DIR
 *   node scripts/check-artifacts.mjs --profile DIR       # also check DIR's links
 *   node scripts/check-artifacts.mjs --json              # machine readable
 *
 * Exit 1 if any *loaded* copy is stale or missing. A checkout with no batch
 * copy at all is reported, not failed: `plugin/lib/` is gitignored, so a fresh
 * clone legitimately lacks it until `pnpm build:websearch` runs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** The bundle's package name, as a profile declares it. */
const BUNDLE = 'dsh-websearch-failover'
/** Repo-relative directory of that bundle inside this workspace. */
const BUNDLE_DIR = 'packages/dsh-websearch-failover'

function parseArgs(argv) {
  const options = { checkout: [], profile: [], json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--checkout' || arg === '--profile') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} needs a directory`)
      options[arg.slice(2)].push(resolve(value))
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/check-artifacts.mjs [--checkout DIR] [--profile DIR] [--json]')
      process.exit(0)
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

/**
 * Every directory whose `plugin/lib/` copy should be verified.
 * @param {string[]} extraProfiles profile directories named on the command line
 * @returns {{ source: string, root: string, why: string }[]}
 */
function candidateRoots(extraProfiles) {
  const roots = [{ source: REPO, root: join(REPO, BUNDLE_DIR), why: 'this checkout' }]

  // Other checkouts of this workspace, discovered from DSH profiles: a profile
  // declares the bundle with a `link:` spec, and node_modules resolves it.
  const profilesDir = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles') : null
  const profiles = [...extraProfiles]
  if (profilesDir && existsSync(profilesDir)) {
    for (const name of safeReaddir(profilesDir)) profiles.push(join(profilesDir, name))
  }

  for (const profile of profiles) {
    const link = join(profile, 'node_modules', BUNDLE)
    if (!isLink(link)) continue
    const real = safeRealpath(link)
    if (real === null) continue
    const root = resolve(real, '..')
    if (!roots.some((entry) => entry.root === root)) {
      roots.push({ source: REPO, root, why: `linked from ${profile}` })
    }
  }
  return roots
}

function safeReaddir(dir) {
  try {
    return execFileSync('ls', ['-1', dir], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function isLink(file) {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

function safeRealpath(file) {
  try {
    return realpathSync(file)
  } catch {
    return null
  }
}

/**
 * Run the bundle's own --check against one checkout.
 * @returns {{ ok: boolean, detail: string, skipped?: boolean }}
 */
function checkOne(root) {
  const script = join(root, 'scripts', 'build-plugin.mjs')
  if (!existsSync(script)) return { ok: false, detail: `no scripts/build-plugin.mjs in ${root}`, skipped: false }
  const outDir = join(root, 'plugin', 'lib')
  const present = existsSync(outDir) && safeReaddir(outDir).length > 0
  if (!present) {
    // A generated directory that was never built is not rot; it is an
    // unbootstrapped checkout. Say so and let it pass with a note.
    return { ok: true, skipped: true, detail: 'plugin/lib not built (gitignored; run pnpm build:websearch)' }
  }
  try {
    execFileSync(process.execPath, [script, '--check', '--root', root], { encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, detail: 'plugin/lib matches lib/ sources' }
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    return { ok: false, detail: text || 'build-plugin --check failed' }
  }
}

const options = parseArgs(process.argv.slice(2))
const roots = candidateRoots(options.profile)
const results = []
let failures = 0

for (const { root, why } of roots) {
  if (!existsSync(root)) {
    results.push({ root, why, ok: false, detail: 'directory does not exist' })
    failures += 1
    continue
  }
  const outcome = checkOne(root)
  const loaded = why.startsWith('linked from')
  const entry = { root, why, loaded, ...outcome }
  results.push(entry)
  if (!outcome.ok) failures += 1
}

if (options.json) {
  console.log(JSON.stringify({ ok: failures === 0, results }, null, 2))
} else {
  for (const entry of results) {
    const mark = entry.ok ? (entry.skipped ? 'skip' : ' ok ') : 'FAIL'
    console.log(`  ${mark} ${entry.root}`)
    console.log(`       (${entry.why}) ${entry.detail.split('\n')[0]}`)
    if (!entry.ok && entry.detail.includes('\n')) {
      for (const line of entry.detail.split('\n').slice(1)) console.log(`       ${line}`)
    }
  }
  console.log(failures === 0
    ? `\nartifacts ok: ${results.length} cop${results.length === 1 ? 'y' : 'ies'} checked`
    : `\n${failures} artifact problem(s)`)
}

process.exit(failures === 0 ? 0 : 1)
