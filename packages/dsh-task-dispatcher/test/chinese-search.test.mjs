import { test } from 'node:test'
import assert from 'node:assert/strict'

import { expandQuery, SYNONYMS } from '../lib/roles.mjs'

// ---------------------------------------------------------------------------
// #196: Chinese keywords must reach the English roster.
//
// issue-279: the ecc-agent-presets roster bundle this file used to read is gone,
// so the roster-dependent assertions (Chinese keywords hitting real rows, the
// English baseline, the dead-target scan) moved out with it — the synonym layer
// is DATA and its targets can only be validated against a roster a deployment
// actually has. What still holds roster-free is pinned here: the expansion
// function's contract, which is pure.
// ---------------------------------------------------------------------------

test('expandQuery maps a Chinese concept to English search terms', () => {
  const terms = expandQuery('安全')
  assert.ok(terms.length > 0, '安全 must expand to something')
  assert.ok(terms.some((term) => /secur/i.test(term)), '安全 must reach the security concept, got ' + terms.join(','))
})

test('expandQuery leaves an English term untouched', () => {
  assert.deepEqual(expandQuery('security'), ['security'])
})

test('expandQuery keeps unrelated Chinese words as-is when it has no mapping', () => {
  const terms = expandQuery('量子纠缠')
  assert.ok(terms.includes('量子纠缠'), 'an unmapped word must survive so the answer stays honest')
})

test('an ASCII-only term is never expanded, even if it contains a mapped word', () => {
  // Guards against the mapping layer leaking into English behaviour: a future
  // synonym key that happens to be ASCII must not silently rewrite queries.
  for (const term of ['security', 'django', 'a11y', 'review', 'test']) {
    assert.deepEqual(expandQuery(term), [term])
  }
})

test('expansion never drops the original term', () => {
  const terms = expandQuery('安全')
  assert.ok(terms.includes('安全'), 'the original must survive so an unmapped word still searches')
})

test('no synonym key is pure ASCII, so English queries cannot be rewritten', () => {
  // The ASCII fast path in expandTerm is a performance guard, not a correctness
  // boundary: today every key is Chinese, so an English term can never match one.
  // If a future contributor adds an ASCII key (e.g. 'test' -> ['testing']), the
  // fast path would silently stop protecting English queries and their results
  // would start changing. This test fails at that moment, before the drift ships.
  const keys = Object.keys(SYNONYMS)
  const ascii = keys.filter((key) => /^[\x00-\x7f]+$/.test(key))
  assert.deepEqual(ascii, [], 'synonym keys must be non-ASCII, got: ' + ascii.join(','))
})
