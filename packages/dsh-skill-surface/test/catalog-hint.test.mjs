import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOADER, hintText, indexLine } from '../lib/catalog-hint.mjs'

test('the hint names the fallback loader and the handoff format', () => {
  const text = hintText()
  assert.match(text, new RegExp(LOADER), 'must name the loader it is introducing')
  assert.match(text, /skills: a, b/, 'must state the delegation handoff format')
  assert.ok(text.length < 600, 'the hint stays small enough to sit in every request')
})

test('the hint is constant, so it does not churn the prompt cache', () => {
  assert.equal(hintText(), hintText())
})

test('an index line is one bullet with the first sentence only', () => {
  const line = indexLine({ name: 'dev-flow', description: 'Runs the flow. Later detail.' })
  assert.equal(line, '- ' + String.fromCharCode(96) + 'dev-flow' + String.fromCharCode(96) + ': Runs the flow.')
})

test('long descriptions are truncated with an ellipsis', () => {
  const line = indexLine({ name: 'x', description: 'y'.repeat(200) }, 40)
  assert.ok(line.length <= 60)
  assert.ok(line.endsWith('…'))
})
