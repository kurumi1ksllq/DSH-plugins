/**
 * Stage 3 of the update tool: VERIFY the staged generation.
 *
 * Every gate runs against the STAGE, never against the live tree: a gate that
 * mutates what DSH is currently loading is not a gate, it is an outage.
 *
 * The gates, and why each exists:
 *   contract  the repository's own bundle contract (`scripts/verify-packages.mjs`).
 *   build     generated runtime files must match their sources. Mandatory for
 *             the bundle whose `plugin/lib` is generated: a git-only update
 *             ships stale code for it.
 *   entry     every bundle entry must be importable in a child process. The
 *             cheapest honest proxy for "the loader can resolve this row".
 *   deps      no dependency was ADDED between generations. A new dependency is
 *             not installed by a file swap, so such an update belongs to the
 *             plugin manager lane (docs/update-scheme.md §4.2).
 *   compose   `dsh --profile <p> --dump-config` exits 0 with EMPTY stderr.
 *             Exit code alone turns "bundle silently skipped" into success.
 *   test      the bundle's own test script. Opt-in; slowest gate.
 *
 * KNOWINGLY WEAK: `entry` imports outside a Cordis host, so a bundle whose
 * top-level code needs `ctx` fails here while loading fine inside DSH. The gate
 * reports a distinct `needs-review` outcome instead of a pass, so a false
 * negative never gets laundered into a green light.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { readJson, sh, tail } from './lib.mjs'

/** Same resolution rule as dsh-inventory `lib/profile-packages.js:25-32`. */
export function entryFile(pkg) {
  if (pkg === null || typeof pkg !== 'object') return null
  if (typeof pkg.main === 'string') return pkg.main
  const exports = pkg.exports
  if (typeof exports === 'string') return exports
  if (exports !== null && typeof exports === 'object') {
    const root = exports['.']
    if (typeof root === 'string') return root
    if (root !== null && typeof root === 'object' && typeof root.default === 'string') return root.default
  }
  return 'index.js'
}

/** Every directory under packages/ that declares a bundle patch. */
export function bundleDirs(root) {
  const base = join(root, 'packages')
  if (!existsSync(base)) return []
  const found = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const candidate of [join(base, entry.name), join(base, entry.name, 'plugin')]) {
      const pkg = readJson(join(candidate, 'package.json'))
      if (pkg?.dsh?.bundle?.patch !== undefined) found.push({ name: pkg.name, dir: candidate, pkg })
    }
  }
  return found
}

const IMPORT_PROBE = (url) =>
  `import(${JSON.stringify(url)}).then(() => process.exit(0), (error) => { console.error(String(error && error.message || error)); process.exit(1) })`

/** `contract` gate: the repository's own bundle contract, offline and fast. */
export async function gateContract(root, { timeoutMs = 120000 } = {}) {
  const script = join(root, 'scripts', 'verify-packages.mjs')
  if (!existsSync(script)) return { gate: 'contract', ok: true, skipped: 'no verify-packages.mjs in this generation' }
  const out = await sh(process.execPath, [script], { cwd: root, timeoutMs })
  return {
    gate: 'contract',
    ok: out.ok,
    results: [{ outcome: out.ok ? 'ok' : 'fail', detail: out.ok ? 'packages contract holds' : tail(out, 4) }],
  }
}

/** `build` gate: generated runtime files must match their sources. */
export async function gateBuild(root, { timeoutMs = 180000 } = {}) {
  const script = join(root, 'packages', 'dsh-websearch-failover', 'scripts', 'build-plugin.mjs')
  if (!existsSync(script)) return { gate: 'build', ok: true, skipped: 'no generated bundle in this generation' }
  const out = await sh(process.execPath, [script, '--check'], { cwd: root, timeoutMs })
  return {
    gate: 'build',
    ok: out.ok,
    results: [{ outcome: out.ok ? 'ok' : 'stale', detail: out.ok ? 'plugin/lib matches its sources' : tail(out, 4) }],
  }
}

/** `entry` gate: import each bundle entry in a child process, bounded by a timeout. */
export async function gateEntry(root, { timeoutMs = 90000 } = {}) {
  const results = []
  for (const bundle of bundleDirs(root)) {
    const entry = entryFile(bundle.pkg)
    const file = entry === null ? null : join(bundle.dir, entry)
    if (file === null || !existsSync(file)) {
      results.push({ name: bundle.name, outcome: 'fail', detail: `no entry file (${entry ?? 'unknown'})` })
      continue
    }
    const out = await sh(process.execPath, ['--input-type=module', '-e', IMPORT_PROBE(pathToFileURL(file).href)], { timeoutMs })
    results.push({
      name: bundle.name,
      outcome: out.ok ? 'ok' : out.timedOut ? 'needs-review' : 'fail',
      detail: out.ok ? entry : tail(out, 2),
    })
  }
  const failed = results.filter((row) => row.outcome === 'fail').length
  const review = results.filter((row) => row.outcome === 'needs-review').length
  return { gate: 'entry', ok: failed === 0, needsReview: review, results }
}

const depKeys = (pkg) => new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
])

/**
 * `deps` gate: compare dependency sets of the live and the staged
 * `package.json`. Only ADDITIONS block — removing a dependency cannot break
 * resolution, adding one can, because a file swap does not run an install.
 */
export async function gateDeps(row, stage) {
  const livePkg = readJson(join(row.target, 'package.json'))
  const stagedPkg = readJson(join(stage, 'package.json'))
  if (livePkg === null || stagedPkg === null) {
    return {
      gate: 'deps',
      ok: false,
      results: [{ outcome: 'fail', detail: `cannot read package.json (live=${row.target}, stage=${stage})` }],
    }
  }
  const before = depKeys(livePkg)
  const added = [...depKeys(stagedPkg)].filter((name) => !before.has(name))
  return {
    gate: 'deps',
    ok: added.length === 0,
    results: [
      {
        outcome: added.length === 0 ? 'ok' : 'fail',
        detail: added.length === 0
          ? 'no dependency added'
          : `dependency added (${added.join(', ')}): needs an install, so this is a plugin-manager action, not a file swap`,
      },
    ],
  }
}

/**
 * `compose` gate: `dsh --profile <p> --dump-config` must exit 0 AND print
 * nothing on stderr. Exit code alone turns "bundle silently skipped" into
 * success, so stderr is part of the verdict.
 *
 * Skips — never passes — when the `dsh` binary is unavailable: an
 * unverifiable generation must not be reported as verified.
 */
export async function gateCompose({ dshBin = 'dsh', profile = 'web', timeoutMs = 120000 } = {}) {
  const probe = await sh(dshBin, ['--version'], { timeoutMs: 30000 })
  if (!probe.ok) return { gate: 'compose', ok: true, skipped: `dsh binary not available (${dshBin})` }
  const out = await sh(dshBin, ['--profile', profile, '--dump-config'], { timeoutMs })
  const stderr = out.stderr.trim()
  const ok = out.ok && stderr.length === 0
  return {
    gate: 'compose',
    ok,
    results: [
      {
        outcome: ok ? 'ok' : 'fail',
        detail: ok
          ? 'dump-config clean (stderr empty)'
          : `exit=${out.code ?? '?'} stderr=${stderr.length === 0 ? `(empty; stdout tail: ${tail(out, 2)})` : stderr.slice(0, 400)}`,
      },
    ],
  }
}

/** `test` gate: each bundle's own test script. Opt-in, slow. */
export async function gateTest(root, { timeoutMs = 900000 } = {}) {
  const results = []
  for (const bundle of bundleDirs(root)) {
    const script = bundle.pkg?.scripts?.test
    if (typeof script !== 'string') {
      results.push({ name: bundle.name, outcome: 'skipped', detail: 'no test script' })
      continue
    }
    const out = await sh('/bin/sh', ['-c', script], { cwd: bundle.dir, timeoutMs })
    results.push({ name: bundle.name, outcome: out.ok ? 'ok' : 'fail', detail: out.ok ? 'passed' : tail(out, 3) })
  }
  return { gate: 'test', ok: results.every((row) => row.outcome !== 'fail'), results }
}

/**
 * Run the requested gates. `root` is the tree to judge (the staged checkout,
 * or the live checkout for a whole-repo gate run); `stage` is the bundle body
 * under test when `row` is given.
 */
export async function runGates(root, gates, { row = null, stage = root, dshBin = 'dsh' } = {}) {
  const out = []
  if (gates.includes('contract')) out.push(await gateContract(root))
  if (gates.includes('build')) out.push(await gateBuild(root))
  if (gates.includes('entry')) out.push(await gateEntry(root))
  if (row !== null && gates.includes('deps')) out.push(await gateDeps(row, stage))
  if (gates.includes('compose')) out.push(await gateCompose({ dshBin }))
  if (gates.includes('test')) out.push(await gateTest(root))
  return { dir: root, gates: out, ok: out.every((gate) => gate.ok !== false) }
}

export const ALL_GATES = ['contract', 'build', 'entry', 'deps', 'compose', 'test']
export const DEFAULT_GATES = ['contract', 'build', 'entry', 'deps', 'compose']
