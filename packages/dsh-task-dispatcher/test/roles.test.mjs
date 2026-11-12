import { test } from 'node:test'
import assert from 'node:assert/strict'

import { selectRoles, roleBriefing, buildChildPrompt } from '../lib/roles.mjs'

// ---------------------------------------------------------------------------
// #194: 角色目录 —— 把已注册的 agent preset 当作「可委派的子 agent 角色」。
//
// 这些测试只碰公开行为：给一份 roster，问「有哪些角色」「某个角色叫什么」。
// 不 import 内部私有符号，不断言调用次数或内部顺序。
// ---------------------------------------------------------------------------

/** A roster shaped like `agentPresets.list()` answers (id/name/description). */
function roster(...entries) {
  return entries.map(([id, name, description]) => ({ id, name, description }))
}

const BUILTIN = ['standard', 'ptc', 'minimal', 'cordis', 'deep-ptc']

test('selectRoles drops the built-in full compositions and keeps every role', () => {
  const listed = roster(
    ['standard', 'Standard', 'coding agent'],
    ['ptc', 'PTC', 'deep ptc'],
    ['minimal', 'Minimal', 'minimal'],
    ['cordis', 'Cordis', 'creator'],
    ['deep-ptc', '深度PTC模式', 'deep ptc mode'],
    ['planner', 'planner', 'requirement breakdown'],
    ['a11y-architect', 'a11y-architect', 'Accessibility Architect'],
  )
  const roles = selectRoles(listed, BUILTIN)
  assert.deepEqual(roles.map((role) => role.id), ['planner', 'a11y-architect'])
})

test('selectRoles does not depend on the exclusion list order or duplicates', () => {
  const listed = roster(['standard', 'S', ''], ['planner', 'p', 'plan'])
  assert.deepEqual(selectRoles(listed, ['standard', 'standard']).map((r) => r.id), ['planner'])
})

test('selectRoles matches a keyword against id, name and description', () => {
  const listed = roster(
    ['security-reviewer', 'security-reviewer', '安全审查、凭证与注入风险'],
    ['a11y-architect', 'a11y-architect', 'Accessibility Architect for WCAG'],
    ['planner', 'planner', 'requirement breakdown and planning'],
  )
  assert.deepEqual(selectRoles(listed, BUILTIN, 'security').map((r) => r.id), ['security-reviewer'])
  assert.deepEqual(selectRoles(listed, BUILTIN, '安全').map((r) => r.id), ['security-reviewer'])
  assert.deepEqual(selectRoles(listed, BUILTIN, 'WCAG').map((r) => r.id), ['a11y-architect'])
  assert.deepEqual(selectRoles(listed, BUILTIN, 'PLANNING').map((r) => r.id), ['planner'])
})

test('selectRoles matches several space-separated terms with OR semantics', () => {
  const listed = roster(
    ['planner', 'planner', 'requirement breakdown'],
    ['a11y-architect', 'a11y-architect', 'WCAG compliance'],
    ['chief-of-staff', 'chief-of-staff', 'email triage'],
  )
  const ids = selectRoles(listed, BUILTIN, 'WCAG planner').map((r) => r.id)
  assert.deepEqual(ids, ['planner', 'a11y-architect'])
})

test('selectRoles returns every role for an empty or blank query', () => {
  const listed = roster(['planner', 'p', 'plan'], ['architect', 'a', 'design'])
  for (const query of [undefined, '', '   ']) {
    assert.equal(selectRoles(listed, BUILTIN, query).length, 2, 'query ' + JSON.stringify(query))
  }
})

test('selectRoles caps the answer at limit but never below one', () => {
  const listed = roster(['a', 'a', 'x'], ['b', 'b', 'x'], ['c', 'c', 'x'])
  assert.equal(selectRoles(listed, BUILTIN, undefined, 2).length, 2)
  assert.equal(selectRoles(listed, BUILTIN, undefined, 0).length, 3, 'a zero limit is treated as unset')
  assert.equal(selectRoles(listed, BUILTIN, undefined, -1).length, 3)
})

test('selectRoles tolerates roster rows without a name or description', () => {
  const listed = [{ id: 'planner' }, { id: 'standard' }]
  assert.deepEqual(selectRoles(listed, BUILTIN), [{ id: 'planner', name: 'planner', description: '' }])
})

// ---------------------------------------------------------------------------
// 角色简报：把注册表里的 persona 原文包成一段给子 agent 的开场白。
// ---------------------------------------------------------------------------

test('roleBriefing carries the persona text and the task verbatim', () => {
  const persona = 'You are a Senior Accessibility Architect. Enforce WCAG 2.2.'
  const task = 'Audit src/Button.tsx for focus visibility.'
  const briefing = roleBriefing({ role: 'a11y-architect', persona, task })

  assert.ok(briefing.includes(persona), 'persona text must reach the child verbatim')
  assert.ok(briefing.includes(task), 'task must reach the child verbatim')
  assert.ok(briefing.indexOf(persona) < briefing.indexOf(task), 'role framing precedes the task')
})

test('roleBriefing names the role and tells the child it has the full toolset', () => {
  const briefing = roleBriefing({ role: 'django-security', persona: 'P', task: 'T' })
  assert.match(briefing, /django-security/)
  // The child inherits the parent composition; saying so stops it from
  // reporting "I have no tools" instead of doing the work.
  assert.match(briefing, /工具|tools/i)
})

test('roleBriefing refuses an empty persona instead of sending a bare task', () => {
  assert.throws(() => roleBriefing({ role: 'x', persona: '   ', task: 'T' }), /persona/i)
})

// ---------------------------------------------------------------------------
// 组装委派请求：这是「保住 57 个工具」的关键不变量 —— 绝不能带 agentPreset。
// ---------------------------------------------------------------------------

test('buildChildPrompt produces one text block holding the briefing', () => {
  const content = buildChildPrompt({ role: 'planner', persona: 'P', task: 'T' })
  assert.equal(content.length, 1)
  assert.equal(content[0].type, 'text')
  assert.ok(content[0].text.includes('T'))
})

test('the delegation request never selects an agent preset', async () => {
  const { buildDelegationRequest } = await import('../lib/delegate.mjs')
  const request = buildDelegationRequest({ role: 'django-security', persona: 'P', task: 'T' })
  // Regression lock for #194: naming a preset replaces the child's whole
  // composition, which is how the 133 ECC presets became tool-less shells
  // (measured: 27 tools vs 57 for an inherited child).
  assert.equal(Object.hasOwn(request, 'agentPreset'), false, 'agentPreset must stay absent')
  assert.equal(request.prompt[0].type, 'text')
  assert.ok(request.prompt[0].text.includes('T'))
})

test('the delegation request forwards cwd only when given', async () => {
  const { buildDelegationRequest } = await import('../lib/delegate.mjs')
  assert.equal(Object.hasOwn(buildDelegationRequest({ role: 'r', persona: 'P', task: 'T' }), 'cwd'), false)
  assert.equal(buildDelegationRequest({ role: 'r', persona: 'P', task: 'T', cwd: '/tmp' }).cwd, '/tmp')
})
