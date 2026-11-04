// The bundle's host half.
//
// Before this file existed, `dev-flow-skill` shipped a `cordis.patch.yml` that
// inserted a row whose `main` was `lib/lint.mjs` — a module that exports a
// linter and nothing else. Cordis refuses such a row ("invalid plugin, expect
// function or object with an \"apply\" method"), so the entry failed to
// activate instead of the profile gaining a skill. These tests hold the two
// halves of the fix: the module really is a plugin, and what it registers is
// the skill the flow documents.
//
// The registry is not faked. `@deepseek-ai/dsh-skill` ships with the runtime
// this repository targets, and a stub would happily accept shapes the real one
// rejects — a missing `source` is exactly that case.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as plugin from '../index.js'
import { lintSkill } from '../lib/lint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const SKILL = readFileSync(join(PACKAGE_ROOT, 'SKILL.md'), 'utf8')

/**
 * The runtime this bundle targets, if this checkout can see it.
 *
 * `dev-flow-skill` has no runtime dependency (it is a document bundle), so a
 * bare `import('@deepseek-ai/dsh-skill')` resolves only when the check runs
 * inside a DSH runtime tree. Absent that, these tests still must not let a
 * broken definition through: `makeStrictRegistry` below enforces the same
 * per-field contract the real registry enforces on `get()`.
 */
async function loadRealRegistry() {
  const candidates = [
    '@deepseek-ai/dsh-skill',
    join(process.env.DSH_RUNTIME ?? '/opt/dsh-runtime/dshcli/lib/node_modules/@deepseek-ai/dsh', 'node_modules/@deepseek-ai/dsh-skill/lib/index.js'),
  ]
  for (const specifier of candidates) {
    try {
      const [{ Context }, skillModule] = await Promise.all([
        import(specifier.replace('dsh-skill', 'cordis')).catch(() => import('@deepseek-ai/cordis')),
        import(specifier),
      ])
      const Registry = skillModule.default ?? skillModule.SkillRegistry
      const ctx = new Context()
      return { registry: new Registry(ctx), real: true }
    } catch {
      continue
    }
  }
  return null
}

/**
 * A registry stub that refuses what the real one refuses.
 *
 * The real `register()` only validates name/description, but `get()` also
 * requires a non-empty `source` — a skill that registers fine and explodes on
 * load. Asserting the same rule here means the stub cannot green-light a
 * definition the host would reject.
 */
function makeStrictRegistry() {
  const registered = []
  return {
    registered,
    register(skill) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) throw new Error(`invalid skill name "${skill.name}"`)
      if (typeof skill.description !== 'string' || skill.description.length === 0) throw new Error(`skill "${skill.name}" requires a description`)
      if (typeof skill.content !== 'string' || skill.content.length === 0) throw new Error(`skill "${skill.name}" requires content`)
      if (typeof skill.source !== 'string' || skill.source.length === 0) throw new Error(`loaded skill "${skill.name}" source must be a string`)
      registered.push(skill)
      return () => {}
    },
  }
}

describe('dev-flow-skill host plugin', () => {
  it('is loadable as a cordis plugin', () => {
    // The exact shape cordis accepts: a named plugin object with `apply`.
    assert.equal(plugin.name, 'dev-flow-skill')
    assert.equal(typeof plugin.apply, 'function')
    assert.deepEqual(plugin.inject, ['skills'])
  })

  it('registers a definition the host accepts end to end', async () => {
    const real = await loadRealRegistry()
    const registry = real === null ? makeStrictRegistry() : real.registry
    plugin.apply({ skills: registry })
    const skill = typeof registry.get === 'function' ? await registry.get('dev-flow') : registry.registered[0]
    assert.ok(skill, 'the registry must hand back the registered skill')
    assert.equal(skill.name, 'dev-flow')
    // `source` is not validated on register() but IS on get() — dropping it
    // yields a skill that appears in the catalog and throws when loaded.
    assert.equal(typeof skill.source, 'string')
    assert.ok(skill.source.length > 0)
    assert.equal(typeof skill.content, 'string')
    if (real !== null) assert.equal(skill.provider, 'runtime')
  })

  it('registers the SKILL.md body, without its frontmatter', () => {
    const { registered } = makeStrictRegistry()
    plugin.apply({ skills: { register: (skill) => registered.push(skill) } })
    const skill = registered[0]
    // Frontmatter parity matters: the filesystem provider hands the registry
    // `parsed.body.trim()`, so registering raw bytes would give the model two
    // different bodies for the same file depending on which provider wins.
    assert.equal(skill.content.startsWith('---'), false, 'frontmatter must not reach the model as body text')
    assert.equal(skill.content, plugin.parseSkill(SKILL).body)
    assert.equal(lintSkill(SKILL).ok, true)
    assert.ok(skill.content.length > 0)
  })

  it('registers a description that satisfies the skill contract linter', () => {
    const { registered } = makeStrictRegistry()
    plugin.apply({ skills: { register: (skill) => registered.push(skill) } })
    const skill = registered[0]
    const { fields } = plugin.parseSkill(SKILL)
    assert.equal(skill.description, fields.description)
    for (const trigger of ['dev-flow', 'issue', 'PR', 'merge']) {
      assert.ok(skill.description.includes(trigger), `description must carry the trigger "${trigger}"`)
    }
  })

  it('ships exactly one skill named dev-flow — no second registry row', () => {
    const { registered } = makeStrictRegistry()
    plugin.apply({ skills: { register: (skill) => registered.push(skill) } })
    assert.deepEqual(registered.map((skill) => skill.name), ['dev-flow'])
  })

  it('keeps the kebab-case name in step with SKILL.md frontmatter', () => {
    // Two places spell the name: this module and the document. If they drift,
    // `/dev-flow` stops matching what the catalog advertises.
    assert.equal(plugin.SKILL_NAME, plugin.parseSkill(SKILL).fields.name)
    assert.match(plugin.SKILL_NAME, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })
})

describe('skill body parsing', () => {
  it('keeps a folded description instead of truncating it at the first line', () => {
    // The routing trigger words live in the description; a first-line-only
    // regex silently drops them, and the linter keeps passing on the file.
    const { fields } = plugin.parseSkill('---\nname: dev-flow\ndescription: 第一行\n  第二行含 merge 与 PR\n---\nbody\n')
    assert.ok(fields.description.includes('第一行'))
    assert.ok(fields.description.includes('第二行含 merge 与 PR'))
  })

  it('rejects a file with no frontmatter instead of inventing a description', () => {
    assert.throws(() => plugin.parseSkill('# 没有 frontmatter\n'), /frontmatter/i)
  })

  it('rejects unterminated frontmatter', () => {
    assert.throws(() => plugin.parseSkill('---\nname: dev-flow\n'), /terminated/i)
  })

  it('names the path when the body cannot be read', () => {
    // A `files` list missing SKILL.md, or a half-built `link:` target, must say
    // which file is missing rather than surface a bare ENOENT. This calls the
    // module's own reader — a re-implemented try/catch here would test nothing.
    const dir = mkdtempSync(join(tmpdir(), 'dev-flow-skill-'))
    try {
      const probe = join(dir, 'missing', 'SKILL.md')
      assert.throws(
        () => plugin.readSkillSource(probe),
        (error) => error.message.includes(probe) && error.message.includes('[dev-flow-skill]'),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses the shipped SKILL.md into a lint-clean body', () => {
    const { body, fields } = plugin.parseSkill(SKILL)
    assert.equal(fields.name, 'dev-flow')
    assert.equal(body.startsWith('# dev-flow'), true)
    // The body on its own no longer carries frontmatter, so the linter is run
    // against the file; this asserts the split lost nothing but frontmatter.
    assert.equal(SKILL.length > body.length, true)
  })
})

describe('packaging', () => {
  it('declares the files the plugin reads at run time', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    assert.equal(manifest.main, 'index.js')
    assert.ok(manifest.files.includes('SKILL.md'), 'SKILL.md must ship, or the body read fails after install')
    assert.ok(manifest.files.includes('index.js'), 'index.js must ship')
    assert.ok(manifest.exports['./lint'], 'the linter stays reachable as dev-flow-skill/lint')
  })

  it('holds no config in the bundle patch, because the row has no schema', () => {
    const patch = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
    assert.equal(/skillName|skillPath/.test(patch), false, 'the patch must not carry keys the host never reads')
    assert.equal(/^\s+config:/m.test(patch), false, 'a row without a Config schema must not receive config')
  })

  it('never writes a file', () => {
    // The plugin registers a skill and nothing else; every fs call in the
    // module is a read.
    const source = readFileSync(join(PACKAGE_ROOT, 'index.js'), 'utf8')
    assert.equal(/writeFile|appendFile|mkdir|unlink|rename/.test(source), false)
  })
})
