import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderProtocol } from '../lib/protocol.mjs'

test('both locales render the handoff section with the same shape', () => {
  const zh = renderProtocol('zh')
  const en = renderProtocol('en')
  for (const [locale, text] of [['zh', zh], ['en', en]]) {
    assert.ok(text.length > 300, `` + locale + ` text is substantive`)
    assert.match(text, /skills: a, b/, `` + locale + ` must state the handoff format`)
    assert.ok(text.trimEnd().split('\n').length >= 6, `` + locale + ` renders heading, bullets and footer`)
  }
  assert.equal(
    zh.split('\n').filter((line) => line.startsWith('- ')).length,
    en.split('\n').filter((line) => line.startsWith('- ')).length,
    'zh/en bullet counts match',
  )
  // An unknown locale falls back rather than rendering nothing.
  assert.equal(renderProtocol('fr'), zh)
})
