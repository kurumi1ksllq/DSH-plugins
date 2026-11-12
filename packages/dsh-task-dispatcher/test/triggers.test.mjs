import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderDelegationText } from '../lib/delegation-text.mjs'

// ---------------------------------------------------------------------------
// #195: the delegation trigger must be COUNTABLE and DIRECTIONAL.
//
// Three review rounds taught the same lesson from different angles:
//   1. a regex over the whole document matches a sibling bullet and stays
//      green after the clause is deleted;
//   2. 'this bullet mentions delegation' passes when the working sentence is
//      gone -- deleting 'read is work too' stayed green;
//   3. asserting only that a NUMBER appears passes when the POLARITY flips --
//      '>=3 files -> split' rewritten to '-> do not split' stayed green, and so
//      did '3 or more files' rewritten to 'at most 3 files'.
// So every assertion here pairs the threshold with its direction, and forbids
// the inverted wording explicitly.
// ---------------------------------------------------------------------------

/** The bullet that mentions `needle`, or null. Never falls back to the whole text. */
/** Match one bullet by a substring OR a regular expression. Never the whole text. */
function matches(line, needle) {
  return needle instanceof RegExp ? needle.test(line) : line.includes(needle)
}

/** The bullet that matches `needle`, or null. */
function bulletWith(text, needle) {
  return text.split('\n').find((line) => line.startsWith('- ') && matches(line, needle)) ?? null
}

/** Fail loudly when the bullet is missing instead of asserting against undefined. */
function requireBullet(text, needle, locale) {
  const bullet = bulletWith(text, needle)
  assert.ok(bullet, locale + ': no bullet matches ' + String(needle))
  return bullet
}

/**
 * The sizing bullet, located by a threshold it must carry rather than by a
 * heading marker. A marker is prose: renaming it (which changes no meaning)
 * must not break the suite.
 */
function sizingBullet(locale) {
  const text = renderDelegationText(locale)
  const needle = locale === 'zh' ? '个文件' : 'files'
  return requireBullet(text, needle, locale)
}

test('the split trigger names all three countable thresholds', () => {
  const zh = sizingBullet('zh')
  assert.match(zh, /≥\s*3\s*个?文件/)
  assert.match(zh, /≥\s*2\s*个?(包|模块)/)
  assert.match(zh, /≥\s*2\s*个?(互不依赖的|独立)?验证/)
  const en = sizingBullet('en')
  assert.match(en, /(3|three)\s*(or\s*more\s*)?files?/i)
  assert.match(en, /(2|two)\s*(or\s*more\s*)?(packages?|modules?)/i)
  assert.match(en, /(2|two)\s*(or\s*more\s*)?independent\s*(verifications?|checks?)/i)
})

test('each threshold is bound to SPLITTING, not merely stated', () => {
  // Polarity lock. Deleting the direction words or inverting them must fail.
  const zh = sizingBullet('zh')
  for (const clause of zh.split(';')) {
    if (!/≥\s*[23]/.test(clause)) continue
    assert.match(clause, /拆|并行/, 'zh: threshold clause must direct a split: ' + clause.slice(0, 40))
    assert.doesNotMatch(clause, /不拆|串行|无需/, 'zh: threshold clause must not be inverted: ' + clause.slice(0, 40))
  }
  const en = sizingBullet('en')
  for (const clause of en.split(';')) {
    if (!/(3|2|three|two)\s*(or more)?\s*(files?|packages?|modules?|independent)/i.test(clause)) continue
    assert.match(clause, /split|parallel/i, 'en: threshold clause must direct a split: ' + clause.slice(0, 50))
    assert.doesNotMatch(clause, /at most|do not split|never split|serially/i, 'en: threshold clause must not be inverted: ' + clause.slice(0, 50))
  }
})

test('a countable hit is mandatory, not advisory', () => {
  const zh = sizingBullet('zh')
  assert.match(zh, /必须拆|就必须/, 'zh: a countable hit must be mandatory')
  assert.doesNotMatch(zh, /可以考虑拆|建议拆/, 'zh: must not soften to advice')
  const en = sizingBullet('en')
  assert.match(en, /forces a split|must split/i, 'en: a countable hit must be mandatory')
  assert.doesNotMatch(en, /consider splitting|may split/i, 'en: must not soften to advice')
})

test('reading may be delegated only for breadth, never for files the lead will change', () => {
  // The first draft said 'reading is work too, hand it out', which contradicts
  // the global rule 'read before you write' and leaves the lead reviewing a
  // summary instead of the file it is about to edit.
  const zh = requireBullet(renderDelegationText('zh'), '读', 'zh')
  assert.match(zh, /广度|探索|摸清|调研/, 'zh: only breadth-first reading may be delegated')
  assert.match(zh, /亲(自)?读|自己读/, 'zh: the lead must read what it will change or review')
  const en = requireBullet(renderDelegationText('en'), 'read', 'en')
  assert.match(en, /breadth|survey|explore/i, 'en: only breadth-first reading may be delegated')
  assert.match(en, /read (it )?(yourself|first)|read the files it will/i, 'en: the lead must read what it will change or review')
})

test('the escape hatch names the excuse it refuses', () => {
  const zh = requireBullet(renderDelegationText('zh'), /先读|先看看|先摸清/, 'zh')
  assert.match(zh, /不构成/, 'zh: must refuse the excuse')
  const en = requireBullet(renderDelegationText('en'), /read the code first|explore the repo/i, 'en')
  assert.match(en, /not a reason to skip/i, 'en: must refuse the excuse')
})

test('the exception applies only when NO countable condition is hit', () => {
  // Otherwise the exception swallows the rule: 'one file, but two repos to
  // check' could cite it and skip the parallel run.
  const zh = requireBullet(renderDelegationText('zh'), /例外|唯一/, 'zh')
  assert.match(zh, /未命中|没有命中|都不命中/, 'zh: the exception must be conditioned on missing every threshold')
  assert.match(zh, /一个文件/, 'zh: the exception must stay bounded to one file')
  const en = requireBullet(renderDelegationText('en'), /exception|only task/i, 'en')
  assert.match(en, /none of the countable conditions|no countable condition/i, 'en: the exception must be conditioned on missing every threshold')
})

test('fan-out carries the destructive-operation constraint', () => {
  // Subagents run with a shell. The section must not read as a licence.
  const zh = renderDelegationText('zh')
  assert.match(zh, /破坏性|删除|不可逆/, 'zh: the section must restate the destructive-operation rule')
  assert.match(zh, /确认|用户批准|授权/, 'zh: and that it still needs confirmation')
  const en = renderDelegationText('en')
  assert.match(en, /destructive|irreversible/i, 'en: the section must restate the destructive-operation rule')
  assert.match(en, /confirm|approval/i, 'en: and that it still needs confirmation')
})