import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

import { selectRoles, BUILTIN_PRESETS, SYNONYMS } from '../lib/roles.mjs'
import { renderDelegationText } from '../lib/delegation-text.mjs'

// ---------------------------------------------------------------------------
// #210: every Chinese keyword the plugin advertises must actually find someone.
//
// #207 made role_search + delegate_role the ONLY way to give a child a specialist
// lens, which raised the bar on this table: a synonym that maps to a term that
// never appears in a role ID is a dead key, and the model that follows the
// injected text ends up empty-handed. Measured on the shipped roster before this
// fix: '迁移' -> 0 roles, '工程' -> 0 roles (migration/engineering occur only in
// descriptions, while mapped terms are matched against IDs by design).
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')
const ECC_PATCH = join(REPO, 'packages', 'ecc-agent-presets', 'cordis.patch.yml')

/**
 * The roster role_search sees at runtime: the ECC bundle PLUS the profile-resident
 * presets. Reading only the bundle made a legitimate id (planner) look absent, and
 * the test then 'proved' the wrong thing.
 * @returns {Promise<Array<{id: string, name: string, description: string}>>}
 */
async function liveRoster() {
  // Deliberately repo-local. The shipped ecc-agent-presets bundle is what a new
  // machine installs, so every keyword and every advertised example must resolve
  // against it alone. An earlier version also read the deployment profile
  // (~/.dsh/...): that passed locally and failed on CI, which is the same
  // 'works only on my machine' trap as a rule living in a global AGENTS.md.
  const doc = yaml.load(await readFile(ECC_PATCH, 'utf8'))
  return doc[0].insert.map((row) => ({
    id: row.config.id,
    name: row.config.name,
    description: row.config.description ?? '',
  }))
}

test('every advertised Chinese keyword finds at least one role', async () => {
  const roster = await liveRoster()
  const dead = []
  for (const key of Object.keys(SYNONYMS)) {
    if (selectRoles(roster, BUILTIN_PRESETS, key).length === 0) dead.push(key)
  }
  assert.deepEqual(
    dead,
    [],
    'these synonyms resolve to nothing on the live roster, so the injected text advertises a dead end: '
      + dead.join(', '),
  )
})

test('a synonym does not turn into a match-everything query', async () => {
  // The other failure mode: '工程' -> 'engineer' would hit 22 of 138 rows, which
  // makes the keyword useless in the opposite direction. Keep every key narrow
  // enough that it still discriminates.
  const roster = await liveRoster()
  const total = selectRoles(roster, BUILTIN_PRESETS).length
  const tooBroad = []
  for (const key of Object.keys(SYNONYMS)) {
    const hits = selectRoles(roster, BUILTIN_PRESETS, key).length
    if (hits > total / 3) tooBroad.push(key + '=' + hits + '/' + total)
  }
  assert.deepEqual(tooBroad, [], 'these synonyms match too much of the roster to be useful: ' + tooBroad.join(', '))
})

test('the injected text does not name a domain the roster cannot answer', async () => {
  // The text says 'role_search finds specialists for security review, ... ,
  // migrations'. If that noun has no roles behind it, the sentence teaches a
  // failed call. Pin the specific words the text advertises.
  const roster = await liveRoster()
  for (const [locale, words] of [
    ['zh', ['安全', '无障碍', '数据库', '测试', '重构', '迁移', '工程']],
    ['en', ['security', 'accessibility', 'database', 'test', 'refactor']],
  ]) {
    const text = renderDelegationText(locale)
    for (const word of words) {
      if (!text.includes(word)) continue
      assert.ok(
        selectRoles(roster, BUILTIN_PRESETS, word).length > 0,
        locale + ': the text names "' + word + '" but role_search finds nothing for it',
      )
    }
  }
})

test('the role examples cover building, reviewing and planning, not only review', async () => {
  // #210: six of the eight examples were reviewers/architects and none was an
  // implementation role, which reads as 'delegate so someone can critique it'
  // rather than 'delegate so the work gets done' -- the opposite of the ask.
  const ids = [...renderDelegationText('zh').matchAll(/^- `([a-z0-9][a-z0-9-]*)` → /gm)].map((m) => m[1])
  const roster = new Set((await liveRoster()).map((role) => role.id))
  for (const id of ids) assert.ok(roster.has(id), id + ' must exist in the live roster')

  // Deliberately narrow: 'e2e-runner' and 'refactor-cleaner' are not
  // implementation roles, and matching them made the first version of this
  // assertion green while six of eight examples were still reviewers.
  const buckets = {
    review: /reviewer|auditor/i,
    build: /developer|builder|engineer/i,
    plan: /architect|planner/i,
  }
  for (const [name, pattern] of Object.entries(buckets)) {
    assert.ok(
      ids.some((id) => pattern.test(id)),
      'the example set must include at least one ' + name + ' role; got ' + ids.join(', '),
    )
  }
})

test('the repo front page does not advertise the removed agent_preset path', async () => {
  // The root README is the first thing a reader sees; it kept telling the model
  // to pick agent_preset for two commits after the package README documented the
  // removal. docs-contract pins plugin counts and links, not wording.
  const readme = await readFile(join(REPO, 'README.md'), 'utf8')
  assert.doesNotMatch(readme, /agent_preset/, 'the front page must not name the removed argument')
})
