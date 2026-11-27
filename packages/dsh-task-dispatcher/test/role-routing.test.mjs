import { test } from 'node:test'
import assert from 'node:assert/strict'

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
//
// issue-279: the ecc-agent-presets roster bundle is gone, so the example ids no
// longer have a shipped roster to be checked against. What still holds without
// one — and what these tests pin — is the SHAPE of the routing: agent_preset is
// never named, both tools are, the example table stays a short example set, and
// the text tells the reader how to enumerate whatever roster the deployment has.
// ---------------------------------------------------------------------------

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

test('the text names a short example set, and zh and en agree on it', () => {
  // A lower bound alone is vacuous: listing every roster role would also pass.
  // Pin the band so the table stays a short set of examples.
  const examples = roleExampleIds(renderDelegationText('zh'))
  assert.ok(
    examples.length >= 3 && examples.length <= 12,
    'the role table must stay a short example set, got ' + examples.length,
  )
  // zh and en must advertise the same roles: one table, two renderings.
  assert.deepEqual(roleExampleIds(renderDelegationText('en')), examples)
})

test('the text says how to reach the whole roster instead of listing five presets', () => {
  const examples = roleExampleIds(renderDelegationText('zh'))
  assert.ok(examples.length >= 3, 'an enumeration pointer needs an example table to point away from')
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
