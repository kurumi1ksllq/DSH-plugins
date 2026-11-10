import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HANDOFF_MAX, handoffNames, injectedSkills } from '../lib/handoff.mjs'

const userText = (text) => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

test('reads the handoff line and cleans the names', () => {
  assert.deepEqual(handoffNames([userText('do it\nskills: dev-flow, security-review')]), ['dev-flow', 'security-review'])
  // duplicates collapse in first-seen order; full-width commas and extra spaces are tolerated
  assert.deepEqual(handoffNames([userText('skills:  a,，a ,  b')]), ['a', 'b'])
})

test('only a line-leading token counts, so prose about the format never injects', () => {
  assert.deepEqual(handoffNames([userText('remember to write skills: dev-flow later')]), [])
  assert.deepEqual(handoffNames([userText('the docs say skills: foo')]), [])
  // a list marker in front of the token is still a handoff
  assert.deepEqual(handoffNames([userText('- skills: dev-flow')]), ['dev-flow'])
})

test('rejects names outside the public kebab-case grammar and caps the batch', () => {
  assert.deepEqual(handoffNames([userText('skills: Dev_Flow, ../etc, ok-name')]), ['ok-name'])
  const many = Array.from({ length: HANDOFF_MAX + 4 }, (_, i) => `s` + i).join(', ')
  assert.equal(handoffNames([userText(`skills: ` + many)]).length, HANDOFF_MAX)
})

test('only direct user input is read', () => {
  const assistantish = { source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'skills: dev-flow' }] }
  assert.deepEqual(handoffNames([assistantish]), [])
  assert.deepEqual(handoffNames([]), [])
  assert.deepEqual(handoffNames(undefined), [])
})

test('injection memory replays the session so a resumed agent is not injected twice', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'dev-flow' } } },
    { type: 'assistant/message', data: {} },
  ]
  const agent = { session: { seq: events.length, eventAt: (index) => events[index] } }
  const known = injectedSkills(agent)
  assert.ok(known.has('dev-flow'))
  assert.equal(injectedSkills(agent), known, 'the same set is reused for one agent')
})

test('an unreadable session degrades to memory-only instead of throwing', () => {
  const agent = { session: { seq: 5, eventAt: () => { throw new Error('branded seq only') } } }
  const known = injectedSkills(agent)
  assert.equal(known.size, 0)
  known.add('x')
  assert.ok(injectedSkills(agent).has('x'))
})
