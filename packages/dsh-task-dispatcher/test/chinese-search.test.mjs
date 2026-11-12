import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

import { selectRoles, BUILTIN_PRESETS, expandQuery, SYNONYMS } from '../lib/roles.mjs'
import { ENGLISH_BASELINE } from './fixtures/english-baseline.mjs'

// ---------------------------------------------------------------------------
// #196: Chinese keywords must reach the English roster.
//
// The shipped 133 ECC presets carry English ids and descriptions only (measured:
// '安全' appears zero times in ecc-agent-presets/cordis.patch.yml). Before this
// change role_search('安全') answered 'No role matched', which made the Chinese
// operator's first move fail.
//
// The mapping is DATA, so these tests read the REAL roster rather than a
// hand-written one: a synonym that maps to a word the roster never uses is
// useless, and a fake fixture would hide that.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
const ECC_PATCH = join(HERE, '..', '..', 'ecc-agent-presets', 'cordis.patch.yml')

async function eccRoster() {
  const doc = yaml.load(await readFile(ECC_PATCH, 'utf8'))
  return doc[0].insert.map((row) => ({
    id: row.config.id,
    name: row.config.name,
    description: row.config.description ?? '',
  }))
}

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

test('Chinese keywords hit the real shipped roster', async () => {
  const roster = await eccRoster()
  const cases = [
    ['安全', /secur/i],
    ['无障碍', /a11y|accessib/i],
    ['数据库', /database|sql|postgres/i],
    ['测试', /test/i],
    ['文档', /doc/i],
    ['性能', /performance|perf/i],
  ]
  for (const [query, expectation] of cases) {
    const roles = selectRoles(roster, BUILTIN_PRESETS, query)
    assert.ok(roles.length > 0, '中文查询 ' + query + ' 在真实名册上必须命中')
    assert.ok(
      roles.some((role) => expectation.test(role.id + ' ' + role.description)),
      query + ' 的命中里必须有匹配 ' + expectation + ' 的角色,实际: ' + roles.slice(0, 3).map((r) => r.id).join(','),
    )
  }
})

test('an unmapped Chinese query still answers honestly with no match', async () => {
  const roster = await eccRoster()
  assert.deepEqual(selectRoles(roster, BUILTIN_PRESETS, '量子纠缠'), [])
})

test('mixed Chinese and English terms keep OR semantics', async () => {
  const roster = await eccRoster()
  const mixed = selectRoles(roster, BUILTIN_PRESETS, '无障碍 django')
  const a11y = selectRoles(roster, BUILTIN_PRESETS, '无障碍')
  const django = selectRoles(roster, BUILTIN_PRESETS, 'django')
  const union = new Set([...a11y, ...django].map((role) => role.id))
  assert.equal(mixed.length, union.size, 'mixed query must equal the union of its parts')
})

test('English queries return exactly what main returned before the mapping', async () => {
  // Regression lock with a RECORDED baseline, not a self-comparison. The first
  // version asserted `f(q) === f(q)`, which cannot fail: truncating English
  // results to five entries stayed green (measured). The fixture holds main's
  // real answers for 22 queries.
  const roster = await eccRoster()
  for (const [query, expected] of Object.entries(ENGLISH_BASELINE)) {
    assert.deepEqual(
      selectRoles(roster, BUILTIN_PRESETS, query).map((role) => role.id),
      expected,
      'English query ' + JSON.stringify(query) + ' drifted from the main baseline',
    )
  }
})

test('a pure-ASCII query never enters the mapping branch', () => {
  // The mechanism, not just the outcome: expansion must be identity for ASCII.
  for (const query of ['security', 'django', 'a11y', 'review', 'test']) {
    assert.deepEqual(expandQuery(query), [query])
  }
})

// ---------------------------------------------------------------------------
// Review-hardening: the cases that stayed green when the implementation was
// broken. Both are about the mapping being USEFUL rather than merely present.
// ---------------------------------------------------------------------------

test('every mapped English term occurs in the shipped roster, at a word boundary', async () => {
  // Two review rounds hardened this:
  //   - `some` only proved 'at least one target occurs', which let the dead
  //     target 'backend' (0 occurrences) ship;
  //   - plain substring matching let 'api' match 'fastapi' and 'ci' match
  //     'specializing' (81 of 83 hits), producing confidently WRONG answers.
  // Every target must now occur at a word boundary.
  const roster = await eccRoster()
  const haystack = roster.map((role) => (role.id + ' ' + role.description).toLowerCase()).join('\n')
  const atBoundary = (term) => new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(haystack)
  for (const word of Object.keys(SYNONYMS)) {
    const terms = expandQuery(word).filter((term) => term !== word.toLowerCase())
    assert.ok(terms.length > 0, word + ' must map to at least one English term')
    const dead = terms.filter((term) => !atBoundary(term))
    assert.deepEqual(dead, [], word + ' has dead targets (zero word-boundary occurrences in the roster): ' + dead.join(','))
  }
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

// ---------------------------------------------------------------------------
// Semantic locks: 'the table has entries' is not 'the entries are right'.
//
// Axis-2 review swapped 后端 -> [frontend, react] and dropped devops/sre from 部署;
// both stayed green because the guard only checked that SOME target existed in
// the roster. These cases name the roles each concept MUST and MUST NOT reach.
// ---------------------------------------------------------------------------

test('each concept reaches its own specialists and not a neighbouring field', async () => {
  const roster = await eccRoster()
  const ids = (query) => selectRoles(roster, BUILTIN_PRESETS, query).map((role) => role.id)
  const cases = [
    { query: '后端', must: /api-platform|backend|server|platform-engineer/, mustNot: /frontend|react-reviewer|vue-reviewer/ },
    { query: '部署', must: /devops|sre|platform-engineer/, mustNot: /content-strategist|strategist/ },
    { query: '无障碍', must: /a11y|accessibility/, mustNot: /account-strategist/ },
    { query: '数据库', must: /database|sql|postgres/, mustNot: /content|marketing/ },
    { query: '安全', must: /security|secure/, mustNot: /anthropologist|geographer/ },
  ]
  for (const { query, must, mustNot } of cases) {
    const hits = ids(query)
    assert.ok(hits.length > 0, query + ' must return something')
    assert.ok(
      hits.some((id) => must.test(id)),
      query + ' must reach one of ' + must + ', got: ' + hits.slice(0, 6).join(','),
    )
    const wrong = hits.filter((id) => mustNot.test(id))
    assert.deepEqual(wrong, [], query + ' must not reach neighbouring fields: ' + wrong.join(','))
  }
})

test('a concept never reaches a role from an unrelated domain', async () => {
  // The substring era matched 'build' against 'anthropologist' (builds culturally
  // coherent societies) and 'rust' against 'kuaishou-strategist'.
  const roster = await eccRoster()
  const noise = /anthropologist|geographer|psychologist|strategist|account-|marketing|historian/
  for (const query of ['构建', '性能', '架构', '计划', '调试']) {
    const hits = selectRoles(roster, BUILTIN_PRESETS, query).map((role) => role.id)
    const wrong = hits.filter((id) => noise.test(id))
    assert.deepEqual(wrong, [], query + ' picked up unrelated domains: ' + wrong.join(','))
  }
})
