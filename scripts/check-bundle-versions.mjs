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
 *   3. **a version bump** (P1-7) - a bundle whose SHIPPED files changed since its
 *      last release must declare a higher `version`. "Last release" means the newest
 *      tag whose commit declares that same version: three tags in this repository
 *      sit on a commit whose manifest still says the previous version, so the newest
 *      tag alone is not a safe baseline. Test-only changes are exempt.
 *   4. **a CHANGELOG entry** (T0.2/#99) - every tagged version is documented in
 *      the root CHANGELOG.md. Name and version must be adjacent inside one
 *      `/`-separated heading segment; a combined heading only vouches for the
 *      pairs it actually contains.
 *
 *   node scripts/check-bundle-versions.mjs [--root DIR] [--json] [--no-bump-check]
 *
 * Rule 3's baseline is the newest tag whose COMMIT declares that same version —
 * three tags here sit on a commit whose manifest still says the previous version,
 * so "the newest tag" alone is not a safe baseline. Test paths are exempt; a path
 * that ships (listed under `files`) is not, even when it lives under a test-like
 * directory. A package whose tags are ALL mis-tagged is reported as a problem, not
 * silently skipped. Rule 3 is skipped wholesale outside a git checkout.
 *
 * --root DIR checks a throwaway workspace instead of this repository, which is how
 * the rule-3 contract test avoids importing a private helper. Never writes.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(HERE, '..')

/**
 * `--root DIR`: check a throwaway workspace instead of this repository.
 *
 * Rule 3 must be provable with PUBLIC behaviour: build a workspace with real
 * git history, run the script, read the exit code. Without this flag the only
 * way to test it is importing a private helper, which this repository forbids.
 * Mirrors scripts/verify-packages.mjs.
 */
function rootFromArgv(argv) {
  const at = argv.indexOf('--root')
  if (at === -1) return DEFAULT_ROOT
  const value = argv[at + 1]
  if (value === undefined) throw new Error('--root needs a directory')
  return resolve(value)
}
const ROOT = rootFromArgv(process.argv.slice(2))

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
/**
 * Is `a` a strictly higher version than `b`?
 *
 * Plain numeric comparison of the dotted parts; enough for this workspace's
 * `MAJOR.MINOR.PATCH` versions and avoids pulling a semver dependency into a
 * verify script. A downgrade counts as "not higher", which is the point.
 */
function isHigherVersion(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const [l, r] = [x[i] ?? 0, y[i] ?? 0]
    if (l !== r) return l > r
  }
  return false
}

/**
 * Is this path a test artefact that needs no version bump?
 *
 * `files` wins: a directory that ships (dsh-deep-ptc-mode publishes test-governor/)
 * carries its tests with it, so "it lives under test/" is not enough to be exempt.
 */
function isTestPath(path, manifest) {
  if (shipsPath(manifest, path)) return false
  const segments = path.split('/')
  if (segments.includes('test') || segments.includes('tests') || segments.includes('__tests__')) return true
  const base = segments[segments.length - 1]
  // The dots must be escaped: /.(test|spec).mjs$/ also matches lib/latest.mjs and
  // lib/contest.mjs, which would let a published file skip the bump by its name.
  return /\.(test|spec)\.mjs$/.test(base) || /^test-.*\.mjs$/.test(base)
}

/** Does `manifest.files` publish `path` (a repo-relative path under the bundle)? */
function shipsPath(manifest, path) {
  const files = manifest.files
  if (!Array.isArray(files)) return false
  const at = path.indexOf('/')
  const rest = at < 0 ? path : path.slice(path.indexOf('/', at + 1) + 1)
  const local = rest.length > 0 ? rest : path
  return files.some((entry) => {
    const trimmed = String(entry).replace(/^\.\//, '').replace(/\/$/, '')
    return local === trimmed || local.startsWith(trimmed + '/')
  })
}

/**
 * The newest tag for `name` whose COMMIT declares that same version.
 *
 * Three tags in this repository sit on a commit whose manifest still declares the
 * previous version (dsh-inventory@0.12.2 -> 0.12.1, two websearch ones). Taking the
 * newest tag blindly compares against the wrong version and turns a missing bump
 * into a pass, so a tag only counts as a baseline when it is self-consistent.
 */
function lastReleaseTag(name, rel) {
  const list = git(['tag', '--merged', 'HEAD', '--list', name + '@*', '--sort=-v:refname']) ?? ''
  for (const tag of list.split('\n').filter(Boolean)) {
    const declared = git(['show', tag + ':' + rel + '/package.json'])
    if (declared === null) continue
    try {
      const version = JSON.parse(declared).version
      if (tag === name + '@' + version) return { tag, version }
    } catch {
      // A malformed manifest at that tag cannot vouch for anything.
    }
  }
  return null
}

/** Paths under `rel` that differ from `baseline` (committed, dirty or untracked). */
function changedSince(baseline, rel) {
  const out = new Set()
  // --no-renames: with rename detection, `git mv lib/a.js test/a.test.mjs` collapses
  // into a single test path, so a published file could be moved into test/ to skip
  // the bump entirely.
  const diff = git(['diff', '--name-only', '--no-renames', baseline, '--', rel]) ?? ''
  for (const line of diff.split('\n').filter(Boolean)) out.add(line)
  const others = git(['ls-files', '--others', '--exclude-standard', '--', rel]) ?? ''
  for (const line of others.split('\n').filter(Boolean)) out.add(line)
  return [...out]
}
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

    // 3. version bump since the bundle's last RELEASE (a self-consistent tag)
    if (options.bumpCheck && inGit) {
      const baseline = lastReleaseTag(name, rel)
      if (baseline === null) {
        // Distinguish "never released" from "every tag is mis-tagged": the second
        // case is a real hole (no baseline means no gate), so it must be visible as
        // a problem rather than a note that does not affect the exit code.
        const anyTag = git(['tag', '--merged', 'HEAD', '--list', name + '@*']) ?? ''
        if (anyTag.length > 0) {
          problems.push(label + ' (' + name + '): every tag is mis-tagged (no tag matches the version its commit declares) - fix the tags or bump the version')
        } else {
          notes.push(label + ' (' + name + '): no release tag yet, bump check skipped')
        }
      } else {
        const changed = changedSince(baseline.tag, rel)
        const shipped = changed.filter((file) => !isTestPath(file, manifest))
        // Any version that is not HIGHER is a missed bump. `===` would let a
        // downgrade (1.0.0 -> 0.9.0) pass, which is the same defect in disguise.
        if (shipped.length > 0 && !isHigherVersion(manifest.version, baseline.version)) {
          problems.push(
            label + ' (' + name + '): shipped files changed since ' + baseline.tag + ' but the version is still ' + baseline.version + ' - bump the version',
          )
        }
      }
      const current = name + '@' + manifest.version
      if (!tags.includes(current)) {
        notes.push(label + ' (' + name + '): untagged version ' + manifest.version + ' (tag it as ' + current + ' - see P0-3)')
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
