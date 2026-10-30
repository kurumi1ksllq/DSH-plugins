#!/usr/bin/env node
/**
 * Static check for `profiles/web/` — no install, no server, no DSH process.
 *
 * Answers one question: would a Linux host cloning this repo be able to
 * resolve and load every bundle this profile declares?
 *
 * Catches the failure modes the handoff doc calls out:
 *   1. a `link:` target that does not exist in the repo (typo / moved dir)
 *   2. a linked package whose package.json `name` != the dependency key
 *   3. a bundle that declares `dsh.bundle.patch` but ships no patch file
 *   4. `packages/dsh-websearch-failover/plugin/lib/` missing because it is
 *      gitignored and `scripts/build-plugin.mjs` was never run after clone
 *   5. `dsh-git-bash-tool` mounted here (its static patch breaks Linux shells)
 *
 * Exit code 0 = clean, 1 = at least one blocking problem.
 *
 * @module verify-web-profile
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE = join(ROOT, 'profiles', 'web')

/** Collected blocking findings. */
const problems = []
/** Collected notes; never fail the run. */
const notes = []

/**
 * Read and parse one JSON file.
 * @param path - absolute path.
 * @returns the parsed value, or undefined when the file is unreadable.
 */
function readJson(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`${path}: invalid JSON (${error.message})`)
    return undefined
  }
}

if (!existsSync(join(PROFILE, 'package.json'))) {
  console.error(`verify-web-profile: ${PROFILE} not found`)
  process.exit(1)
}

const profile = readJson(join(PROFILE, 'package.json'))
const bundles = profile?.dsh?.profile?.bundles ?? []

// 0. the lockfile has to travel with package.json, or the server resolves fresh versions
if (!existsSync(join(PROFILE, 'pnpm-lock.yaml'))) {
  problems.push('profiles/web/pnpm-lock.yaml is missing — the server would resolve fresh versions')
}
if (!existsSync(join(PROFILE, 'node_modules'))) {
  notes.push('profiles/web/node_modules is absent — run `pnpm install` in profiles/web first')
}

// 1 + 2. every link: dependency points at a real package with the right name
const linked = []
for (const [key, spec] of Object.entries(profile.dependencies ?? {})) {
  if (!String(spec).startsWith('link:')) continue
  const target = resolve(PROFILE, String(spec).slice('link:'.length))
  if (!existsSync(target)) {
    problems.push(`${key}: link target does not exist -> ${target}`)
    continue
  }
  const manifest = readJson(join(target, 'package.json'))
  if (manifest === undefined) {
    problems.push(`${key}: link target has no package.json -> ${target}`)
    continue
  }
  if (manifest.name !== key) {
    problems.push(`${key}: package.json name is "${manifest.name}" — must match the dependency key`)
  }
  linked.push({ key, target, manifest })
}

// 3. every declared bundle that ships a patch actually ships the file
for (const { key, target, manifest } of linked) {
  const patch = manifest?.dsh?.bundle?.patch
  if (patch === undefined) continue
  if (!existsSync(resolve(target, patch))) {
    problems.push(`${key}: dsh.bundle.patch points at a missing file -> ${patch}`)
  }
}

// bundle list sanity: every linked bundle should be listed, and vice versa
const bundleNames = linked
  .filter((entry) => entry.manifest?.dsh?.bundle !== undefined)
  .map((entry) => entry.key)
for (const name of bundleNames) {
  if (!bundles.includes(name)) problems.push(`${name}: is a bundle but missing from dsh.profile.bundles`)
}
for (const name of bundles) {
  const isLinked = linked.some((entry) => entry.key === name)
  if (!isLinked && name.startsWith('dsh-') && !name.startsWith('@deepseek-ai/')) {
    notes.push(`${name}: listed in bundles but not linked here — resolved from the registry`)
  }
}

// 4. websearch's generated bundle output is gitignored; a fresh clone has an empty plugin/lib/
const websearchPlugin = join(ROOT, 'packages', 'dsh-websearch-failover', 'plugin')
if (existsSync(websearchPlugin)) {
  const libDir = join(websearchPlugin, 'lib')
  const modules = existsSync(libDir) ? readdirSync(libDir).filter((f) => f.endsWith('.mjs')) : []
  if (modules.length === 0) {
    problems.push(
      'packages/dsh-websearch-failover/plugin/lib/ is empty — run ' +
        '`node packages/dsh-websearch-failover/scripts/build-plugin.mjs` BEFORE `pnpm install`'
    )
  } else {
    notes.push(`websearch plugin/lib: ${modules.length} generated modules present`)
  }
}

// 5. the Windows-only shell plugin must never appear in this profile
const deps = profile.dependencies ?? {}
if (Object.hasOwn(deps, 'dsh-git-bash-tool') || bundles.includes('dsh-git-bash-tool')) {
  problems.push(
    'dsh-git-bash-tool must not be mounted here: its static cordis.patch.yml re-enables ' +
      'bash on a host where `bash` resolves to a Windows path'
  )
}

for (const note of notes) console.log(`note: ${note}`)
for (const problem of problems) console.error(`FAIL: ${problem}`)

if (problems.length > 0) {
  console.error(`verify-web-profile: ${problems.length} blocking problem(s)`)
  process.exit(1)
}

console.log(
  `verify-web-profile: ok — ${bundles.length} bundles, ${linked.length} local links, ` +
    'every patch file and generated module present'
)
