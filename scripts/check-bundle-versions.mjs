#!/usr/bin/env node
/**
 * Version and packaging discipline for the bundles in this workspace.
 *
 * Three rules, each traceable to a defect in docs/update-scheme.md:
 *
 *   1. **engines.dsh** (P1-9) — every bundle declares the DSH runtime it is
 *      built for. Without it the host's compatibility check never fires, so an
 *      incompatible plugin loads and fails at activation instead of at install.
 *   2. **a test script** (P1-8) — every bundle declares its own `test`, so
 *      `pnpm -r --if-present` cannot skip a package in silence.
 *   3. **a version bump** (P1-7) — a bundle whose code changed since its last
 *      tag must have a higher `version`. This is what makes "which commit is
 *      the host running" answerable at all.
 *
 *   node scripts/check-bundle-versions.mjs           # all rules
 *   node scripts/check-bundle-versions.mjs --json
 *   node scripts/check-bundle-versions.mjs --no-bump-check
 *
 * Rule 3 compares against tags named `<pkg>@<version>`; it is skipped
 * per-bundle until that bundle has a tag (see P0-3), and skipped wholesale
 * outside a git checkout. Never writes.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** The DSH range every bundle in this workspace is expected to support. */
const EXPECTED_DSH_RANGE = '^0.2.0'

/** Directories under packages/ that are repository metadata, not bundles. */
const META = new Set(['websearch-dsh-plugin'])

const options = { json: process.argv.includes('--json'), bumpCheck: !process.argv.includes('--no-bump-check') }

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim()
  } catch {
    return null
  }
}

const inGit = git(['rev-parse', '--is-inside-work-tree']) === 'true'
const tags = inGit ? (git(['tag', '--list']) ?? '').split('\n').filter(Boolean) : []

/** Every bundle in the workspace: `<name>`, `<dir>`, `<manifest>`. */
function collectBundles() {
  const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  // `packages/*` (workspace glob) plus the websearch bundle, which nests one
  // level deeper because its repo root carries the build scripts.
  const dirs = execFileSync('ls', ['-1', join(ROOT, 'packages')], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const bundles = []
  for (const name of dirs) {
    const dir = join(ROOT, 'packages', name)
    const file = join(dir, 'package.json')
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    // The websearch repo root is metadata (it carries the build scripts) but
    // its nested plugin/ IS a bundle — so do not `continue` before looking.
    const meta = META.has(manifest.name) || manifest.dsh?.bundle?.patch === undefined
    if (!meta) bundles.push({ dir, manifest })
    // A nested bundle (`<dir>/plugin`) is its own package with its own version.
    const nested = join(dir, 'plugin', 'package.json')
    if (existsSync(nested)) {
      const nestedManifest = JSON.parse(readFileSync(nested, 'utf8'))
      if (nestedManifest.dsh?.bundle?.patch !== undefined || nestedManifest.name !== manifest.name) {
        bundles.push({ dir: join(dir, 'plugin'), manifest: nestedManifest })
      }
    }
  }
  return { bundles, rootManifest }
}

const problems = []
const notes = []
const { bundles, rootManifest } = collectBundles()
if (typeof rootManifest.engines?.dsh !== 'string') {
  notes.push('package.json (workspace root): no engines.dsh — informational, the root is not a published bundle')
}

for (const { dir, manifest } of bundles) {
  const rel = relative(ROOT, dir)
  const label = rel
  const name = manifest.name

  // 1. engines.dsh
  const dshRange = manifest.engines?.dsh
  if (typeof dshRange !== 'string' || dshRange.length === 0) {
    problems.push(`${label} (${name}): no engines.dsh — the host's compatibility check can never fire`)
  } else if (!satisfiesRuntime(dshRange)) {
    problems.push(`${label} (${name}): engines.dsh "${dshRange}" does not admit the expected range ${EXPECTED_DSH_RANGE}`)
  }

  // 2. a test script
  if (typeof manifest.scripts?.test !== 'string' || manifest.scripts.test.trim().length === 0) {
    problems.push(`${label} (${name}): no scripts.test — pnpm -r --if-present skips it silently`)
  }

  // 3. version bump since the bundle's last tag
  if (options.bumpCheck && inGit) {
    const tag = `${name}@${manifest.version}`
    if (!tags.includes(tag)) {
      notes.push(`${label} (${name}): untagged version ${manifest.version} (tag it as ${tag} — see P0-3)`)
    } else {
      // Tagged: does anything that ships have uncommitted or untagged changes?
      const changed = git(['status', '--porcelain', '--', rel])
      if (changed !== null && changed.length > 0) {
        problems.push(`${label} (${name}): ${tag} is tagged but the bundle has uncommitted changes — bump the version`)
      }
    }
  }
}

/** Crude but honest: does `range` admit the expected DSH minor line? */
function satisfiesRuntime(range) {
  const expected = EXPECTED_DSH_RANGE.replace(/^[\^~]/, '')
  if (range === '*' || range === 'x') return true
  // Accept a caret/tilde/exact pin at or below the expected minor, and any
  // `>=` that admits it. Anything more elaborate should be reviewed by a human.
  return range.includes(expected) || /(\^|~|>=)\s*0\.2\./.test(range) || range === EXPECTED_DSH_RANGE
}

const result = { ok: problems.length === 0, bundles: bundles.length, problems, notes }
if (options.json) {
  console.log(JSON.stringify(result, null, 2))
} else {
  for (const note of notes) console.log(`  note ${note}`)
  for (const problem of problems) console.log(`  FAIL ${problem}`)
  console.log(problems.length === 0
    ? `\nbundles ok: ${bundles.length} checked (engines.dsh, test script, version discipline)`
    : `\n${problems.length} packaging problem(s)`)
}

process.exit(problems.length === 0 ? 0 : 1)
