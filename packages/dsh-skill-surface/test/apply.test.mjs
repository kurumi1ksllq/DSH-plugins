import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'

const FAKE_SKILLS = {
  'dev-flow': { name: 'dev-flow', provider: 'filesystem', content: 'follow the flow', invocation: { modelInvocable: true } },
  'secret-one': { name: 'secret-one', provider: 'filesystem', content: 'nope', invocation: { modelInvocable: false } },
}

function harness() {
  const sections = []
  let listener
  let lookups = []
  const recorded = []
  const ctx = {
    inject(deps, callback) {
      recorded.push(deps)
      const scope = {
        effect(factory) { return factory() },
        systemPrompt: { section(row) { sections.push(row); return () => {} } },
        on(_event, fn) { listener = fn; return () => {} },
        skills: { get(name, options) { lookups.push([name, options]); return Promise.resolve(FAKE_SKILLS[name]) } },
        workingDirectory: { ensure() { return Promise.resolve('/work') } },
      }
      callback(scope)
    },
  }
  apply(ctx)
  return { sections, recorded, get listener() { return listener }, lookups }
}

const userText = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const next = () => ({ kind: 'enter', messages: [] })
const agent = { session: { seq: 0, eventAt: () => undefined } }

test('registers a constant section and an agent-scoped step listener', () => {
  const h = harness()
  assert.deepEqual(h.recorded, [['systemPrompt'], ['skills', 'workingDirectory']])
  assert.equal(h.sections.length, 1)
  const [row] = h.sections
  assert.equal(row.name, 'dsh:skill-surface-handoff')
  assert.equal(row.order, 20100, 'after the order-20000 exec-discipline section')
  assert.equal(row.text(), row.text(), 'the section text is constant so the prompt cache stays warm')
  assert.equal(typeof h.listener, 'function')
})

test('a handoff line turns into one official skill-body injection per name', async () => {
  setHostApi({
    renderSkillContent: (skill) => `<skill_content name="` + skill.name + `">` + skill.content + `</skill_content>`,
    createUserMessage: ({ content, source }) => ({ role: 'user', content, source }),
  })
  const h = harness()
  const decision = await h.listener(
    { agent, messages: [userText('fix the parser\nskills: dev-flow')], signal: undefined },
    next,
  )
  assert.equal(decision.messages.length, 1)
  const [message] = decision.messages
  assert.equal(message.source.kind, 'skill-invocation', 'reuses the official invocation source')
  assert.equal(message.source.name, 'dev-flow')
  assert.equal(message.source.form, 'instructions')
  assert.match(message.content[0].text, /<skill_content name="dev-flow">/)
  assert.deepEqual(h.lookups.map(([name]) => name), ['dev-flow'], 'resolved once through the registry')
})

test('no handoff line means the step is untouched', async () => {
  const h = harness()
  const original = next()
  const decision = await h.listener({ agent, messages: [userText('just fix it')], signal: undefined }, () => original)
  assert.equal(decision, original, 'the decision object is passed through unchanged')
})

test('opt-out and unknown skills are skipped without failing the step', async () => {
  const h = harness()
  const decision = await h.listener(
    { agent, messages: [userText('skills: secret-one, ghost')], signal: undefined },
    next,
  )
  assert.equal(decision.messages.length, 0, 'a model-invocation opt-out and an unknown name inject nothing')
})

test('a rejected step is never augmented', async () => {
  const h = harness()
  const rejected = { kind: 'reject' }
  const decision = await h.listener({ agent, messages: [userText('skills: dev-flow')], signal: undefined }, () => rejected)
  assert.equal(decision, rejected)
})
