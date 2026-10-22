/**
 * Contract tests for @local/dsh-prompt-inject.
 *
 * These tests exercise the package without a real Harness runtime: a fake
 * `ctx.systemPrompt` records what `apply()` registers. They also validate the
 * package manifest, locale files and bundle patch structure, so a broken
 * package is caught before `plugin_manager install_bundle` is attempted.
 *
 * Run with: node --test prompt-inject/test/
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const read = (name) => readFileSync(join(pkgDir, name), 'utf8')

const plugin = await import(pathToFileURL(join(pkgDir, 'index.js')).href)

function fakeCtx() {
  const sections = []
  return {
    sections,
    ctx: {
      systemPrompt: {
        section(options) {
          sections.push(options)
          return () => {}
        },
      },
    },
  }
}

test('package manifest is a valid DSH bundle', () => {
  const pkg = JSON.parse(read('package.json'))

  assert.equal(pkg.name, '@local/dsh-prompt-inject')
  assert.equal(pkg.version, '0.1.0')
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'index.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(existsSync(join(pkgDir, pkg.dsh.bundle.patch)), 'bundle patch must exist')

  // Exported subpaths required by the task card.
  assert.equal(pkg.exports['.'], './index.js')
  assert.ok(pkg.exports['./locale/*.json'], 'locale export missing')
  assert.ok(pkg.exports['./icon'], 'icon export missing')

  // Every runtime file must be covered by "files" (locale glob counts).
  for (const required of ['index.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
    assert.ok(pkg.files.includes(required), `files must include ${required}`)
  }
  assert.ok(pkg.files.includes('locale/*.json'), 'files must include locale/*.json')
})

test('locale files carry real plugin metadata', () => {
  for (const locale of ['en', 'zh']) {
    const data = JSON.parse(read(`locale/${locale}.json`))
    assert.equal(typeof data.meta.title, 'string')
    assert.equal(typeof data.meta.description, 'string')
    assert.ok(data.meta.title.trim().length > 0, `${locale} title empty`)
    assert.ok(data.meta.description.trim().length > 0, `${locale} description empty`)
    assert.ok(data.meta.description.length > 20, `${locale} description looks like a placeholder`)
    assert.ok(/dsh-prompt-inject/.test(data.meta.title), `${locale} title should name the plugin`)
  }
})

test('bundle patch is a single insert row for the plugin', () => {
  const lines = read('cordis.patch.yml')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

  assert.equal(lines[0], '- insert:')
  assert.equal(lines[1], '    - id: prompt-inject')
  assert.equal(lines[2], '      name: "@local/dsh-prompt-inject"')
  assert.equal(lines.length, 3, 'patch must not add config overrides')
  for (const line of lines) {
    assert.ok(!line.includes('\t'), 'YAML must use spaces, not tabs')
  }
})

test('icon is a self-contained 64x64 SVG', () => {
  const svg = read('icon.svg')
  assert.match(svg, /^<svg[^>]*width="64"[^>]*height="64"/)
  assert.match(svg, /viewBox="0 0 64 64"/)
  // The xmlns URI is a namespace identifier, not a fetched resource; every
  // other http(s) reference would make the icon depend on the network.
  const withoutNamespace = svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '')
  assert.doesNotMatch(withoutNamespace, /https?:\/\//i, 'icon must not reference external resources')
})

test('exports the systemPrompt dependency and registers one literal section', () => {
  assert.ok(Array.isArray(plugin.inject))
  assert.deepEqual(plugin.inject, ['systemPrompt'])
  assert.equal(typeof plugin.apply, 'function')

  const { ctx, sections } = fakeCtx()
  plugin.apply(ctx, {})

  assert.equal(sections.length, 1)
  const [section] = sections
  assert.equal(section.name, 'demo:prompt-inject')
  assert.equal(section.order, 3500)
  assert.equal(section.interpolate, false, 'interpolate must be false')
  assert.equal(typeof section.text, 'string')
  assert.ok(section.text.includes('DSH-INJECT-7F3A-2026'), 'token missing from injected text')
  assert.ok(section.text.includes('dsh-prompt-inject'), 'text must name the injecting plugin')
  assert.ok(section.text.includes('注入令牌'), 'text must include the zh trigger')
  assert.ok(section.text.includes('injection token'), 'text must include the en trigger')
})

test('defaults apply when config is omitted, empty or null', () => {
  for (const [label, config] of [
    ['omitted', undefined],
    ['empty', {}],
    ['null', null],
  ]) {
    const { ctx, sections } = fakeCtx()
    assert.doesNotThrow(() => plugin.apply(ctx, config), `apply must accept ${label} config`)
    assert.equal(sections.length, 1)
    assert.equal(sections[0].name, 'demo:prompt-inject', `${label}: name default lost`)
    assert.equal(sections[0].order, 3500, `${label}: order default lost`)
  }
})

test('config overrides name, order and text; invalid values fall back', () => {
  {
    const { ctx, sections } = fakeCtx()
    plugin.apply(ctx, { name: 'custom:section', order: 1200, text: 'custom text' })
    assert.equal(sections[0].name, 'custom:section')
    assert.equal(sections[0].order, 1200)
    assert.equal(sections[0].text, 'custom text')
    assert.equal(sections[0].interpolate, false, 'interpolate stays false even on override')
  }
  {
    const { ctx, sections } = fakeCtx()
    plugin.apply(ctx, { name: '', order: Number.NaN, text: '' })
    assert.equal(sections[0].name, 'demo:prompt-inject')
    assert.equal(sections[0].order, 3500)
    assert.equal(sections[0].text, plugin.DEFAULT_TEXT)
  }
})

test('injected text keeps literal placeholders untouched', () => {
  const { ctx, sections } = fakeCtx()
  plugin.apply(ctx, { text: 'literal {{ not_a_placeholder }}' })
  assert.equal(sections[0].text, 'literal {{ not_a_placeholder }}')
  assert.equal(sections[0].interpolate, false)
})
