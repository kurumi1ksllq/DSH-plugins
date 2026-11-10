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
  // A shadowed tool-skill publishes an EMPTY catalog that claims to replace every
  // earlier list (dsh-tool-skill:935-941), which erased the live 270-entry catalog
  // for standard/ptc sessions. This assertion is that incident's guard.
  //
  // Matched on NORMALIZED YAML, not on the serialized text: quote style, inline
  // maps and indentation must not be able to slip a row past the guard.
  const raw = await readFile(join(PKG, 'cordis.patch.yml'), 'utf8')
  const normalized = raw
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/u, '').trimEnd())
    .filter((line) => line !== '' && !line.trimStart().startsWith('#'))
    .join('\n')
    .replaceAll('"', "'")
    .replace(/\s+/gu, ' ')
  assert.doesNotMatch(normalized, /name: '@deepseek-ai\/dsh-tool-skill'/, 'mounting the official catalog publisher again must never happen')
  assert.doesNotMatch(normalized, /- id: tool-skill(-global)? /, 'tool-skill is preset-owned; this bundle must not add a row')
  assert.doesNotMatch(normalized, /id: tool-skill(-global)?[,}]/, 'inline-map rows count too')
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
