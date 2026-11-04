// The bundle's host half.
//
// Before this file existed, `dev-flow-skill` shipped a `cordis.patch.yml` that
// inserted a row whose `main` was `lib/lint.mjs` — a module that exports a
// linter and nothing else. Cordis refuses such a row with "invalid plugin,
// expect function or object with an \"apply\" method", so a profile that
// installed the bundle failed at boot instead of gaining a skill. These tests
// hold the two halves of the fix: the module really is a plugin, and what it
// registers is the skill the flow documents.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as plugin from '../index.js'
import { lintSkill, REQUIRED_TRIGGERS } from '../lib/lint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const SKILL = readFileSync(join(PACKAGE_ROOT, 'SKILL.md'), 'utf8')

/** A context stub that records what the plugin asked the registry for. */
function makeContext({ withSkills = true } = {}) {
  const registered = []
  const warnings = []
  const ctx = {
    logger: { warn: (message) => warnings.push(message) },
  }
  if (withSkills) {
    ctx.skills = {
      register(skill) {
        registered.push(skill)
        return () => {}
      },
    }
  }
  return { ctx, registered, warnings }
}

describe('dev-flow-skill host plugin', () => {
  it('is loadable as a cordis plugin', () => {
    // The exact shape cordis accepts: a named plugin object with `apply`.
    assert.equal(typeof plugin.name, 'string')
    assert.equal(plugin.name, 'dev-flow-skill')
    assert.equal(typeof plugin.apply, 'function')
    assert.ok(Array.isArray(plugin.inject), 'inject must be an array')
    assert.deepEqual(plugin.inject, ['skills'])
  })

  it('registers the dev-flow skill under its kebab-case name', () => {
    const { ctx, registered } = makeContext()
    plugin.apply(ctx)
    assert.equal(registered.length, 1, 'exactly one skill registration')
    const skill = registered[0]
    assert.equal(skill.name, 'dev-flow')
    assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('registers a description that satisfies the skill contract linter', () => {
    const { ctx, registered } = makeContext()
    plugin.apply(ctx)
    const skill = registered[0]
    assert.equal(typeof skill.description, 'string')
    for (const trigger of REQUIRED_TRIGGERS) {
      assert.ok(skill.description.includes(trigger), `description must carry the trigger "${trigger}"`)
    }
  })

  it('registers the SKILL.md body itself, not a copy', () => {
    const { ctx, registered } = makeContext()
    plugin.apply(ctx)
    const skill = registered[0]
    // Body fidelity is the whole point: a second inlined copy would drift the
    // moment someone edits SKILL.md, and the linter would keep passing on the
    // stale one.
    assert.equal(skill.content, SKILL)
    assert.equal(lintSkill(skill.content).ok, true)
  })

  it('degrades with a warning when ctx.skills is absent instead of throwing', () => {
    // A profile that links this bundle without the skill registry would
    // otherwise fail at boot — a doc-only bundle must never be able to do that.
    const { ctx, registered, warnings } = makeContext({ withSkills: false })
    assert.doesNotThrow(() => plugin.apply(ctx))
    assert.equal(registered.length, 0)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /skills/i)
  })

  it('declares the skill file as a shipped artifact', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    assert.ok(Array.isArray(manifest.files), 'files must be a list')
    assert.ok(manifest.files.includes('SKILL.md'), 'SKILL.md must ship, or the body read fails after install')
    assert.ok(manifest.files.includes('index.js'), 'index.js must ship')
    assert.equal(manifest.main, 'index.js')
    assert.ok(manifest.exports['./lint'], 'the linter stays reachable as dev-flow-skill/lint')
  })
})
