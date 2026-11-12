import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderDelegationText } from '../lib/delegation-text.mjs'

// ---------------------------------------------------------------------------
// #195: the delegation trigger must be COUNTABLE, not a feeling.
//
// Before this change the lane said '>=3 similar independent units', which is
// unmeasurable at the moment of deciding, and it left an escape hatch: 'let me
// read the code first'. Both are asserted per-bullet here, because a regex over
// the whole document matches sibling bullets and stays green after deletion.
// ---------------------------------------------------------------------------

/** The bullet that mentions `needle`, or null. */
function bulletWith(text, needle) {
  return text.split('\n').find((line) => line.startsWith('- ') && line.includes(needle)) ?? null
}

test('the split trigger names countable thresholds in both locales', () => {
  const expectations = [
    ['zh', '分档', [/≥\s*3\s*个?文件|3\s*个文件/, /≥\s*2\s*个?(包|模块)|2\s*个包/, /≥\s*2\s*个?(互不依赖的|独立)?验证|2\s*个(互不依赖|独立)/]],
    ['en', 'Lanes', [/(3|three)\s*(or\s*more\s*)?files?/i, /(2|two)\s*(or\s*more\s*)?(packages?|modules?)/i, /(2|two)\s*(or\s*more\s*)?independent\s*(verifications?|checks?)/i]],
  ]
  for (const [locale, needle, patterns] of expectations) {
    const bullet = bulletWith(renderDelegationText(locale), needle)
    assert.ok(bullet, locale + ': the sizing bullet must exist')
    for (const pattern of patterns) {
      assert.match(bullet, pattern, locale + ': sizing must name a countable threshold (' + pattern + ')')
    }
  }
})

test('the escape hatch is closed: reading around is not a reason to skip splitting', () => {
  const zh = bulletWith(renderDelegationText('zh'), '逃生') ?? renderDelegationText('zh')
  const en = renderDelegationText('en')
  // The clause must be present and must say the 'look first' excuse does not count.
  assert.match(zh, /先(读|看看|摸清)|探索.{0,10}不构成|不算拆解/i, 'zh: must name the excuse it forbids')
  assert.match(zh, /不(构成|算|是).{0,12}(理由|跳过)|不许|禁止/, 'zh: must say it is not a valid reason')
  assert.match(en, /read(ing)? around|look first|explor\w+ is not|not a reason to skip/i, 'en: must name the excuse it forbids')
})

test('the escape-hatch clause lives inside one bullet, not scattered', () => {
  const zhText = renderDelegationText('zh')
  const bullet = zhText.split('\n').find((line) => line.startsWith('- ') && /先(读|看看|摸清)/.test(line))
  assert.ok(bullet, 'zh: the excuse and its refusal must sit in the same bullet')
  assert.match(bullet, /不(构成|算|是)|不许|禁止/, 'zh: same bullet must also carry the refusal')
})

test('role delegation names its trigger words in both locales', () => {
  for (const [locale, words] of [
    ['zh', [/安全/, /迁移/, /无障碍/]],
    ['en', [/security/i, /migration/i, /accessibility/i]],
  ]) {
    const bullet = bulletWith(renderDelegationText(locale), locale === 'zh' ? '角色化委派' : 'Role delegation')
    assert.ok(bullet, locale + ': the role lane must exist')
    for (const word of words) {
      assert.match(bullet, word, locale + ': the role lane must name a concrete trigger')
    }
  }
})
