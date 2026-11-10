#!/usr/bin/env node
/**
 * Verify the workspace contract: every directory under packages/ must look like
 * a loadable DSH bundle, and each bundle must be self-describing.
 *
 *   node scripts/verify-packages.mjs [--root DIR]
 *
 * `--root DIR` points the workspace checks at a throwaway directory instead of
 * this repository. It exists for the contract tests (test/verify-packages.test.mjs)
 * and changes nothing else: every rule runs the same way against either root.
 *
 * A package counts as a DSH bundle when its package.json declares
 * `dsh.bundle.patch` and that patch file exists. Packages without the field
 * (workspace metadata such as the websearch repo root) are reported as meta and
 * do not fail the run.
 *
 * This script deliberately checks nothing outside packages/. How a host wires
 * these bundles into a profile is the host's business, not this repository's.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** `--root DIR`: check a throwaway workspace instead of this repository. */
function rootFromArgv(argv) {
  const at = argv.indexOf('--root')
  if (at === -1) return ROOT
  const value = argv[at + 1]
  if (value === undefined) throw new Error('--root needs a directory')
  return resolve(value)
}
const CHECK_ROOT = rootFromArgv(process.argv.slice(2))

/** Directories under packages/ that are repository metadata, not bundles. */
const META = new Set(['websearch-dsh-plugin'])

/** Bundle name -> directory, for the packages this workspace ships. */
const EXPECTED = [
  ['dsh-credential-vault', 'dsh-credential-vault'],
  ['dsh-inventory', 'dsh-inventory'],
  ['dsh-deep-ptc-mode', 'dsh-deep-ptc-mode'],
  ['dev-flow', 'dev-flow'],
  ['dsh-websearch-failover', 'dsh-websearch-failover'],
  ['dsh-task-dispatcher', 'dsh-task-dispatcher'],
  ['ecc-agent-presets', 'ecc-agent-presets'],
  ['dsh-skill-surface', 'dsh-skill-surface'],
]

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * A bundle patch mixes two very different things:
 *
 *   - insert  — rows this bundle ADDS (no target id, or a group id)
 *   - bare    — a patch of a row that already exists elsewhere in the tree
 *
 * Written the other way round, a new row silently disappears: the layer looks
 * its id up, does not find it, logs `patch: entry "x" not found` and moves on.
 * dev-flow shipped that way for months and none of its rows were ever mounted
 * (#161). A bare entry that overrides nothing is therefore almost always a
 * mistyped insert, so it fails here for every bundle at once.
 *
 * `# verify-packages: allow-bare-row` in the same file is the escape hatch for
 * a deliberate name-only patch.
 */
const BARE_ROW_OVERRIDES = ['config', 'disabled', 'group', 'inject', 'intercept', 'isolate']
function checkPatchRows(bundleName, text) {
  if (text.includes('verify-packages: allow-bare-row')) return
  let current = null
  const finish = () => {
    if (current === null) return
    const overrides = BARE_ROW_OVERRIDES.filter((key) => current.body.some((line) => new RegExp('^\\s+' + key + ':').test(line)))
    const hasTarget = current.id !== null
    if (!current.insert && hasTarget && overrides.length === 0 && current.body.length > 0) {
      problems.push(
        `packages/${bundleName}: row "${current.id}" only renames/restates a row — the patch layer treats a bare id as a patch of an existing entry, so a NEW row disappears here. Put it under "- insert:" or add an override key.`,
      )
    }
    current = null
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      finish()
      const headId = /^-\s*id:\s*'?([^'\s]+)'?\s*$/.exec(line)
      current = { insert: line.startsWith('- insert:'), id: headId === null ? null : headId[1], body: [] }
      continue
    }
    if (current === null) continue
    const idMatch = /^\s*-?\s*id:\s*'?([^'\s]+)'?\s*$/.exec(line)
    if (idMatch !== null) current.id = idMatch[1]
    current.body.push(line)
  }
  finish()
}

const problems = []
const notes = []

// --- 1. every package directory is either a bundle or declared meta ---------
let foundBundles = 0
for (const entry of readdirSync(join(CHECK_ROOT, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const dir = join(CHECK_ROOT, 'packages', entry.name)
  const manifestFile = join(dir, 'package.json')
  if (!existsSync(manifestFile)) {
    problems.push(`packages/${entry.name}: no package.json`)
    continue
  }
  const manifest = readJson(manifestFile)
  const patch = manifest.dsh?.bundle?.patch
  if (patch === undefined) {
    if (META.has(manifest.name)) notes.push(`packages/${entry.name}: meta package (${manifest.name}), no bundle`)
    else problems.push(`packages/${entry.name}: ${manifest.name} declares no dsh.bundle.patch`)
    continue
  }
  if (!existsSync(join(dir, patch))) problems.push(`packages/${entry.name}: patch ${patch} missing`)
  else checkPatchRows(entry.name, readFileSync(join(dir, patch), 'utf8'))
  checkClientExport(entry.name, dir, manifest)
  foundBundles += 1
}

/**
 * A bundle may declare a web client (`dsh.client`); the host
 * (dsh-client-modules) resolves it through `exports["./client"]`:
 * a string as-is, a conditional object through its string `default`,
 * any other shape malformed — in the host's own words. A bundle that
 * declares the client without the export cannot load its UI, so it
 * fails here rather than at runtime.
 */
function checkClientExport(bundleName, dir, manifest) {
  if (manifest.dsh?.client === undefined) return
  const clientExport = manifest.exports?.['./client']
  let clientRel
  if (typeof clientExport === 'string') {
    clientRel = clientExport
  } else if (clientExport !== undefined && (typeof clientExport !== 'object' || clientExport === null)) {
    problems.push(`${bundleName}: exports["./client"] must be a string or an object with a string default`)
  } else if (clientExport !== undefined) {
    const fallback = clientExport.default
    if (typeof fallback === 'string') clientRel = fallback
    else problems.push(`${bundleName}: exports["./client"] must be a string or an object with a string default`)
  } else {
    problems.push(`${bundleName}: declares a web client but exports no "./client" entry (the host cannot resolve it)`)
  }
  if (clientRel !== undefined && !existsSync(join(dir, clientRel))) {
    problems.push(`${bundleName}: exports["./client"] -> ${clientRel} missing`)
  }
}

// --- 2. the expected bundles exist and are shaped correctly ----------------
// EXPECTED is this repository's contract (name -> directory); a --root
// throwaway workspace carries its own bundles, so the list does not apply there.
const checkingThisRepo = CHECK_ROOT === ROOT
for (const [bundleName, relDir] of checkingThisRepo ? EXPECTED : []) {
  const dir = join(CHECK_ROOT, 'packages', relDir)
  const manifestFile = join(dir, 'package.json')
  if (!existsSync(manifestFile)) {
    problems.push(`${bundleName}: missing ${relDir}/package.json`)
    continue
  }
  const manifest = readJson(manifestFile)
  if (manifest.name !== bundleName) problems.push(`${relDir}: name is ${manifest.name}, expected ${bundleName}`)
  if (manifest.main !== undefined && !existsSync(join(dir, manifest.main))) {
    problems.push(`${bundleName}: main ${manifest.main} missing`)
  }
  if (manifest.dsh?.client !== undefined) {
    // The host (dsh-client-modules) resolves a bundle's web client through
    // `exports["./client"]`, accepting a string or a one-level conditional
    // with a string `default`. A root `client.js` is just where existing
    // bundles happen to point; the export is the contract.
    checkClientExport(bundleName, dir, manifest)
  }
  notes.push(`${bundleName}@${manifest.version} -> packages/${relDir}`)
}

// --- report ---------------------------------------------------------------
for (const line of notes) console.log(`  ok  ${line}`)
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`)
  for (const line of problems) console.error(`  !!  ${line}`)
  process.exit(1)
}
console.log(`\nworkspace ok: ${checkingThisRepo ? EXPECTED.length : foundBundles} bundles`)
