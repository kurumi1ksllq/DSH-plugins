import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, HANDOFF_MAX_CHARS } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'
import { LOADER } from '../lib/catalog-hint.mjs'

function skillRow(name, { content = 'body', modelInvocable = true } = {}) {
  return { name, description: name + ' description. More detail.', provider: 'filesystem', content, invocation: { modelInvocable } }
}

function stubSkills(rows) {
  const all = rows ?? [skillRow('dev-flow'), skillRow('security-review')]
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

function harness({ officialSkill = false, skills = stubSkills(), workspaceFails = false } = {}) {
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
    workingDirectory: {
      ensure() { return workspaceFails ? Promise.reject(new Error('no workspace')) : Promise.resolve('/work') },
    },
    tools: {
      get(name) { return officialSkill && name === 'skill' ? { name: 'skill' } : undefined },
      register(definition, options) { registered.push({ definition, options }); return () => {} },
    },
  }
  apply({ inject(_deps, callback) { callback(scope) } })
  const entry = registered.find((row) => row.definition.name === LOADER)
  return {
    sections,
    contexts,
    registered,
    get loader() { return entry?.definition },
    get registerOptions() { return entry?.options },
    get listener() { return listener },
  }
}

const newAgent = () => ({ session: { seq: 0, eventAt: () => undefined } })
const userText = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const next = () => ({ kind: 'enter', messages: [] })
const step = (h, agent, text) => h.listener({ agent, messages: [userText(text)], signal: undefined }, next)
const call = (h, args) => h.loader.execute(args, { agent: newAgent(), signal: undefined })

test('registers the handoff protocol section', () => {
  const h = harness()
  const row = h.sections.find((entry) => entry.name === 'dsh:skill-surface-handoff')
  assert.equal(row.order, 20100)
  assert.equal(row.text(), row.text(), 'constant text keeps the prompt cache warm')
})

test('A0: an agent that already has the official loader gets no hint at all', () => {
  const h = harness({ officialSkill: true })
  const hint = h.contexts.find((entry) => entry.name === 'dsh:skill-surface-fallback-hint')
  assert.equal(hint.text({ scope: newAgent() }), '')
  assert.equal(hint.text({ scope: undefined }), '', 'a host-level assembly has no agent to advise')
})

test('A1: an agent with no official loader gets a short hint naming the fallback loader', () => {
  const h = harness()
  const hint = h.contexts.find((entry) => entry.name === 'dsh:skill-surface-fallback-hint')
  const text = hint.text({ scope: newAgent() })
  assert.match(text, new RegExp(LOADER))
  assert.ok(text.split('\n').length <= 12)
})

test('A0b: the fallback loader is gated per agent, not registered for everyone', () => {
  // Axis review of #160: a global tool would also land in agents that already
  // have the official one — the same shape of mistake as #159.
  const gated = harness({ officialSkill: true })
  assert.equal(typeof gated.registerOptions?.when, 'function', 'register must receive a when gate')
  assert.equal(gated.registerOptions.when({ agent: newAgent() }), false, 'hidden where an official skill tool exists')

  const open = harness()
  assert.equal(open.registerOptions.when({ agent: newAgent() }), true, 'visible where nothing else provides one')
})

test('A2: the loader lists skills, and a query narrows the listing', async () => {
  stubHost()
  const h = harness()
  const listed = await call(h, {})
  assert.match(listed.text, /可用技能 2 个/u)
  assert.match(listed.text, /dev-flow/)
  assert.match(listed.text, /security-review/)

  const filtered = await call(h, { query: 'security' })
  assert.match(filtered.text, /可用技能 1 个/u)
  assert.match(filtered.text, /security-review/)
  assert.doesNotMatch(filtered.text, /dev-flow/)
})

test('A2: nothing is invisible — rows beyond the described cap are still named', async () => {
  stubHost()
  const many = Array.from({ length: 260 }, (_, index) => skillRow(`s` + String(index).padStart(3, '0')))
  const h = harness({ skills: stubSkills(many) })
  const listed = await call(h, {})
  assert.match(listed.text, /可用技能 260 个/u)
  assert.match(listed.text, /其余 60 个/u, 'the tail is named instead of dropped')
  assert.match(listed.text, /s259/)
})

test('A2: the loader renders one body when given a name, capped at the budget', async () => {
  stubHost()
  const h = harness()
  const loaded = await call(h, { name: 'dev-flow' })
  assert.match(loaded.text, /^<skill_content name="dev-flow">/)

  const huge = harness({ skills: stubSkills([skillRow('dev-flow', { content: 'x'.repeat(HANDOFF_MAX_CHARS + 10) })]) })
  const capped = await call(huge, { name: 'dev-flow' })
  assert.ok(capped.text.length < HANDOFF_MAX_CHARS + 200)
  assert.match(capped.text, /body truncated/u)
})

test('A2: an unknown name or an opted-out skill fails loudly', async () => {
  stubHost()
  const h = harness()
  await assert.rejects(() => call(h, { name: 'ghost' }), /unknown skill/)
  const optOut = harness({ skills: stubSkills([skillRow('secret-one', { modelInvocable: false })]) })
  await assert.rejects(() => call(optOut, { name: 'secret-one' }), /not available for model invocation/)
})

test('A2: an unreadable workspace surfaces instead of resolving against a guess', async () => {
  stubHost()
  const h = harness({ workspaceFails: true })
  await assert.rejects(() => call(h, {}), /no workspace/)
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

test('a skill that opted out of model invocation is skipped by the handoff', async () => {
  stubHost()
  const h = harness({ skills: stubSkills([skillRow('secret-one', { modelInvocable: false })]) })
  const decision = await step(h, newAgent(), 'skills: secret-one')
  assert.equal(decision.messages.length, 0)
})

test('an unreadable workspace costs the handoff, never the child turn', async () => {
  stubHost()
  const h = harness({ workspaceFails: true })
  const original = next()
  const decision = await h.listener({ agent: newAgent(), messages: [userText('skills: dev-flow')], signal: undefined }, () => original)
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 0)
})

test('one body per name at most once', async () => {
  stubHost()
  const h = harness()
  const agent = newAgent()
  assert.equal((await step(h, agent, 'skills: dev-flow')).messages.length, 1)
  assert.equal((await step(h, agent, 'skills: dev-flow')).messages.length, 0)
})

test('a long handoff is capped so one line cannot flood the child context', async () => {
  stubHost()
  const many = Array.from({ length: 9 }, (_, index) => skillRow(`s` + index))
  const h = harness({ skills: stubSkills(many) })
  const decision = await step(h, newAgent(), 'skills: ' + many.map((row) => row.name).join(', '))
  assert.equal(decision.messages.length, 6)
})

test('the injected body budget is enforced', async () => {
  stubHost()
  const h = harness({ skills: stubSkills([skillRow('dev-flow', { content: 'x'.repeat(HANDOFF_MAX_CHARS) })]) })
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
