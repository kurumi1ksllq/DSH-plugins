import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

import { renderDelegationText } from '../lib/delegation-text.mjs'

// ---------------------------------------------------------------------------
// #207: the injected text must not send the model down a dead path.
//
// Measured on this deployment (two live children, one per path):
//   subagent({})                        -> 56 tools, files present, no persona
//   subagent({agent_preset:'code-reviewer'}) -> 28 tools, NO read/write/edit/
//                                               glob/grep, NO persona
//   delegate_role({role:'code-reviewer'})    -> full toolset AND the persona
//
// The text used to carry a routing table telling the model to pick
// `agent_preset`, i.e. it advertised the shell-child path while the plugin's
// own README documented that path as broken. A model that follows the text gets
// a child that cannot work, which is exactly the "the feature does nothing"
// report. These tests pin the one surviving route.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
const ECC_PATCH = join(HERE, '..', '..', 'ecc-agent-presets', 'cordis.patch.yml')

/**
 * Every role id the shipped ECC bundle declares.
 *
 * The five profile-resident presets (planner/architect/code-reviewer/
 * security-reviewer/build-error-resolver) are NOT in this bundle, so the text
 * advertises examples from the 133 that ship here — the roster the operator
 * actually wants reachable. Keeping the assertion repo-local means it cannot
 * silently pass by reading a host path that happens to have the id.
 */
async function shippedRoleIds() {
  const doc = yaml.load(await readFile(ECC_PATCH, 'utf8'))
  return new Set(doc[0].insert.map((row) => row.config.id))
}

/** The role-example lines of the injected text: "- `<id>` → …". */
function roleExampleIds(text) {
  return [...text.matchAll(/^- `([a-z0-9][a-z0-9-]*)` → /gm)].map((match) => match[1])
}

test('the injected text never sends the model to the removed agent_preset path', () => {
  for (const locale of ['zh', 'en']) {
    const text = renderDelegationText(locale)
    assert.doesNotMatch(
      text,
      /agent_preset/,
      locale + ': naming agent_preset makes the model choose a child with no file tools',
    )
  }
})

test('role delegation is routed through role_search and delegate_role only', () => {
  for (const locale of ['zh', 'en']) {
    const text = renderDelegationText(locale)
    assert.match(text, /role_search/, locale + ': the discovery tool must be named')
    assert.match(text, /delegate_role/, locale + ': the delegation tool must be named')
  }
})

test('the text names role examples that exist in the shipped roster', async () => {
  const ids = await shippedRoleIds()
  const examples = roleExampleIds(renderDelegationText('zh'))
  assert.ok(examples.length >= 3, 'the text must show enough examples to make the choice concrete')
  for (const id of examples) {
    assert.ok(ids.has(id), id + ' is advertised in the injected text but is not in the shipped roster')
  }
  // zh and en must advertise the same roles: one table, two renderings.
  assert.deepEqual(roleExampleIds(renderDelegationText('en')), examples)
})

test('the text says how to reach the whole roster instead of listing five presets', async () => {
  const ids = await shippedRoleIds()
  const examples = roleExampleIds(renderDelegationText('zh'))
  assert.ok(
    examples.length < ids.size,
    'the table is examples, not a whitelist: ' + examples.length + ' of ' + ids.size,
  )
  // Scoped to the bullet that carries the instruction, not the whole document:
  // a document-wide regex stays green after the clause is gone, because a
  // sibling bullet often contains the same words (the lesson behind
  // bundle.test.mjs's bulletWith helper).
  for (const [locale, discovery] of [
    ['zh', /无 query|不带 query|不传 query|列出全部/],
    ['en', /no query|without a query|omit the query|every role/i],
  ]) {
    const bullet = renderDelegationText(locale)
      .split('\n')
      .find((line) => line.startsWith('- `role_search`'))
    assert.ok(bullet, locale + ': the enumeration rule must be its own role_search bullet')
    assert.match(bullet, discovery,
      locale + ': that bullet must say how to enumerate the rest of the roster')
  }
})
