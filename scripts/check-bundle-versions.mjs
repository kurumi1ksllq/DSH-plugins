#!/usr/bin/env node
/**
 * Version and packaging discipline for the bundles in this workspace.
 *
 * Four rules, each traceable to a defect or review finding:
 *
 *   1. **engines.dsh** (P1-9) - every bundle declares the DSH runtime it is
 *      built for, so the host fails at install instead of at activation.
 *   2. **a test script** (P1-8) - every bundle declares its own `test`, so
 *      `pnpm -r --if-present` cannot skip a package in silence.
 *   3. **a version bump** (P1-7) - a bundle whose code changed since its last
 *      tag must have a higher `version`.
 *   4. **a CHANGELOG entry** (T0.2/#99) - every tagged version is documented in
 *      the root CHANGELOG.md. Name and version must be adjacent inside one
 *      `/`-separated heading segment; a combined heading only vouches for the
 *      pairs it actually contains.
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
import { fileURLToPath, pathToFileURL } from 'node:url'

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

/** Every bundle in the workspace: `<dir>`, `<manifest>`. */
function collectBundles() {
  const dirs = execFileSync('ls', ['-1', join(ROOT, 'packages')], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const bundles = []
  for (const name of dirs) {
    const dir = join(ROOT, 'packages', name)
    const file = join(dir, 'package.json')
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    const meta = META.has(manifest.name) || manifest.dsh?.bundle?.patch === undefined
    if (!meta) bundles.push({ dir, manifest })
    const nested = join(dir, 'plugin', 'package.json')
    if (existsSync(nested)) {
      const nestedManifest = JSON.parse(readFileSync(nested, 'utf8'))
      if (nestedManifest.dsh?.bundle?.patch !== undefined || nestedManifest.name !== manifest.name) {
        bundles.push({ dir: join(dir, 'plugin'), manifest: nestedManifest })
      }
    }
  }
  return bundles
}

/** Crude but honest: does `range` admit the expected DSH minor line? */
function satisfiesRuntime(range) {
  const expected = EXPECTED_DSH_RANGE.replace(/^[\^~]/, '')
  if (range === '*' || range === 'x') return true
  return range.includes(expected) || /(\^|~|>=)\s*0\.2\./.test(range) || range === EXPECTED_DSH_RANGE
}

/**
 * Does one `###` heading line actually document name@ver? A heading may bundle
 * several releases (`### A 1.0 / B 2.0`); the name and the version must sit
 * adjacent inside the same `/`-separated segment, so a version belonging to a
 * different package can never vouch for this one.
 */
export function headingHasEntry(heading, name, ver) {
  for (const segment of heading.replace(/^###\s*/, '').split(/\s+\/\s+/)) {
    const idx = segment.indexOf(name)
    if (idx === -1) continue
    const rest = segment.slice(idx + name.length)
    const m = rest.match(/^\s*(?:\((?:bundle\s+)?)?(\d+\.[\w.-]+)/)
    if (m && m[1] === ver) return true
  }
  return false
}

/** Tags of `name` (name@version strings) with no CHANGELOG heading entry. */
export function missingChangelogEntries(name, tags, changelogText) {
  const headings = changelogText.split('\n').filter(line => line.startsWith('### '))
  return tags.filter(tag => {
    if (!tag.startsWith(name + '@')) return false
    const ver = tag.slice(name.length + 1)
    return !headings.some(heading => headingHasEntry(heading, name, ver))
  })
}

async function main() {
  const problems = []
  const notes = []
  const bundles = collectBundles()
  const changelogText = existsSync(join(ROOT, 'CHANGELOG.md')) ? readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8') : null

  for (const { dir, manifest } of bundles) {
    const rel = relative(ROOT, dir)
    const label = rel
    const name = manifest.name

    // 1. engines.dsh
    const dshRange = manifest.engines?.dsh
    if (typeof dshRange !== 'string' || dshRange.length === 0) {
      problems.push(label + ' (' + name + "): no engines.dsh - the host's compatibility check can never fire")
    } else if (!satisfiesRuntime(dshRange)) {
      problems.push(label + ' (' + name + '): engines.dsh "' + dshRange + '" does not admit the expected range ' + EXPECTED_DSH_RANGE)
    }

    // 2. a test script
    if (typeof manifest.scripts?.test !== 'string' || manifest.scripts.test.trim().length === 0) {
      problems.push(label + ' (' + name + '): no scripts.test - pnpm -r --if-present skips it silently')
    }

    // 3. version bump since the bundle's last tag
    if (options.bumpCheck && inGit) {
      const tag = name + '@' + manifest.version
      if (!tags.includes(tag)) {
        notes.push(label + ' (' + name + '): untagged version ' + manifest.version + ' (tag it as ' + tag + ' - see P0-3)')
      } else {
        const changed = git(['status', '--porcelain', '--', rel])
        if (changed !== null && changed.length > 0) {
          problems.push(label + ' (' + name + '): ' + tag + ' is tagged but the bundle has uncommitted changes - bump the version')
        }
      }
    }

    // 4. every tagged version has a CHANGELOG entry (root CHANGELOG.md)
    if (inGit && changelogText !== null) {
      for (const tag of missingChangelogEntries(name, tags, changelogText)) {
        problems.push(label + ' (' + name + '): tag ' + tag + ' has no CHANGELOG entry')
      }
    }
  }

  const result = { ok: problems.length === 0, bundles: bundles.length, problems, notes }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    for (const note of notes) console.log('  note ' + note)
    for (const problem of problems) console.log('  FAIL ' + problem)
    console.log(problems.length === 0 ? '\nbundles ok: ' + bundles.length + ' checked (engines.dsh, test script, version discipline, changelog)' : '\n' + problems.length + ' packaging problem(s)')
  }
  return problems.length === 0 ? 0 : 1
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().then(code => process.exit(code), error => {
    console.error(error)
    process.exit(1)
  })
}
