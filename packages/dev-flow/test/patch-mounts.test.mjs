// End-to-end guard for the same mistake (#161), using the host's own patch
// layer instead of a live profile: `applyPatches` from
// @deepseek-ai/cordis-plugin-include is the code that decided these rows were
// missing, so feeding it this package's file and an empty tree shows whether the
// rows really get added — and the negative case shows what the broken shape did.
//
// Both the runtime module and a YAML parser live in the installed host tree;
// when either is absent (a bare checkout, CI without the install tree) the case
// skips rather than faking the answer.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PATCH = readFileSync(join(HERE, '..', 'cordis.patch.yml'), 'utf8')
const RUNTIME = process.env.DSH_RUNTIME ?? '/opt/dsh-runtime/dshcli/lib/node_modules/@deepseek-ai/dsh/node_modules'

/** Resolve the host's patch layer plus a YAML parser, or null. */
async function loadHost() {
  const candidates = [
    { include: '@deepseek-ai/cordis-plugin-include', yaml: 'yaml' },
    {
      include: join(RUNTIME, '@deepseek-ai/cordis-plugin-include/lib/index.js'),
      yaml: join(RUNTIME, 'yaml/dist/index.js'),
    },
  ]
  for (const candidate of candidates) {
    try {
      const [include, yaml] = await Promise.all([import(candidate.include), import(candidate.yaml)])
      if (typeof include.applyEntryPatches !== 'function') continue
      return { applyEntryPatches: include.applyEntryPatches, load: yaml.parse ?? yaml.default?.parse }
    } catch {
      continue
    }
  }
  return null
}

describe('the host patch layer mounts both rows (needs the runtime tree)', () => {
  it('an empty tree gains the flow row and the board row, with no warning', async (t) => {
    const host = await loadHost()
    if (host === null) {
      t.skip('cordis-plugin-include is not resolvable from here')
      return
    }
    const warnings = []
    const tree = host.applyEntryPatches([], host.load(PATCH), (format, ...args) => warnings.push(format + ' ' + args.join(' ')))
    assert.deepEqual(tree.map((entry) => entry.id), ['dev-flow', 'git-status'])
    assert.deepEqual(warnings, [], 'the patch must apply cleanly, got: ' + warnings.join(' | '))
  })

  it('a bare modification entry is what silently dropped the rows', async (t) => {
    const host = await loadHost()
    if (host === null) {
      t.skip('cordis-plugin-include is not resolvable from here')
      return
    }
    // The pre-#161 shape, kept as the negative case: applying it to a tree that
    // has no such entry mounts nothing and only warns.
    const warnings = []
    const tree = host.applyEntryPatches([], [{ id: 'dev-flow', name: 'dev-flow' }], (format, ...args) => warnings.push(format + ' ' + args.join(' ')))
    assert.equal(tree.length, 0, 'a bare entry adds no row')
    assert.match(warnings.join(' '), /not found/, 'the layer reports the miss — which is what dump-config showed')
  })
})
