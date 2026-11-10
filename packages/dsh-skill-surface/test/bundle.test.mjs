import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE)

test('bundle manifest is a valid link-able bundle', async () => {
  const pkg = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-skill-surface')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'must declare dsh.bundle.patch')
  assert.match(pkg.engines?.dsh ?? '', /\^0\.2\.0/, 'engines.dsh must accommodate ^0.2.0')
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.length > 0, 'scripts.test must be non-empty')
  assert.ok(pkg.exports?.['./icon'], 'must export ./icon')
  assert.ok(pkg.files?.includes('locale/*.json'), 'files must list locale/*.json')
})

test('patch mounts the official rows under NEW ids and adds this plugin', async () => {
  const patch = await readFile(join(PKG, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- insert:/)
  // The official host rows are disabled upstream by row id; a new id is what
  // lets their providers land in the global layer instead of being dropped.
  for (const id of ['skill-filesystem-global', 'tool-skill-global', 'skill-surface']) {
    assert.match(patch, new RegExp(`- id: ` + id + `\\b`), `row ` + id + ` must be inserted`)
  }
  assert.match(patch, /name: '@deepseek-ai\/dsh-skill-filesystem'/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-tool-skill'/)
  assert.match(patch, /name: 'dsh-skill-surface'/)
  assert.match(patch, /catalogDescriptionMaxLength: 200/)
  // The old ids must NOT be reused: reusing them would inherit disabled: true.
  assert.doesNotMatch(patch, /- id: skill-filesystem$/m)
  assert.doesNotMatch(patch, /- id: tool-skill$/m)
})

test('index exports a name and apply function, and no Config', async () => {
  const mod = await import('../index.js')
  assert.equal(mod.name, 'dsh-skill-surface')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.Config, undefined, 'a config without a Config schema fails validation at load')
})

test('locale files exist and meta keys match across locales', async () => {
  const en = JSON.parse(await readFile(join(PKG, 'locale/en.json'), 'utf8'))
  const zh = JSON.parse(await readFile(join(PKG, 'locale/zh.json'), 'utf8'))
  for (const dict of [en, zh]) {
    assert.ok(dict.meta?.title, 'meta.title required')
    assert.ok(dict.meta?.description, 'meta.description required')
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en/zh key sets match')
})
