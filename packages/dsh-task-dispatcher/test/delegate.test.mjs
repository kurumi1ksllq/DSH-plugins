import { test } from 'node:test'
import assert from 'node:assert/strict'

import { personaFromDocument, pickProvider, buildDelegationRequest } from '../lib/delegate.mjs'

// ---------------------------------------------------------------------------
// #194 ticket 2: 读角色 persona 原文 + 选委派后端。
// 每条都能反向验证 —— 把实现改坏,对应用例必须变红。
// ---------------------------------------------------------------------------

test('personaFromDocument returns the persona prefix from a declaration', () => {
  const yaml = [
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: |',
    '      You are a Senior Accessibility Architect.',
    '      Enforce WCAG 2.2.',
  ].join('\n')
  const text = personaFromDocument(yaml, (document) => [
    { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: document.split('prefix: |\n')[1].trim() } },
  ])
  assert.match(text, /Senior Accessibility Architect/)
  assert.match(text, /WCAG 2\.2/)
})

test('personaFromDocument returns empty when the declaration carries no persona', () => {
  const rows = [{ id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' }]
  assert.equal(personaFromDocument('anything', () => rows), '')
})

test('personaFromDocument ignores a persona row with a blank prefix', () => {
  const rows = [{ id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '   ' } }]
  assert.equal(personaFromDocument('anything', () => rows), '')
})

test('personaFromDocument reports unparsable YAML instead of returning nothing', () => {
  assert.throws(
    () => personaFromDocument('{{{', () => { throw new Error('bad indentation') }),
    /YAML[\s\S]*bad indentation/,
  )
})

test('pickProvider prefers spawn over a context-inheriting backend', () => {
  const subagents = {
    list: () => ['fork', 'spawn'],
    getProvider: (name) => ({ name, inheritsParentContext: name === 'fork' }),
  }
  assert.equal(pickProvider(subagents).name, 'spawn')
})

test('pickProvider falls back to the first fresh-context backend when spawn is absent', () => {
  const subagents = {
    list: () => ['fork', 'custom-spawn'],
    // A real registry answers undefined for an unregistered name.
    getProvider: (name) => (name === 'fork' || name === 'custom-spawn'
      ? { name, inheritsParentContext: name === 'fork' }
      : undefined),
  }
  assert.equal(pickProvider(subagents).name, 'custom-spawn')
})

test('pickProvider names the available backends when none can carry a role', () => {
  const subagents = { list: () => ['fork'], getProvider: (name) => ({ name, inheritsParentContext: true }) }
  assert.throws(() => pickProvider(subagents), /fork/)
})

test('buildDelegationRequest carries the role persona into the child prompt', () => {
  const request = buildDelegationRequest({ role: 'django-security', persona: 'You audit Django.', task: 'Check auth.' })
  const text = request.prompt[0].text
  assert.match(text, /You audit Django\./)
  assert.match(text, /Check auth\./)
  assert.match(text, /django-security/)
})

