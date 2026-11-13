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
  // Host-faithful: snapshot() returns SkillSummary rows and dsh-skill's toSummary
  // DROPS content. A stub that kept it hid a real bug where the single-hit path
  // rendered an empty body (found in review of #202).
  const toSummary = (skill) => {
    const { name, description, invocation, provider } = skill
    return { name, description, invocation, provider }
  }
  return {
    snapshot: () => Promise.resolve({ skills: all.map(toSummary), complete: true }),
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
  // Both mechanisms must hold for this to stay false: 注入 must be a weak word
  // (downgrade) AND the phrase must mute it (exclude). Broken either way -> red.
  const matches = matchDomains('改 dsh-skill-surface:支持委派时 skills: a,b 点名注入')
  assert.equal(matches.some((entry) => entry.domain.id === 'security'), false)
})

test('201-8b: bare 注入 with NO excluded phrase is still not a strong signal by itself', () => {
  // Isolates the strong->keyword downgrade: no phrase from the exclude list here,
  // so only the strong/keyword placement can keep this from firing.
  assert.equal(matchDomains('处理注入问题').some((e) => e.domain.id === 'security'), false)
})

test('201-9: a real attack word next to an excluded phrase still counts', () => {
  // The exclude list must not swallow the whole sentence: 鉴权 / 密钥 / 攻击短语
  // are unambiguous and must survive a neighbouring ctx.inject or 提示注入.
  for (const text of [
    '修复鉴权,顺带理顺 ctx.inject',
    '密钥泄露 和 提示注入',
    '修复提示注入漏洞,顺便加固鉴权',
    '做一次安全审计:依赖注入、命令注入都要查',
    '修复 SQL 注入漏洞,并理顺 ctx.inject 的依赖',
  ]) {
    assert.equal(matchDomains(text).some((e) => e.domain.id === 'security'), true, text)
  }
})

test('201-9b: an excluded phrase mutes the ambiguous word even when another weak word is present', () => {
  // 安全 + 注入 alone would reach the 2-hit threshold, so only muting can stop it.
  assert.equal(matchDomains('安全性检查 与 点名注入').some((e) => e.domain.id === 'security'), false)
})

test('201-9c: the no-space spelling of a real attack still reaches the security domain', () => {
  for (const text of ['处理 SQL注入', '修复 sql注入 漏洞', 'XSS注入 要防住']) {
    assert.equal(matchDomains(text).some((e) => e.domain.id === 'security'), true, text)
  }
})

test('201-10: real injection ATTACKS still reach the security domain', () => {
  for (const text of ['处理 SQL 注入', '防御命令注入', '鉴权与密钥泄露']) {
    assert.equal(matchDomains(text).some((e) => e.domain.id === 'security'), true, text)
  }
})

test('201-11: a single-hit body load is RECORDED, so a later nudge stays silent', async () => {
  stubHost()
  const h = harness()
  const agent = newAgent()
  await call(h, { query: 'alpha' }, agent)
  // The nudge reads injectedSkills(agent); if the body path forgot to record the
  // load, the nudge would repeat the same skill on the next step.
  const { injectedSkills } = await import('../lib/handoff.mjs')
  assert.equal(injectedSkills(agent).has('alpha-skill'), true)
})

test('201-12: two lexical hits where only one is model-invocable returns that one body', async () => {
  stubHost()
  const h = harness({
    skills: stubSkills([skillRow('alpha-hidden', { modelInvocable: false }), skillRow('alpha-open')]),
  })
  const result = await call(h, { query: 'alpha' })
  assert.match(result.text, /<skill_content name="alpha-open">/)
  assert.doesNotMatch(result.text, /alpha-hidden/)
})

test('201-13: a blank or absent query is a LIST request, never a body', async () => {
  stubHost()
  // A one-skill catalog is the trap: unfiltered matching makes it a "single hit".
  const h = harness({ skills: stubSkills([skillRow('only-skill')]) })
  for (const args of [{}, { query: '' }, { query: '   ' }]) {
    const result = await call(h, args)
    assert.match(result.text, /可用技能 1 个/u, JSON.stringify(args))
    assert.doesNotMatch(result.text, /<skill_content/)
  }
})

test('201-14: the refetched skill is re-checked for model invocation before its body is returned', async () => {
  stubHost()
  // The snapshot said invocable, the refetch says otherwise (policy can change
  // between the two calls). The body must not escape on the stale answer.
  const listed = skillRow('alpha-skill')
  const refetched = { ...skillRow('alpha-skill', { modelInvocable: false }), content: 'SECRET-BODY' }
  const h = harness({
    skills: {
      snapshot: () => Promise.resolve({ skills: [{ name: listed.name, description: listed.description, invocation: listed.invocation, provider: listed.provider }] }),
      get: () => Promise.resolve(refetched),
    },
  })
  const result = await call(h, { query: 'alpha' })
  assert.doesNotMatch(result.text, /SECRET-BODY/, 'a skill that is no longer invocable must not leak its body')
  assert.equal(result.text, '没有匹配的技能。换个说法再列一次,或直接按任务本身做。')
})
