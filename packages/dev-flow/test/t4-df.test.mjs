// T4.df (#125, rewritten by #157): the review state is NOT in the "needs you"
// strip any more — it lives on the card evidence line. What this file still
// guards is that the state stays visible and that the strip stays closed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')

test('a review at pending-decision no longer asks the user (#157)', async () => {
  const { buildTaskBoard } = await import('../lib-git-status/task-board.js')
  const snapshot = {
    git: { branches: [{ name: 'issue-9-x', ahead: 1 }] },
    issues: [{ number: 9, state: 'open' }],
    prs: [{ number: 30, headRefName: 'issue-9-x' }],
    mergedPrs: [],
    checks: { 30: 'green' },
    flowStates: {
      9: { issue: 9, grade: 'standard', stage: 'review', review: { state: 'pending-decision', axes: 2 }, tickets: [] },
    },
  }
  const board = buildTaskBoard(snapshot)
  const kinds = (board.needsUser ?? []).map((n) => n.kind)
  // #157: the agent adjudicates findings itself; the state stays on the card so
  // the user can read it, but it is not an action item any more.
  assert.equal(kinds.includes('review-pending-decision'), false, 'the agent rules on findings, got: ' + kinds.join(','))
  const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.issue === 9)
  assert.equal(card?.review?.state, 'pending-decision', 'the state itself must stay visible')
})

test('the worst case — red CI at the last round AND a review report — still asks nothing', async () => {
  const { buildTaskBoard } = await import('../lib-git-status/task-board.js')
  const board = buildTaskBoard({
    git: { branches: [{ name: 'issue-9-x', ahead: 1 }] },
    issues: [{ number: 9, state: 'open' }],
    prs: [{ number: 30, headRefName: 'issue-9-x' }],
    mergedPrs: [],
    checks: { 30: 'red' },
    flowStates: {
      9: { issue: 9, grade: 'standard', stage: 'review', review: { state: 'pending-decision', axes: 2 }, tickets: [], ci: { run: 2, max: 2, status: 'red' } },
    },
  })
  assert.deepEqual(board.needsUser, [], 'the agent owns both the CI repair and the review ruling')
  const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.issue === 9)
  assert.equal(card?.checks, 'red', 'the red CI still has to be readable on the card')
  assert.equal(card?.review?.state, 'pending-decision', 'and so does the review state')
})

test('dead locale key "stashes" is gone from both dicts', async () => {
  const source = readFileSync(join(pkg, 'client.js'), 'utf8')
  // The data field snap.git?.stashes is fine; the LOCALE keys must not exist.
  assert.doesNotMatch(source, /^\s+'?stashes'?:\s/m)
})

test('FLOW.md narrows read-only triggers and cross-references the panel', () => {
  const flow = readFileSync(join(pkg, 'FLOW.md'), 'utf8')
  assert.match(flow, /纯只读查询/)
  assert.match(flow, /不进流程/)
  assert.match(flow, /Git 面板/)
})

test('client.js carries the panel→flow hint in BOTH dicts', () => {
  const source = readFileSync(join(pkg, 'client.js'), 'utf8')
  // The zh value contains 会接手; the en value contains drives this flow —
  // requiring both makes deleting either dict's key red.
  assert.match(source, /boardFlowHint: '[^']*会接手/)
  assert.match(source, /boardFlowHint: '[^']*drives this flow/)
  assert.match(source, /t\('boardFlowHint'\)/)
})
