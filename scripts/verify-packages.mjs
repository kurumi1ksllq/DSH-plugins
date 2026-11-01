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
  ['dsh-ctx-guard', 'dsh-ctx-guard'],
  ['dsh-git-bash-tool', 'dsh-git-bash-tool'],
  ['dsh-inventory', 'dsh-inventory'],
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
    const clientEntry = join(dir, 'client.js')
    if (!existsSync(clientEntry)) problems.push(`${bundleName}: declares a web client but client.js is missing`)
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
