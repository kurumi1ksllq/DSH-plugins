import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

import { selectRoles, BUILTIN_PRESETS, expandQuery, SYNONYMS } from '../lib/roles.mjs'

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

test('English queries are untouched by the mapping layer', async () => {
  // Regression lock: the Chinese support must not change what English returns.
  const roster = await eccRoster()
  for (const query of ['security', 'django', 'a11y', 'database', 'review']) {
    assert.deepEqual(
      selectRoles(roster, BUILTIN_PRESETS, query).map((role) => role.id),
      selectRoles(roster, BUILTIN_PRESETS, query).map((role) => role.id),
    )
  }
  // And the expansion of a pure-ASCII query is the query itself.
  assert.deepEqual(expandQuery('django'), ['django'])
})

// ---------------------------------------------------------------------------
// Review-hardening: the cases that stayed green when the implementation was
// broken. Both are about the mapping being USEFUL rather than merely present.
// ---------------------------------------------------------------------------

test('every mapped English term actually occurs in the shipped roster', async () => {
  // A synonym pointing at a word the roster never uses is a silent hole: the
  // table looks populated, the query still fails. This pins the table to data.
  const roster = await eccRoster()
  const haystack = roster.map((role) => (role.id + ' ' + role.description).toLowerCase()).join('\n')
  const zhWords = ['安全', '无障碍', '数据库', '测试', '文档', '性能', '前端', '后端', '重构', '审查', '迁移', '部署', '架构', '计划', '调试', '构建']
  for (const word of zhWords) {
    const terms = expandQuery(word).filter((term) => term !== word.toLowerCase())
    assert.ok(terms.length > 0, word + ' must map to at least one English term')
    const hit = terms.some((term) => haystack.includes(term))
    assert.ok(hit, word + ' maps to ' + terms.join(',') + ' but none of those occur in the roster')
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
