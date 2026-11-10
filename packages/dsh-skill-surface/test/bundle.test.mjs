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

test('patch adds the official PROVIDER under a new id and a distinct provider name', async () => {
  const patch = await readFile(join(PKG, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- id: skill-filesystem-global\b/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-skill-filesystem'/)
  assert.match(patch, /providerName: skill-surface-filesystem/, 'a distinct provider name removes cross-layer ambiguity')
  assert.match(patch, /- id: skill-surface\b/)
  assert.match(patch, /name: 'dsh-skill-surface'/)
  assert.doesNotMatch(patch, /- id: skill-filesystem$/m, 'the preset-owned row id must not be reused')
})

test('the patch NEVER mounts a second tool-skill (#159 regression)', async () => {
  // A shadowed tool-skill publishes an EMPTY catalog claiming to replace every
  // earlier list (dsh-tool-skill:935-941). Mounting it here erased the live
  // 270-entry catalog for standard/ptc sessions. This assertion is the guard.
  const patch = await readFile(join(PKG, 'cordis.patch.yml'), 'utf8')
  // Anchor on YAML structure, not prose: the comment above explains the trap on purpose.
  assert.doesNotMatch(patch, /name:\s*'@deepseek-ai\/dsh-tool-skill'/, 'mounting the official catalog publisher again must never happen')
  assert.doesNotMatch(patch, /^\s*- id: tool-skill(-global)?\s*$/m, 'tool-skill is preset-owned; this bundle must not add a row')
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
