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

test('the workflow lane names a fallback instead of a dead requirement', () => {
  // #185: deep-ptc disables the workflow tool, so a bare "use workflow" points at a
  // path that does not exist in that composition. The lane must stay usable either way.
  return import('../lib/delegation-text.mjs').then(({ renderDelegationText }) => {
    for (const locale of ['zh', 'en']) {
      const text = renderDelegationText(locale)
      assert.match(text, /workflow/, locale + ' should still mention workflow')
      // The fallback has to name the substitute, not just say "if unavailable".
      assert.match(text, /subagent/, locale + ' must name the substitute')
    }
    const zh = renderDelegationText('zh')
    assert.match(zh, /没有该工具|不可用|没有 workflow/, 'zh must state the unavailable branch')
    const en = renderDelegationText('en')
    assert.match(en, /without it|not available|no workflow/i, 'en must state the unavailable branch')
  })
})

test('the three questions are bound to an action, with a fallback for missing todo_write', () => {
  // #186: the incident session had todo_write available and called it zero times.
  // The questions were an abstract requirement with no carrier. Binding them to a
  // call is the fix — but the binding itself must degrade when the tool is absent,
  // or it becomes the same defect as #185.
  return import('../lib/delegation-text.mjs').then(({ renderDelegationText }) => {
    const zh = renderDelegationText('zh')
    assert.match(zh, /todo_write/, 'zh must name the carrier')
    assert.match(zh, /没有|不可用|若本会话/, 'zh must degrade when the tool is missing')
    const en = renderDelegationText('en')
    assert.match(en, /todo_write/, 'en must name the carrier')
    assert.match(en, /otherwise|if this session|not available/i, 'en must degrade too')
  })
})

test('the stop line carries a countable signal next to the call count', () => {
  // #186: "after >8 tool calls" is a scalar the model cannot count reliably. The
  // third same-kind file is visible at a glance; keep both and take either.
  return import('../lib/delegation-text.mjs').then(({ renderDelegationText }) => {
    assert.match(renderDelegationText('zh'), /第 ?3 ?个/, 'zh needs the countable signal')
    assert.match(renderDelegationText('en'), /third/i, 'en needs the countable signal')
  })
})

test('the text separates the two result channels instead of letting them collide', () => {
  // #187: two subagents were already running; wait_agent said no-active-peer, the
  // model concluded they had died and spawned two teammates for the same review.
  // The text has to say that background subagents are not team members.
  return import('../lib/delegation-text.mjs').then(({ renderDelegationText }) => {
    const zh = renderDelegationText('zh')
    assert.match(zh, /wait_agent/, 'zh must name the tool whose scope is narrow')
    assert.match(zh, /inbox|通知/, 'zh must say how the result actually arrives')
    const en = renderDelegationText('en')
    assert.match(en, /wait_agent/, 'en must name it too')
    assert.match(en, /inbox|notification/i, 'en must say how the result arrives')
  })
})

test('polling and concurrency have their own rule', () => {
  // #188: one CI command ran 15 times with no backoff, and 38 of 39 multi-tool
  // root calls awaited sequentially. Neither had a rule to appeal to.
  return import('../lib/delegation-text.mjs').then(({ renderDelegationText }) => {
    const zh = renderDelegationText('zh')
    assert.match(zh, /job_output|后台/, 'zh must point polling at a background job')
    assert.match(zh, /Promise\.all|并行/, 'zh must name the concurrency mechanism')
    assert.match(zh, /最多 ?3 ?次|退避/, 'zh must bound the retries')
    const en = renderDelegationText('en')
    assert.match(en, /job_output|background/i)
    assert.match(en, /Promise\.all|concurrent|parallel/i)
    assert.match(en, /backoff|at most 3/i)
  })
})
