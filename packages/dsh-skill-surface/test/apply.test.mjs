import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, HANDOFF_MAX_CHARS } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'
import { LOADER } from '../lib/catalog-hint.mjs'

function stubSkills(content = 'body', names = ['dev-flow', 'security-review']) {
  const all = names.map((name) => ({
    name,
    description: name + ' description. More detail.',
    provider: 'filesystem',
    content,
    invocation: { modelInvocable: true },
  }))
  return {
    snapshot: () => Promise.resolve({ skills: all, complete: true }),
    get: (name) => Promise.resolve(all.find((skill) => skill.name === name)),
  }
}

function stubHost(overrides = {}) {
  setHostApi({
    renderSkillContent: (skill) => `<skill_content name="` + skill.name + `">` + skill.content + `</skill_content>`,
    isModelInvocable: (skill) => skill.invocation.modelInvocable === true,
    createUserMessage: ({ content, source }) => ({ role: 'user', content, source }),
    ...overrides,
  })
}

function harness({ officialSkill = false, skills = stubSkills() } = {}) {
  const sections = []
  const contexts = []
  const registered = []
  let listener
  const scope = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    systemPrompt: {
      section(row) { sections.push(row); return () => {} },
      context(row) { contexts.push(row); return () => {} },
    },
    on(_event, fn) { listener = fn; return () => {} },
    skills,
    workingDirectory: { ensure() { return Promise.resolve('/work') } },
    tools: {
      get(name) { return officialSkill && name === 'skill' ? { name: 'skill' } : undefined },
      register(definition) { registered.push(definition); return () => {} },
    },
  }
  apply({ inject(_deps, callback) { callback(scope) } })
  const loader = registered.find((definition) => definition.name === LOADER)
  return { sections, contexts, registered, loader, get listener() { return listener } }
}

const newAgent = () => ({ session: { seq: 0, eventAt: () => undefined } })
const userText = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const next = () => ({ kind: 'enter', messages: [] })
const step = (h, agent, text) => h.listener({ agent, messages: [userText(text)], signal: undefined }, next)

test('registers the handoff protocol section', () => {
  const h = harness()
  assert.ok(h.sections.length >= 1)
  const row = h.sections.find((entry) => entry.name === 'dsh:skill-surface-handoff')
  assert.equal(row.order, 20100)
  assert.equal(row.text(), row.text(), 'constant text keeps the prompt cache warm')
})

test('A0: an agent that already has the official loader gets no hint at all', () => {
  const h = harness({ officialSkill: true })
  const hint = h.contexts.find((entry) => entry.name === 'dsh:skill-surface-fallback-hint')
  assert.ok(hint, 'the context is registered for every agent')
  assert.equal(hint.text({ scope: newAgent() }), '', 'and stays silent when a nearer skill tool exists')
  assert.equal(hint.text({ scope: undefined }), '', 'a host-level assembly has no agent to advise')
})

test('A1: an agent with no official loader gets a short hint naming the fallback loader', () => {
  const h = harness({ officialSkill: false })
  const hint = h.contexts.find((entry) => entry.name === 'dsh:skill-surface-fallback-hint')
  const text = hint.text({ scope: newAgent() })
  assert.match(text, new RegExp(LOADER))
  assert.ok(text.split('\n').length <= 12, 'the hint must stay small')
})

test('A2: the fallback loader lists skills when called without a name', async () => {
  stubHost()
  const h = harness()
  assert.ok(h.loader, 'skill_get is registered')
  const result = await h.loader.execute({}, { agent: newAgent(), signal: undefined })
  assert.match(result.text, /可用技能 2 个/u)
  assert.match(result.text, /dev-flow/)
  assert.match(result.text, /security-review/)
})

test('A2: the fallback loader renders one body when given a name', async () => {
  stubHost()
  const h = harness()
  const result = await h.loader.execute({ name: 'dev-flow' }, { agent: newAgent(), signal: undefined })
  assert.match(result.text, /^<skill_content name="dev-flow">/)
})

test('A2: an unknown name fails loudly instead of returning an empty body', async () => {
  stubHost()
  const h = harness()
  await assert.rejects(() => h.loader.execute({ name: 'ghost' }, { agent: newAgent(), signal: undefined }), /unknown skill/)
})

test('a handoff line turns into one official skill-body injection per name', async () => {
  stubHost()
  const h = harness()
  const decision = await step(h, newAgent(), 'fix authz\nskills: dev-flow, security-review')
  assert.equal(decision.messages.length, 2)
  for (const message of decision.messages) {
    assert.equal(message.source.kind, 'skill-invocation')
    assert.equal(message.source.form, 'instructions')
  }
})

test('no handoff line means the step is untouched', async () => {
  stubHost()
  const h = harness()
  const original = next()
  const decision = await h.listener({ agent: newAgent(), messages: [userText('just fix it')], signal: undefined }, () => original)
  assert.equal(decision, original)
})

test('one body per name at most once', async () => {
  stubHost()
  const h = harness()
  const agent = newAgent()
  assert.equal((await step(h, agent, 'skills: dev-flow')).messages.length, 1)
  assert.equal((await step(h, agent, 'skills: dev-flow')).messages.length, 0)
})

test('the injected body budget is enforced', async () => {
  stubHost()
  const h = harness({ skills: stubSkills('x'.repeat(HANDOFF_MAX_CHARS)) })
  const decision = await step(h, newAgent(), 'skills: dev-flow, security-review')
  assert.equal(decision.messages.length, 0)
})

test('a failure while injecting costs the injection, never the child turn', async () => {
  stubHost({ renderSkillContent: () => { throw new Error('host helper failed') } })
  const h = harness()
  const original = next()
  const decision = await h.listener({ agent: newAgent(), messages: [userText('skills: dev-flow')], signal: undefined }, () => original)
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 0)
})

test('a rejected step is never augmented', async () => {
  stubHost()
  const h = harness()
  const rejected = { kind: 'reject' }
  const decision = await h.listener({ agent: newAgent(), messages: [userText('skills: dev-flow')], signal: undefined }, () => rejected)
  assert.equal(decision, rejected)
})
