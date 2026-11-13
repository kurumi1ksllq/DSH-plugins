import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'
import { LOADER } from '../lib/catalog-hint.mjs'
import { matchDomains } from '../lib/domains.mjs'

function skillRow(name, { content = 'body-of-' + name, modelInvocable = true } = {}) {
  return { name, description: name + ' description for the loader.', provider: 'filesystem', content, invocation: { modelInvocable } }
}

function stubSkills(rows) {
  const all = rows
  return {
    snapshot: () => Promise.resolve({ skills: all, complete: true }),
    get: (name) => Promise.resolve(all.find((skill) => skill.name === name)),
  }
}

function stubHost() {
  setHostApi({
    renderSkillContent: (skill) => '<skill_content name="' + skill.name + '">' + skill.content + '</skill_content>',
    isModelInvocable: (skill) => skill.invocation.modelInvocable === true,
    createUserMessage: ({ content, source }) => ({ role: 'user', content, source }),
  })
}

function harness({ skills = stubSkills([skillRow('alpha-skill'), skillRow('beta-skill'), skillRow('gamma-skill')]) } = {}) {
  const registered = []
  const scope = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    systemPrompt: { section: () => () => {}, context: () => () => {} },
    on: () => () => {},
    skills,
    workingDirectory: { ensure: () => Promise.resolve('/work') },
    tools: { get: () => undefined, register(definition, options) { registered.push({ definition, options }); return () => {} } },
  }
  apply({ inject(_deps, callback) { callback(scope) } })
  const entry = registered.find((row) => row.definition.name === LOADER)
  return {
    get loader() { return entry?.definition },
  }
}

const newAgent = () => ({ session: { seq: 0, eventAt: () => undefined } })
const call = (h, args, agent = newAgent()) => h.loader.execute(args, { agent, signal: undefined })

test('201-1: a query that resolves to exactly one skill returns that skill BODY, not a listing', async () => {
  stubHost()
  const h = harness()
  const result = await call(h, { query: 'alpha' })
  assert.match(result.text, /<skill_content name="alpha-skill">/, 'the body is returned, wrapped by the host renderer')
  assert.match(result.text, /body-of-alpha-skill/)
  assert.doesNotMatch(result.text, /可用技能/u, 'not a listing')
})

test('201-2: the single-hit body path obeys the same size cap as the name path', async () => {
  stubHost()
  const huge = 'x'.repeat(70000)
  const h = harness({ skills: stubSkills([skillRow('huge-skill', { content: huge })]) })
  const viaQuery = await call(h, { query: 'huge' })
  const viaName = await call(h, { name: 'huge-skill' })
  assert.match(viaQuery.text, /truncated at/, 'a single-hit query must not bypass the cap')
  assert.equal(viaQuery.text, viaName.text, 'query and name produce the same capped body for the same skill')
})

test('201-3: a query matching two or more skills still returns a LISTING', async () => {
  stubHost()
  const h = harness()
  const result = await call(h, { query: 'skill' })
  assert.match(result.text, /可用技能 3 个/u)
  assert.doesNotMatch(result.text, /<skill_content/)
})

test('201-4: a query matching nothing keeps the original hint', async () => {
  stubHost()
  const h = harness()
  const result = await call(h, { query: 'nothing-here-xyz' })
  assert.equal(result.text, '没有匹配的技能。换个说法再列一次,或直接按任务本身做。')
})

test('201-5: no query still returns the full listing', async () => {
  stubHost()
  const h = harness()
  const result = await call(h, {})
  assert.match(result.text, /可用技能 3 个/u)
})

test('201-6: an explicit name wins over a query', async () => {
  stubHost()
  const h = harness()
  const result = await call(h, { name: 'beta-skill', query: 'alpha' })
  assert.match(result.text, /<skill_content name="beta-skill">/)
})

test('201-7: a single-hit query on a non-invocable skill must not leak its body', async () => {
  stubHost()
  const h = harness({ skills: stubSkills([skillRow('hidden-skill', { modelInvocable: false }), skillRow('open-skill')]) })
  const result = await call(h, { query: 'hidden' })
  assert.doesNotMatch(result.text, /<skill_content name="hidden-skill"/)
  assert.equal(result.text, '没有匹配的技能。换个说法再列一次,或直接按任务本身做。')
})

test('201-8: the 点名注入 sense of 注入 no longer counts as a security signal on its own', () => {
  const matches = matchDomains('改 dsh-skill-surface:支持委派时 skills: a,b 点名注入')
  assert.equal(matches.some((entry) => entry.domain.id === 'security'), false)
})

test('201-8b: bare 注入 with NO excluded phrase is still not a strong signal by itself', () => {
  // Isolates the strong->keyword downgrade: no phrase from the exclude list here,
  // so only the strong/keyword placement can keep this from firing.
  assert.equal(matchDomains('处理注入问题').some((e) => e.domain.id === 'security'), false)
})

test('201-9: ctx.inject / 提示注入 are also excluded', () => {
  assert.equal(matchDomains('把 ctx.inject 的服务补上').some((e) => e.domain.id === 'security'), false)
  assert.equal(matchDomains('修一下提示注入的风险').some((e) => e.domain.id === 'security'), false)
})

test('201-9b: an excluded phrase wins even when another security word is present', () => {
  // Isolates the exclude mechanism: 安全 + 注入 alone would reach the 2-hit
  // threshold, so only the exclusion can stop this sentence from scoring.
  assert.equal(matchDomains('安全性检查 与 点名注入').some((e) => e.domain.id === 'security'), false)
})

test('201-10: real injection ATTACKS still reach the security domain', () => {
  for (const text of ['处理 SQL 注入', '防御命令注入', '鉴权与密钥泄露']) {
    assert.equal(matchDomains(text).some((e) => e.domain.id === 'security'), true, text)
  }
})
