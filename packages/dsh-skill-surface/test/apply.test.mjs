import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, HANDOFF_MAX_CHARS } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'

/** Any requested name resolves, so a cap or dedupe assertion measures the code under test. */
function stubSkills(content = 'body') {
  return {
    get: (name) => Promise.resolve({
      name,
      provider: 'filesystem',
      content,
      invocation: { modelInvocable: true },
    }),
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

function harness(skills = stubSkills()) {
  const sections = []
  let listener
  const ctx = {
    inject(_deps, callback) {
      callback({
        effect(factory) { return factory() },
        logger: { warn() {} },
        systemPrompt: { section(row) { sections.push(row); return () => {} } },
        on(_event, fn) { listener = fn; return () => {} },
        skills,
        workingDirectory: { ensure() { return Promise.resolve('/work') } },
      })
    },
  }
  apply(ctx)
  return { sections, get listener() { return listener } }
}

/** A fresh agent per case: injection memory is per agent, so sharing one hides regressions. */
const newAgent = () => ({ session: { seq: 0, eventAt: () => undefined } })
const userText = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const next = () => ({ kind: 'enter', messages: [] })
const step = (h, agent, text) => h.listener({ agent, messages: [userText(text)], signal: undefined }, next)

test('registers a constant section used for the handoff protocol', () => {
  const h = harness()
  assert.equal(h.sections.length, 1)
  const [row] = h.sections
  assert.equal(row.name, 'dsh:skill-surface-handoff')
  assert.equal(row.order, 20100, 'after the order-20000 exec-discipline section')
  assert.equal(row.text(), row.text(), 'the section text is constant so the prompt cache stays warm')
  assert.equal(typeof h.listener, 'function')
})

test('a handoff line turns into one official skill-body injection per name', async () => {
  stubHost()
  const h = harness()
  const decision = await step(h, newAgent(), 'fix authz\nskills: dev-flow, security-review')
  assert.equal(decision.messages.length, 2, 'one message per named skill')
  for (const message of decision.messages) {
    assert.equal(message.source.kind, 'skill-invocation', 'reuses the official invocation source')
    assert.equal(message.source.form, 'instructions')
    assert.match(message.content[0].text, /<skill_content name="/)
  }
  assert.deepEqual(decision.messages.map((m) => m.source.name), ['dev-flow', 'security-review'])
})

test('no handoff line means the step is untouched', async () => {
  stubHost()
  const h = harness()
  const original = next()
  const decision = await h.listener({ agent: newAgent(), messages: [userText('just fix it')], signal: undefined }, () => original)
  assert.equal(decision, original)
})

test('a skill that opted out of model invocation is skipped', async () => {
  stubHost({ isModelInvocable: () => false })
  const h = harness()
  const decision = await step(h, newAgent(), 'skills: dev-flow')
  assert.equal(decision.messages.length, 0)
})

test('an unknown name injects nothing and does not fail the step', async () => {
  stubHost()
  const h = harness({ get: () => Promise.resolve(undefined) })
  const decision = await step(h, newAgent(), 'skills: ghost')
  assert.equal(decision.messages.length, 0)
})

test('a rejected step is never augmented', async () => {
  stubHost()
  const h = harness()
  const rejected = { kind: 'reject' }
  const decision = await h.listener({ agent: newAgent(), messages: [userText('skills: dev-flow')], signal: undefined }, () => rejected)
  assert.equal(decision, rejected)
})

test('one body per name at most once: repeating the same handoff injects nothing new', async () => {
  stubHost()
  const h = harness()
  const agent = newAgent()
  assert.equal((await step(h, agent, 'skills: dev-flow')).messages.length, 1)
  assert.equal((await step(h, agent, 'skills: dev-flow')).messages.length, 0, 'the same body is never injected twice')
})

test('a long handoff is capped, so one line cannot flood the child context', async () => {
  stubHost()
  const h = harness()
  const names = Array.from({ length: 9 }, (_, index) => `s` + index).join(', ')
  const decision = await step(h, newAgent(), `skills: ` + names)
  assert.equal(decision.messages.length, 6, 'nine requested names inject exactly six bodies')
})

test('the injected body budget is enforced, not just the name count', async () => {
  stubHost()
  const huge = 'x'.repeat(HANDOFF_MAX_CHARS)
  const h = harness(stubSkills(huge))
  const decision = await step(h, newAgent(), 'skills: dev-flow, security-review')
  assert.equal(decision.messages.length, 0, 'a body that alone exceeds the budget is not injected')
})

test('a failure while injecting costs the injection, never the child turn', async () => {
  // The listener runs inside the request waterfall: throwing here would end the
  // child's turn with no model reply.
  stubHost({ renderSkillContent: () => { throw new Error('host helper failed') } })
  const h = harness()
  const original = next()
  const decision = await h.listener({ agent: newAgent(), messages: [userText('skills: dev-flow')], signal: undefined }, () => original)
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 0)
})

test('an unreadable workspace costs the injection instead of guessing a cwd', async () => {
  stubHost()
  const h = harness()
  h.sections.length = 0
  // rebuild with a failing workingDirectory
  const ctx = {
    inject(_deps, callback) {
      callback({
        effect(factory) { return factory() },
        logger: { warn() {} },
        systemPrompt: { section(row) { h.sections.push(row); return () => {} } },
        on(_event, fn) { h.listenerRef = fn; return () => {} },
        skills: stubSkills(),
        workingDirectory: { ensure() { throw new Error('no workspace') } },
      })
    },
  }
  apply(ctx)
  const original = next()
  const decision = await h.listenerRef({ agent: newAgent(), messages: [userText('skills: dev-flow')], signal: undefined }, () => original)
  assert.equal(decision.messages.length, 0, 'a workspace-only skill must not be resolved against an unknown directory')
})
