import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE)

test('bundle manifest is a valid link-able bundle', async () => {
  const pkg = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-task-dispatcher')
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'must declare dsh.bundle.patch')
  assert.ok(
    /\^0\.2\.0/.test(pkg.engines?.dsh ?? ''),
    `engines.dsh must accommodate ^0.2.0, got ${pkg.engines?.dsh}`,
  )
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.length > 0,
    'scripts.test must be non-empty (check-bundle-versions)')
  // display resources: every bundle has a visible inventory entry
  assert.ok(pkg.exports?.['./icon'], 'must export ./icon')
  assert.ok(pkg.files?.includes('locale/*.json'), 'files must list locale/*.json')
})

test('patch row points at this package with a unique id', async () => {
  const patch = await readFile(join(PKG, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /- insert:/)
  assert.match(patch, /^- insert:\n    - id: task-dispatcher$/m)
  assert.match(patch, /^      name: '?dsh-task-dispatcher'?$/m)
})

test('index exports a name and apply function, and no Config (patch row carries none)', async () => {
  const mod = await import('../index.js')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.name, 'dsh-task-dispatcher')
  assert.equal(mod.Config, undefined, 'a config without a Config schema fails validation at load')
})

test('delegation text renders both locales with required sections', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  for (const locale of ['zh', 'en']) {
    const text = renderDelegationText(locale)
    assert.ok(text.length > 200, `${locale} text is substantive`)
    assert.match(text, /preset/i, 'routing table names presets')
    assert.ok(text.includes('- '), 'routing table is a list')
  }
  // zh and en are same-structure (contract style of governor-copy)
  const zh = renderDelegationText('zh')
  const en = renderDelegationText('en')
  assert.equal(
    zh.split('\n').filter((l) => /^- /.test(l)).length,
    en.split('\n').filter((l) => /^- /.test(l)).length,
    'zh/en routing-table bullet counts match',
  )
})

test('locale files exist and meta keys match across locales', async () => {
  const en = JSON.parse(await readFile(join(PKG, 'locale/en.json'), 'utf8'))
  const zh = JSON.parse(await readFile(join(PKG, 'locale/zh.json'), 'utf8'))
  for (const dict of [en, zh]) {
    assert.ok(dict.meta?.title, 'meta.title required')
    assert.ok(dict.meta?.description, 'meta.description required')
  }
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(zh).sort(),
    'en/zh key sets match',
  )
})

// ---- #185-#188: the delegation text must not promise what it cannot keep ----
//
// Every assertion below is scoped to ONE bullet. A regex over the whole document
// passes even after the clause it was meant to protect is gone, because a sibling
// bullet often contains the same words (measured: deleting the todo_write fallback
// still matched "没有该工具时" from the workflow bullet).

/** The bullet that mentions `needle`, or null. */
function bulletWith(text, needle) {
  return text.split('\n').find((line) => line.startsWith('- ') && line.includes(needle)) ?? null
}

test('the workflow lane names a fallback instead of a dead requirement', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  for (const [locale, needle, fallback] of [
    ['zh', 'workflow', /没有该工具|不可用/],
    ['en', 'workflow', /without it|not available|no workflow/i],
  ]) {
    const bullet = bulletWith(renderDelegationText(locale), needle)
    assert.ok(bullet, locale + ': the lane must still mention workflow')
    assert.match(bullet, /subagent/, locale + ': the lane must name the substitute')
    assert.match(bullet, fallback, locale + ': the lane must state the unavailable branch in its own bullet')
  }
})

test('the three questions are bound to an action, with a fallback for missing todo_write', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  for (const [locale, fallback] of [
    ['zh', /没有该工具|没有 ?`?todo_write|写进第一条回复/],
    ['en', /otherwise|has no .*todo_write|write them in your first reply/i],
  ]) {
    const bullet = bulletWith(renderDelegationText(locale), 'todo_write')
    assert.ok(bullet, locale + ': the three questions must name their carrier')
    assert.match(bullet, fallback, locale + ': the carrier bullet must degrade when the tool is absent')
  }
})

test('the stop line carries a countable signal next to the call count', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  const zh = bulletWith(renderDelegationText('zh'), '停手') ?? renderDelegationText('zh')
  assert.match(zh, /第 ?3 ?个/, 'zh needs the countable signal')
  const en = renderDelegationText('en').split('\n').find((l) => /re-decompose/i.test(l)) ?? ''
  assert.match(en, /third/i, 'en needs the countable signal in the stop-line bullet')
})

test('the text separates the two result channels and forbids running both at once', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  for (const [locale, dedupe, delivery] of [
    ['zh', /只走一条通道|先定档/, /inbox|通知/],
    ['en', /one channel|pick the lane first/i, /inbox|notification/i],
  ]) {
    const bullet = bulletWith(renderDelegationText(locale), 'wait_agent')
    assert.ok(bullet, locale + ': the delivery bullet must name wait_agent')
    assert.match(bullet, delivery, locale + ': it must say how the result arrives')
    assert.match(bullet, dedupe, locale + ': it must forbid running the same job twice')
  }
})

test('polling and concurrency have their own rule, aligned with the existing limits', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  for (const [locale, mechanism] of [['zh', /Promise\.all/], ['en', /Promise\.all/]]) {
    const bullet = bulletWith(renderDelegationText(locale), 'job_output')
    assert.ok(bullet, locale + ': polling must point at a background job')
    assert.match(bullet, mechanism, locale + ': it must name the concurrency mechanism')
    // The numbers must agree with what the rest of the prompt already enforces:
    // discipline 8 caps retries at 2, and the pause guard refuses >5s foreground waits.
    assert.match(bullet, /2 ?次|at (?:most )?2/, locale + ': retry cap must match rule 8')
    assert.match(bullet, /5 ?秒|5 seconds/, locale + ': the interval must fit the pause guard')
  }
})

test('zh and en carry the same rule set, not just the same bullet count', () => {
  // The count assertion alone is blind to wording drift: changing a zh clause
  // without touching en keeps the counts equal and stays green (measured). What
  // matters is that each rule has a counterpart in the other locale, so pair the
  // markers instead of counting lines.
  return import('../lib/delegation-text.mjs').then(({ renderDelegationText }) => {
    const zh = renderDelegationText('zh')
    const en = renderDelegationText('en')
    const pairs = [
      ['todo_write', 'todo_write'],
      ['workflow', 'workflow'],
      ['subagent', 'subagent'],
      ['wait_agent', 'wait_agent'],
      ['list_agents', 'list_agents'],
      ['inbox', 'inbox'],
      ['job_output', 'job_output'],
      ['Promise.all', 'Promise.all'],
      ['第 3 个', 'third'],
      ['2 次', 'cap at 2'],
      ['5 秒', '5 seconds'],
    ]
    const missing = []
    for (const [zhNeedle, enNeedle] of pairs) {
      if (!zh.includes(zhNeedle)) missing.push('zh is missing ' + zhNeedle)
      if (!en.includes(enNeedle)) missing.push('en is missing ' + enNeedle)
    }
    assert.deepEqual(missing, [], 'every rule must exist in both locales')
  })
})

// ---- #194: the role-delegation lane ----
//
// Bound to ONE bullet, the same way the #185-#188 assertions are: a regex over
// the whole document would still match when the clause is deleted, because the
// routing table below it names tools too.

test('both locales tell the agent about role delegation and its tools', async () => {
  const { renderDelegationText } = await import('../lib/delegation-text.mjs')
  for (const [locale, needles] of [
    ['zh', ['role_search', 'delegate_role', '专才']],
    ['en', ['role_search', 'delegate_role', 'specialist']],
  ]) {
    const bullet = bulletWith(renderDelegationText(locale), 'delegate_role')
    assert.ok(bullet, locale + ': a bullet must mention delegate_role')
    for (const needle of needles) {
      assert.ok(bullet.includes(needle), locale + ': the role bullet must mention ' + needle)
    }
    // The lane is worthless if it does not say the toolset stays complete:
    // the whole point is that role delegation is NOT a preset mount.
    assert.match(bullet, /工具|toolset|tools/i, locale + ': must promise the intact toolset')
  }
})

