// End-to-end guard for the same mistake (#161), using the host's own patch
// layer instead of a live profile: `applyPatches` from
// @deepseek-ai/cordis-plugin-include is the code that decided these rows were
// missing, so feeding it this package's file and an empty tree shows whether the
// rows really get added.
//
// Host-internal dependency, on purpose: the alternative is no proof at all. What
// it costs is written down in spec #161 §5 — the module path is the install
// tree, the symbol is an alias the host could rename, and the case can only run
// where the host is installed.
//
// Which is why the skip is not silent: when the runtime tree is present but the
// module cannot be resolved, that is a failure, not a skip. Only a checkout with
// no host at all (CI) skips, and it says so.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PATCH = readFileSync(join(HERE, '..', 'cordis.patch.yml'), 'utf8')
const RUNTIME = process.env.DSH_RUNTIME ?? '/opt/dsh-runtime/dshcli/lib/node_modules/@deepseek-ai/dsh/node_modules'
const RUNTIME_PRESENT = existsSync(join(RUNTIME, '@deepseek-ai/cordis-plugin-include'))
// An explicitly configured runtime that does not resolve is a broken guard, not
// an excuse to skip: whoever set DSH_RUNTIME wanted this case to run.
const RUNTIME_EXPLICIT = process.env.DSH_RUNTIME !== undefined

/** The pre-#161 file, kept as the negative case so the failure stays reproducible. */
const OLD_PATCH = ["- id: dev-flow", "  name: dev-flow", "- id: git-status", "  name: dev-flow/git-status", ""].join("\n")
const PROFILE_PATCH = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web', 'cordis.patch.yml')

/** Resolve the host's patch layer plus a YAML parser, or null. */
async function loadHost() {
  const candidates = [
    { include: '@deepseek-ai/cordis-plugin-include', yaml: 'yaml', manifest: '@deepseek-ai/cordis-plugin-include/package.json' },
    {
      include: join(RUNTIME, '@deepseek-ai/cordis-plugin-include/lib/index.js'),
      yaml: join(RUNTIME, 'yaml/dist/index.js'),
      manifest: join(RUNTIME, '@deepseek-ai/cordis-plugin-include/package.json'),
    },
  ]
  for (const candidate of candidates) {
    try {
      const [include, yaml, manifest] = await Promise.all([
        import(candidate.include),
        import(candidate.yaml),
        import(candidate.manifest, { with: { type: 'json' } }).catch(() => null),
      ])
      const apply = include.applyEntryPatches
      if (typeof apply !== 'function') continue
      return { apply, load: yaml.parse ?? yaml.default?.parse, version: manifest?.default?.version ?? 'unknown' }
    } catch {
      continue
    }
  }
  return null
}

describe('the host patch layer mounts both rows', () => {
  it('an empty tree gains the flow row and the board row, with no warning', async (t) => {
    const host = await loadHost()
    if (host === null) {
      if (RUNTIME_PRESENT || RUNTIME_EXPLICIT) {
        assert.fail('the host runtime is configured (' + RUNTIME + ') but its patch layer did not resolve — the guard would be silently dead')
      }
      t.diagnostic('host runtime absent at ' + RUNTIME + '; set DSH_RUNTIME to run this case')
      t.skip('no host runtime in this checkout')
      return
    }
    assert.match(String(host.version), /^1\./, 'applyEntryPatches semantics were validated on include@1.x; re-check on a major bump')
    const warnings = []
    const tree = host.apply([], host.load(PATCH), (format, ...args) => warnings.push(format + ' ' + args.join(' ')))
    assert.deepEqual(tree.map((entry) => entry.id), ['dev-flow', 'git-status'])
    assert.deepEqual(warnings, [], 'the patch must apply cleanly, got: ' + warnings.join(' | '))
  })

  it('a bare modification entry is what silently dropped the rows', async (t) => {
    const host = await loadHost()
    if (host === null) {
      if (RUNTIME_PRESENT || RUNTIME_EXPLICIT) assert.fail('host runtime configured but patch layer did not resolve')
      t.skip('no host runtime in this checkout')
      return
    }
    const warnings = []
    const tree = host.apply([], host.load(OLD_PATCH), (format, ...args) => warnings.push(format + ' ' + args.join(' ')))
    assert.equal(tree.length, 0, 'a bare entry adds no row')
    assert.match(warnings.join(' '), /not found/, 'the layer reports the miss — which is what dump-config showed')
  })

  it('does not replace or dedupe: an id already in the tree ends up twice', async (t) => {
    // Worth pinning because the obvious workaround — hand-adding the same row in
    // the profile patch — would mount the plugin twice instead of fixing it.
    const host = await loadHost()
    if (host === null) {
      if (RUNTIME_PRESENT || RUNTIME_EXPLICIT) assert.fail('host runtime configured but patch layer did not resolve')
      t.skip('no host runtime in this checkout')
      return
    }
    const tree = host.apply([{ id: 'dev-flow', name: 'dev-flow' }], host.load(PATCH), () => {})
    assert.deepEqual(tree.map((entry) => entry.id), ['dev-flow', 'dev-flow', 'git-status'])
  })

  it('the user profile layer does not declare these ids itself', (t) => {
    if (!existsSync(PROFILE_PATCH)) {
      t.skip('no web profile at ' + PROFILE_PATCH)
      return
    }
    const text = readFileSync(PROFILE_PATCH, 'utf8')
    for (const id of ['dev-flow', 'git-status']) {
      assert.equal(
        new RegExp('^\\s*- id: ' + id + '\\s*$', 'm').test(text),
        false,
        id + ' is already declared in the profile patch — insert would mount it twice',
      )
    }
  })
})
