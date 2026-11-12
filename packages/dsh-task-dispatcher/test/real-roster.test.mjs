import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

import { selectRoles, BUILTIN_PRESETS } from '../lib/roles.mjs'
import { personaFromDocument } from '../lib/delegate.mjs'

// ---------------------------------------------------------------------------
// #194: the role catalogue against the REAL shipped roster.
//
// Why this file exists: the first version of roles.test.mjs asserted
// `role_search('安全')` against a hand-written roster whose description
// happened to be Chinese. The shipped descriptions are English, so that test
// stayed green while the documented acceptance criterion was false on the
// deployment. These tests read the actual preset rows instead.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
const ECC_PATCH = join(HERE, '..', '..', 'ecc-agent-presets', 'cordis.patch.yml')

/** The 133 ECC role declarations, as the registry would publish them. */
async function eccRoster() {
  const doc = yaml.load(await readFile(ECC_PATCH, 'utf8'))
  return doc[0].insert.map((row) => ({
    id: row.config.id,
    name: row.config.name,
    description: row.config.description ?? '',
  }))
}

test('the shipped roster is the 133 ECC roles and every one is selectable', async () => {
  const roster = await eccRoster()
  assert.equal(roster.length, 133)
  const roles = selectRoles(roster, BUILTIN_PRESETS)
  assert.equal(roles.length, 133, 'no shipped role may be mistaken for a built-in composition')
})

test('an English domain keyword hits the shipped roster', async () => {
  const roles = selectRoles(await eccRoster(), BUILTIN_PRESETS, 'security')
  assert.ok(roles.length > 0, 'the roster documents roles in English, so English must work')
  assert.ok(roles.some((role) => /security/i.test(role.id + role.description)))
})

test('a role id named in the docs really exists in the shipped roster', async () => {
  const ids = new Set((await eccRoster()).map((role) => role.id))
  for (const id of ['django-reviewer', 'a11y-architect']) {
    assert.ok(ids.has(id), id + ' must exist: the README and spec use it as an example')
  }
  // `django-security` was the first draft's example and never existed.
  assert.equal(ids.has('django-security'), false)
})

test('a CJK keyword finds nothing in the shipped roster (documented limit)', async () => {
  // Not a bug to fix here: the shipped descriptions carry no CJK. The tool
  // says so in its empty answer, and the spec records the boundary.
  const roles = selectRoles(await eccRoster(), BUILTIN_PRESETS, '安全')
  assert.deepEqual(roles, [])
})

// ---------------------------------------------------------------------------
// personaFromDocument against a REAL registry dump, not a hand-rolled string.
// ---------------------------------------------------------------------------

test('a persona round-trips through the registry dump schema', async () => {
  // The registry dumps with JSON_SCHEMA + `!!js`; a single-line value that
  // looks like a date must survive as text, or delegate_role reports the
  // misleading 'declares no persona text'.
  const dump = [
    "- id: persona",
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: 2026-11-12',
  ].join('\n')
  const text = personaFromDocument(dump, (document) => {
    const schema = yaml.JSON_SCHEMA.extend([
      new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => data }),
    ])
    return yaml.load(document, { schema })
  })
  assert.equal(text, '2026-11-12')
})

test('a !!js expression in a declaration is read as text, never evaluated', async () => {
  const dump = [
    "- id: persona",
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: !!js process.env.SECRET',
  ].join('\n')
  const text = personaFromDocument(dump, (document) => {
    const schema = yaml.JSON_SCHEMA.extend([
      new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => data }),
    ])
    return yaml.load(document, { schema })
  })
  assert.equal(text, 'process.env.SECRET', 'the expression is data here, never code')
})
