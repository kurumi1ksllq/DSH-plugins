#!/usr/bin/env node
/**
 * Verify the workspace contract: every directory under packages/ must look like
 * a loadable DSH bundle, and each bundle must be self-describing.
 *
 *   node scripts/verify-packages.mjs
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

/** Directories under packages/ that are repository metadata, not bundles. */
const META = new Set(['websearch-dsh-plugin'])

/** Bundle name -> directory, for the packages this workspace ships. */
const EXPECTED = [
  ['dsh-credential-vault', 'dsh-credential-vault'],
  ['dsh-git-bash-tool', 'dsh-git-bash-tool'],
  ['dsh-git-status', 'dsh-git-status'],
  ['dsh-inventory', 'dsh-inventory'],
  ['dsh-deep-ptc-mode', 'dsh-deep-ptc-mode'],
  ['@local/dsh-prompt-inject', 'dsh-prompt-inject'],
  ['dev-flow-skill', 'dev-flow-skill'],
  ['dsh-websearch-failover', 'dsh-websearch-failover/plugin'],
]

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

const problems = []
const notes = []

// --- 1. every package directory is either a bundle or declared meta ---------
for (const entry of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const dir = join(ROOT, 'packages', entry.name)
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
}

// --- 2. the expected bundles exist and are shaped correctly ----------------
for (const [bundleName, relDir] of EXPECTED) {
  const dir = join(ROOT, 'packages', relDir)
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
    const clientExport = manifest.exports?.['./client']
    const clientRel = typeof clientExport === 'string'
      ? clientExport
      : typeof clientExport?.default === 'string'
        ? clientExport.default
        : undefined
    if (clientRel === undefined) {
      problems.push(`${bundleName}: declares a web client but exports no "./client" entry (the host cannot resolve it)`)
    } else if (!existsSync(join(dir, clientRel))) {
      problems.push(`${bundleName}: exports["./client"] -> ${clientRel} missing`)
    }
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
console.log(`\nworkspace ok: ${EXPECTED.length} bundles`)
