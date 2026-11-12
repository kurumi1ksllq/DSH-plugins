import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderDelegationText } from '../lib/delegation-text.mjs'

// ---------------------------------------------------------------------------
// #195: the delegation trigger must be COUNTABLE, not a feeling.
//
// Every assertion below is scoped to ONE bullet AND to the specific clause
// inside it. Two lessons from review of the first draft:
//   1. a regex over the whole document matches a sibling bullet and stays
//      green after the clause is deleted;
//   2. a test that only checks 'this bullet mentions delegation' passes even
//      when the sentence doing the work is gone. Deleting 'read is work too'
//      and 'the only unsplit case is one file' both stayed green at first.
// ---------------------------------------------------------------------------

/** The bullet that mentions `needle`, or null. Never falls back to the whole text. */
function bulletWith(text, needle) {
  return text.split('\n').find((line) => line.startsWith('- ') && line.includes(needle)) ?? null
}

/** Fail loudly when the bullet is missing instead of asserting against undefined. */
function requireBullet(text, needle, locale) {
  const bullet = bulletWith(text, needle)
  assert.ok(bullet, locale + ': no bullet mentions ' + JSON.stringify(needle))
  return bullet
}

test('the split trigger names countable thresholds in both locales', () => {
  const expectations = [
    ['zh', '分档', [/≥\s*3\s*个?文件/, /≥\s*2\s*个?(包|模块)/, /≥\s*2\s*个?(互不依赖的|独立)?验证/]],
    ['en', 'Lanes', [/(3|three)\s*(or\s*more\s*)?files?/i, /(2|two)\s*(or\s*more\s*)?(packages?|modules?)/i, /(2|two)\s*(or\s*more\s*)?independent\s*(verifications?|checks?)/i]],
  ]
  for (const [locale, needle, patterns] of expectations) {
    const bullet = requireBullet(renderDelegationText(locale), needle, locale)
    for (const pattern of patterns) {
      assert.match(bullet, pattern, locale + ': sizing must name a countable threshold (' + pattern + ')')
    }
  }
})

test('the sizing lane says a countable hit FORCES a split, not that it suggests one', () => {
  const zh = requireBullet(renderDelegationText('zh'), '分档', 'zh')
  assert.match(zh, /必须拆|就必须/, 'zh: a countable hit must be mandatory')
  const en = requireBullet(renderDelegationText('en'), 'Lanes', 'en')
  assert.match(en, /forces a split|must split/i, 'en: a countable hit must be mandatory')
})

test('the escape hatch names the excuse it refuses, in one bullet', () => {
  const zh = requireBullet(renderDelegationText('zh'), '逃生', 'zh')
  assert.match(zh, /先读|先看看|先摸清/, 'zh: must name the excuse it forbids')
  assert.match(zh, /不构成/, 'zh: must refuse it')
  const en = requireBullet(renderDelegationText('en'), 'escape hatch', 'en')
  assert.match(en, /read the code first|explore the repo/i, 'en: must name the excuse it forbids')
  assert.match(en, /not a reason to skip/i, 'en: must refuse it')
})

test('reading is explicitly counted as work that must be split (zh)', () => {
  // The clause this test exists for: without it, 'I will read the code first'
  // survives as an excuse because reading looks like preparation, not labour.
  const zh = requireBullet(renderDelegationText('zh'), '逃生', 'zh')
  assert.match(zh, /读也要分出去|读也要分/, 'zh: reading must be split too')
  assert.match(zh, /子 agent|subagent/, 'zh: reading goes to a child, not the lead')
})

test('reading is explicitly counted as work that must be split (en)', () => {
  const en = requireBullet(renderDelegationText('en'), 'escape hatch', 'en')
  assert.match(en, /reading is work too|hand each slice to a subagent/i, 'en: reading must be split too')
})

test('the sole unsplit case is stated, so "split everything" is not the rule either', () => {
  // A countable trigger with no stated exception invites splitting a one-file
  // typo fix into three subagents. The exception is part of the contract.
  const zh = requireBullet(renderDelegationText('zh'), '逃生', 'zh')
  assert.match(zh, /唯一可以不拆|只有一个可验收产出/, 'zh: the exception must be stated')
  assert.match(zh, /一个文件|文件内/, 'zh: the exception must be bounded to one file')
  const en = requireBullet(renderDelegationText('en'), 'escape hatch', 'en')
  assert.match(en, /only task that may stay unsplit|single verifiable deliverable/i, 'en: the exception must be stated')
})

test('both locales carry the escape-hatch clause, so neither drifts', () => {
  const zh = renderDelegationText('zh')
  const en = renderDelegationText('en')
  assert.ok(bulletWith(zh, '逃生'), 'zh: escape-hatch bullet present')
  assert.ok(bulletWith(en, 'escape hatch'), 'en: escape-hatch bullet present')
})
