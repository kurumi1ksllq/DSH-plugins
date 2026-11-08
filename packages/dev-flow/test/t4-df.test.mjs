// T4.df (#125): review pending-decision surfaces in "needs you"; dead locale
// keys are gone; SKILL.md narrows triggers and cross-references the panel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')

test('a review stuck at pending-decision lands in needsUser as a blocker', async () => {
  const { buildTaskBoard } = await import('../lib-git-status/task-board.js')
  const snapshot = {
    git: { branches: [{ name: 'issue-9-x', ahead: 1 }] },
    issues: [{ number: 9, state: 'open' }],
    prs: [{ number: 30, headRefName: 'issue-9-x' }],
    mergedPrs: [],
    checks: { 'issue-9-x': 'green' },
    flowStates: {
      9: { issue: 9, grade: 'standard', stage: 'review', review: { state: 'pending-decision', axes: 2 }, tickets: [] },
    },
  }
  const board = buildTaskBoard(snapshot)
  const kinds = (board.needsUser ?? []).map((n) => n.kind)
  assert.ok(
    kinds.includes('review-pending-decision'),
    'pending-decision must surface in needsUser, got: ' + kinds.join(','),
  )
})

test('a review that is merely running does NOT fire the pending-decision item', async () => {
  const { buildTaskBoard } = await import('../lib-git-status/task-board.js')
  const snapshot = {
    git: { branches: [{ name: 'issue-9-x', ahead: 1 }] },
    issues: [{ number: 9, state: 'open' }],
    prs: [{ number: 30, headRefName: 'issue-9-x' }],
    mergedPrs: [],
    checks: { 'issue-9-x': 'green' },
    flowStates: {
      9: { issue: 9, grade: 'standard', stage: 'review', review: { state: 'running' }, tickets: [] },
    },
  }
  const board = buildTaskBoard(snapshot)
  const kinds = (board.needsUser ?? []).map((n) => n.kind)
  assert.equal(kinds.includes('review-pending-decision'), false)
})

test('NEEDS_USER_KINDS pins the new kind (enum is public protocol)', async () => {
  const { NEEDS_USER_KINDS } = await import('../lib-git-status/task-board.js')
  assert.ok(NEEDS_USER_KINDS.includes('review-pending-decision'))
})

test('dead locale key "stashes" is gone from both dicts', async () => {
  const source = readFileSync(join(pkg, 'client.js'), 'utf8')
  // The data field snap.git?.stashes is fine; the LOCALE keys must not exist.
  assert.doesNotMatch(source, /^\s+'?stashes'?:\s/m)
})

test('SKILL.md narrows read-only triggers and cross-references the panel', () => {
  const skill = readFileSync(join(pkg, 'SKILL.md'), 'utf8')
  assert.match(skill, /纯只读查询/)
  assert.match(skill, /不进流程/)
  assert.match(skill, /Git 面板/)
})

test('client.js carries the panel→skill hint with both locales', () => {
  const source = readFileSync(join(pkg, 'client.js'), 'utf8')
  assert.match(source, /boardSkillHint/)
  assert.match(source, /dev-flow skill/)
})
