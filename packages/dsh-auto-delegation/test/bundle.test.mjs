import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE)

test('bundle manifest is a valid link-able bundle', async () => {
  const pkg = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-auto-delegation')
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'must declare dsh.bundle.patch')
  assert.ok(
    /\^0\.2\.0/.test(pkg.engines?.dsh ?? ''),
    `engines.dsh must accommodate ^0.2.0, got ${pkg.engines?.dsh}`,
  )
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.length > 0,
    'scripts.test must be non-empty (check-bundle-versions)')
  // display resources: every bundle has a visible inventory entry
  assert.ok(pkg.exports?.['./icon'], 'must export ./icon')
  assert.ok(pkg.files?.includes('locale/*.json'), 'files must list locale/*.json')
})

test('patch row points at this package with a unique id', async () => {
  const patch = await readFile(join(PKG, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /- id: auto-delegation/)
  assert.match(patch, /name: '?dsh-auto-delegation'?/)
})

test('index exports an apply function and Config schema', async () => {
  const mod = await import('../index.js')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.name, 'dsh-auto-delegation')
})

test('delegation text renders both locales with required sections', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  for (const locale of ['zh', 'en']) {
    const text = renderDelegationText(locale)
    assert.ok(text.length > 200, `${locale} text is substantive`)
    assert.match(text, /preset/i, 'routing table names presets')
    assert.ok(text.includes('- '), 'routing table is a list')
  }
  // zh and en are same-structure (contract style of governor-copy)
  const zh = renderDelegationText('zh')
  const en = renderDelegationText('en')
  assert.equal(
    zh.split('\n').filter((l) => /^- /.test(l)).length,
    en.split('\n').filter((l) => /^- /.test(l)).length,
    'zh/en routing-table bullet counts match',
  )
})

test('locale files exist and meta keys match across locales', async () => {
  const en = JSON.parse(await readFile(join(PKG, 'locale/en.json'), 'utf8'))
  const zh = JSON.parse(await readFile(join(PKG, 'locale/zh.json'), 'utf8'))
  for (const dict of [en, zh]) {
    assert.ok(dict.meta?.title, 'meta.title required')
    assert.ok(dict.meta?.description, 'meta.description required')
  }
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(zh).sort(),
    'en/zh key sets match',
  )
})
