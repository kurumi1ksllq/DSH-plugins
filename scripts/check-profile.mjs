#!/usr/bin/env node
/**
 * Read-only wiring check for a DSH profile: does the host load what this
 * repository thinks it ships, from the checkout we think it ships it from?
 *
 * Why this exists (P1-4/P1-5 in docs/update-scheme.md): `link:` bundles are
 * loaded straight from their directory, so "green in this checkout" says
 * nothing about "green in the running profile". Two failure modes shipped
 * before because nothing checked the wiring:
 *
 *   1. The panel and the tests boot different copies of a bundle (two
 *      checkouts, half the packages each) — a fix merged here never reached
 *      the host.
 *   2. The wiring rotted silently: a `link:` target moved or vanished, and the
 *      only symptom was a plugin failing to activate at boot.
 *
 * This script never writes. It resolves every `link:` dependency, records the
 * realpath and commit of the checkout behind it, and compares that against the
 * bundles this repository claims to ship.
 *
 *   node scripts/check-profile.mjs                  # check the default profile
 *   node scripts/check-profile.mjs --profile web    # by name, under $DSH_HOME
 *   node scripts/check-profile.mjs --profile DIR    # or by path
 *   node scripts/check-profile.mjs --json
 *
 * Exit 1 only for wiring that is *broken* (dangling link, missing entry point).
 * A bundle served from another checkout is reported as a warning, not a
 * failure: until the authoritative checkout is unified (decision D1 in
 * docs/update-scheme.md), one profile legitimately spans two checkouts.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** Bundles this repository ships, as `<name>` -> checkout-relative directory. */
const SHIPPED = new Map([
  ['dsh-credential-vault', 'packages/dsh-credential-vault'],
  ['dsh-git-bash-tool', 'packages/dsh-git-bash-tool'],
  ['dsh-git-status', 'packages/dsh-git-status'],
  ['dsh-inventory', 'packages/dsh-inventory'],
  ['@local/dsh-prompt-inject', 'packages/dsh-prompt-inject'],
  ['dev-flow-skill', 'packages/dev-flow-skill'],
  ['dsh-websearch-failover', 'packages/dsh-websearch-failover/plugin'],
])

function parseArgs(argv) {
  const options = { profile: null, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--profile') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--profile needs a name or a directory')
      options.profile = value
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/check-profile.mjs [--profile NAME|DIR] [--json]')
      process.exit(0)
    } else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

/** `$DSH_HOME`, falling back to `~/.dsh` — the same rule the plugins use. */
function dshHome() {
  return process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE || '', '.dsh')
}

function readDirNames(dir) {
  try {
    return execFileSync('ls', ['-1', dir], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Turn `--profile` into a directory, or pick the sole profile if unambiguous. */
function resolveProfileDir(requested) {
  if (requested !== null) {
    if (requested.includes('/') || requested.includes('\\') || existsSync(requested)) return resolve(requested)
    return join(dshHome(), 'profiles', requested)
  }
  const root = join(dshHome(), 'profiles')
  if (!existsSync(root)) return null
  const names = readDirNames(root).filter((name) => {
    try {
      return statSync(join(root, name)).isDirectory()
    } catch {
      return false
    }
  })
  // Several profiles: prefer `web`, the one this repository is developed against.
  if (names.includes('web')) return join(root, 'web')
  return names.length > 0 ? join(root, names[0]) : null
}

function isLink(file) {
  try {
    return lstatSync(file).isSymbolicLink()
  } catch {
    return false
  }
}

/** The git toplevel above `dir`, so two bundles in one checkout share a commit. */
function checkoutOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    return null
  }
}

/** Commit of one checkout, or null when it is not a git tree. */
function commitOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    return null
  }
}

/** Does this bundle declare a loadable entry? Mirrors what the host resolves. */
function entryProblem(dir, manifest) {
  const patch = manifest?.dsh?.bundle?.patch
  if (typeof patch !== 'string') return 'no dsh.bundle.patch declared'
  // The patch path is relative to the bundle root; `./x.yml` is the usual shape.
  if (!existsSync(resolve(dir, patch))) return `patch file missing: ${patch}`
  const main = manifest.main ?? 'index.js'
  if (!existsSync(resolve(dir, main))) return `entry point missing: ${main}`
  return null
}
const options = parseArgs(process.argv.slice(2))
const profileDir = resolveProfileDir(options.profile)

if (profileDir === null || !existsSync(profileDir)) {
  const reason = profileDir === null
    ? `no DSH profile under ${join(dshHome(), 'profiles')}`
    : `profile directory does not exist: ${profileDir}`
  if (options.json) console.log(JSON.stringify({ ok: true, skipped: true, reason }, null, 2))
  else console.log(`  skip no profile to check (${reason})`)
  // A missing profile is "nothing to verify" on a CI box, not a failure.
  process.exit(0)
}

let deps = {}
try {
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  deps = manifest.dependencies ?? {}
} catch (error) {
  console.log(`  FAIL cannot read ${join(profileDir, 'package.json')}: ${error.message}`)
  process.exit(1)
}

const results = []
let failures = 0
let warnings = 0

for (const name of [...SHIPPED.keys()].sort()) {
  const spec = deps[name]
  if (typeof spec !== 'string') continue // not installed in this profile

  const linkPath = join(profileDir, 'node_modules', name)
  if (!isLink(linkPath)) {
    // Declared as a link but materialised as a real directory: the host no
    // longer loads our sources. Broken, not a warning.
    results.push({ name, kind: 'fail', detail: 'declared, but the node_modules entry is not a symlink' })
    failures += 1
    continue
  }

  let real = null
  try {
    real = realpathSync(linkPath)
  } catch {
    results.push({ name, kind: 'fail', detail: 'dangling link (target missing)' })
    failures += 1
    continue
  }

  let manifest = null
  try {
    manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'))
  } catch {
    results.push({ name, kind: 'fail', detail: `no readable package.json at ${real}` })
    failures += 1
    continue
  }

  const entryIssue = entryProblem(real, manifest)
  if (entryIssue !== null) {
    results.push({ name, kind: 'fail', detail: `${entryIssue} (at ${real})` })
    failures += 1
    continue
  }

  const checkout = checkoutOf(real)
  const commit = checkout === null ? null : commitOf(checkout)
  if (checkout === REPO) {
    results.push({ name, kind: 'ok', version: manifest.version, detail: `${real} @ ${commit ?? 'no-git'}` })
  } else {
    // Not an error today (D1 is still open), but exactly the situation that
    // makes this repository's green checks meaningless — say so loudly.
    const expected = resolve(REPO, SHIPPED.get(name))
    results.push({
      name,
      kind: 'warn',
      version: manifest.version,
      detail: `loads from a DIFFERENT checkout: ${checkout ?? real} @ ${commit ?? 'no-git'} (this repo: ${expected})`,
    })
    warnings += 1
  }
}

// dsh-inventory's Tools page renders sections that call the other bundles' HTTP
// routes (vault, providers, prompt). They are not declared as dependencies, so a
// profile that links inventory without them shows a page whose tabs all answer
// 404. A warning, not a failure: partially linked profiles are legitimate while
// someone is trying one bundle out.
const INVENTORY_SECTIONS = ['dsh-credential-vault', 'dsh-websearch-failover', '@local/dsh-prompt-inject']
const linkedNames = new Set(results.filter((row) => row.kind !== 'fail').map((row) => row.name))
if (linkedNames.has('dsh-inventory')) {
  const missing = INVENTORY_SECTIONS.filter((name) => !linkedNames.has(name))
  if (missing.length > 0) {
    results.push({
      name: 'dsh-inventory sections',
      kind: 'warn',
      detail: `the Tools page renders ${missing.join(', ')} but ${missing.length > 1 ? 'they are' : 'it is'} not linked in this profile — those tabs will answer 404`,
    })
    warnings += 1
  }
}

const branched = results.filter((row) => row.kind === 'warn')

if (options.json) {
  console.log(JSON.stringify({ ok: failures === 0, profile: profileDir, failures, warnings, results }, null, 2))
} else {
  for (const row of results) {
    const mark = row.kind === 'ok' ? ' ok ' : row.kind === 'warn' ? 'warn' : 'FAIL'
    console.log(`  ${mark} ${row.name}${row.version ? `@${row.version}` : ''}`)
    console.log(`       ${row.detail}`)
  }
  if (branched.length > 0) {
    console.log(`\n  ${branched.length} bundle(s) load from another checkout — checks here do not cover them.`)
    console.log('  See decision D1 in docs/update-scheme.md (unifying needs one approved restart).')
  }
  const head = failures === 0
    ? `\nprofile ok: ${results.length} linked bundle(s) in ${profileDir}`
    : `\n${failures} wiring problem(s) in ${profileDir}`
  console.log(head + (warnings > 0 ? ` (${warnings} warning(s))` : ''))
}

process.exit(failures === 0 ? 0 : 1)
