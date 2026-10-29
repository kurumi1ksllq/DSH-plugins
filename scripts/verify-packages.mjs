#!/usr/bin/env node
/**
 * Verify the workspace contract: every package under packages/ must look like a
 * loadable DSH bundle, and the desktop profile must link to it.
 *
 *   node scripts/verify-packages.mjs
 *   node scripts/verify-packages.mjs --profile <dir>
 *
 * A package counts as a DSH bundle when its package.json declares
 * `dsh.bundle.patch` and that patch file exists. Packages without the field
 * (workspace metadata such as the websearch repo root) are reported as meta and
 * do not fail the run.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
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
  ['dsh-websearch-failover', 'dsh-websearch-failover/plugin'],
]

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function profileDir(argv) {
  const at = argv.indexOf('--profile')
  if (at !== -1 && argv[at + 1] !== undefined) return resolve(argv[at + 1])
  if (process.env.DSH_PROFILE_DIR) return resolve(process.env.DSH_PROFILE_DIR)
  const home = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
  return join(home, 'profiles', 'desktop')
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

// --- 3. the live profile links to these directories ------------------------
const profile = profileDir(process.argv.slice(2))
const profileManifestFile = join(profile, 'package.json')
if (!existsSync(profileManifestFile)) {
  problems.push(`profile: ${profileManifestFile} missing`)
} else {
  const manifest = readJson(profileManifestFile)
  const bundles = manifest.dsh?.profile?.bundles ?? []
  for (const [bundleName, relDir] of EXPECTED) {
    if (!bundles.includes(bundleName)) problems.push(`profile: ${bundleName} is not in dsh.profile.bundles`)
    const spec = manifest.dependencies?.[bundleName]
    if (spec === undefined) {
      problems.push(`profile: ${bundleName} has no dependency entry`)
      continue
    }
    if (!spec.startsWith('link:')) {
      problems.push(`profile: ${bundleName} is pinned as ${spec}, expected a link: to this workspace`)
      continue
    }
    const linked = resolve(spec.slice('link:'.length))
    const expectedDir = join(ROOT, 'packages', relDir)
    const same = existsSync(linked) && resolve(realpathSync(linked)) === resolve(realpathSync(expectedDir))
    if (!same) problems.push(`profile: ${bundleName} links to ${linked}, expected ${expectedDir}`)
  }
}

// --- report ---------------------------------------------------------------
for (const line of notes) console.log(`  ok  ${line}`)
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`)
  for (const line of problems) console.error(`  !!  ${line}`)
  process.exit(1)
}
console.log(`\nworkspace ok: ${EXPECTED.length} bundles, profile ${profile}`)
