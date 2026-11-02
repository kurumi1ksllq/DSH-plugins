import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTaskBoard, issueFromBranch, stageOf, NEEDS_USER_KINDS } from '../lib/task-board.js'

/** A snapshot shaped like getSnapshot()'s `git` block plus forge data. */
function snap(overrides = {}) {
  return {
    isGit: true,
    git: {
      currentBranch: 'main',
      status: { branch: 'main', detached: false, dirty: 0, untracked: 0, conflicts: 0, staged: 0, unstaged: 0 },
      branches: [{ name: 'main', current: true, ahead: 0, behind: 0 }],
      aheadCommits: [],
      ...overrides.git,
    },
    prs: overrides.prs ?? [],
    mergedPrs: overrides.mergedPrs ?? [],
    issues: overrides.issues ?? [],
    forgeHint: overrides.forgeHint ?? null,
    checks: overrides.checks ?? {},
    flowStates: overrides.flowStates ?? new Map(),
  }
}

const issue = (n, title = `t${n}`) => ({ number: n, title, url: `https://github.com/o/r/issues/${n}` })
const pr = (n, head, extra = {}) => ({ number: n, title: `pr${n}`, headRefName: head, baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', url: `https://github.com/o/r/pull/${n}`, ...extra })
const branch = (name, extra = {}) => ({ name, current: false, ahead: 0, behind: 0, ...extra })

// ---- branch → issue mapping -------------------------------------------------

test('issueFromBranch reads the dev-flow branch convention', () => {
  assert.equal(issueFromBranch('issue-26-task-board'), 26)
  assert.equal(issueFromBranch('issue-7-x'), 7)
  assert.equal(issueFromBranch('feature/x'), null)
  assert.equal(issueFromBranch('main'), null)
  assert.equal(issueFromBranch('issue-abc'), null)
  assert.equal(issueFromBranch(''), null)
  assert.equal(issueFromBranch(null), null)
})

// ---- stage derivation -------------------------------------------------------

test('stageOf: branch only, nothing ahead → dev', () => {
  assert.equal(stageOf({ hasBranch: true, ahead: 0, pr: null, checks: undefined, merged: false, flow: null }), 'dev')
})

test('stageOf: branch with unpushed commits → pr (push is next)', () => {
  assert.equal(stageOf({ hasBranch: true, ahead: 2, pr: null, checks: undefined, merged: false, flow: null }), 'pr')
})

test('stageOf: open PR, CI unknown → ci', () => {
  assert.equal(stageOf({ hasBranch: true, ahead: 2, pr: pr(1, 'issue-1-a'), checks: 'unknown', merged: false, flow: null }), 'ci')
})

test('stageOf: merged PR → done', () => {
  assert.equal(stageOf({ hasBranch: true, ahead: 0, pr: null, checks: undefined, merged: true, flow: null }), 'done')
})

// ---- conflict arbitration (user chose: git wins) ----------------------------

test('buildTaskBoard: flow says review but there is no PR → lands in pr column with stale flag', () => {
  const flowStates = new Map([[26, { issue: 26, grade: 'standard', stage: 'review', tickets: [], ci: null, review: null, merge: null }]])
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    flowStates,
  }))
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.issue === 26)
  assert.equal(card.stage, 'pr')
  assert.equal(card.stale, true)
  assert.equal(board.columns.find((c) => c.stage === 'pr').cards.some((c) => c.issue === 26), true)
  assert.equal(board.columns.find((c) => c.stage === 'review').cards.length, 0)
})

test('buildTaskBoard: flow and git agree → no stale flag', () => {
  const flowStates = new Map([[26, { issue: 26, grade: 'standard', stage: 'dev', tickets: [], ci: null, review: null, merge: null }]])
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
    flowStates,
  }))
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.issue === 26)
  assert.equal(card.stage, 'dev')
  assert.equal(card.stale, false)
})

// ---- eight columns ----------------------------------------------------------

test('buildTaskBoard always renders the eight dev-flow columns in order', () => {
  const board = buildTaskBoard(snap())
  assert.deepEqual(board.columns.map((c) => c.stage), ['intake', 'spec', 'dev', 'pr', 'ci', 'review', 'merge', 'done'])
})

test('buildTaskBoard: an open issue with no branch is waiting at intake', () => {
  const board = buildTaskBoard(snap({ issues: [issue(31)] }))
  const card = board.columns.find((c) => c.stage === 'intake').cards.find((c) => c.issue === 31)
  assert.notEqual(card, undefined)
  assert.equal(card.hasBranch, false)
})

// ---- off-flow column --------------------------------------------------------

test('buildTaskBoard: dirty main is off-flow', () => {
  const board = buildTaskBoard(snap({
    git: { status: { branch: 'main', detached: false, dirty: 3, untracked: 1, conflicts: 0, staged: 0, unstaged: 2 } },
  }))
  assert.equal(board.offFlow.length, 1)
  assert.equal(board.offFlow[0].branch, 'main')
  assert.equal(board.offFlow[0].reason, 'dirty-main')
  assert.equal(board.offFlow[0].files, 3)
})

test('buildTaskBoard: a dirty non-issue branch is off-flow', () => {
  const board = buildTaskBoard(snap({
    git: {
      currentBranch: 'feature/random',
      status: { branch: 'feature/random', detached: false, dirty: 1, untracked: 0, conflicts: 0, staged: 0, unstaged: 1 },
    },
  }))
  assert.equal(board.offFlow.length, 1)
  assert.equal(board.offFlow[0].reason, 'unnamed-branch')
})

test('buildTaskBoard: a clean issue branch is NOT off-flow', () => {
  const board = buildTaskBoard(snap({
    git: {
      currentBranch: 'issue-26-a',
      status: { branch: 'issue-26-a', detached: false, dirty: 0, untracked: 0, conflicts: 0, staged: 0, unstaged: 0 },
      branches: [branch('main'), branch('issue-26-a', { current: true })],
    },
    issues: [issue(26)],
  }))
  assert.equal(board.offFlow.length, 0)
})

test('buildTaskBoard: a clean main workspace produces no off-flow entry', () => {
  assert.equal(buildTaskBoard(snap()).offFlow.length, 0)
})

// ---- needs-user区 --------------------------------------------------------

test('needsUser only carries the four dev-flow user inputs', () => {
  assert.deepEqual([...NEEDS_USER_KINDS].sort(), ['ci-red-escalated', 'intake-confirm', 'merge-gate', 'no-ci'].sort())
})

test('buildTaskBoard: no CI repo raises exactly one no-ci item (not once per card)', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26), issue(27)],
    prs: [pr(5, 'issue-26-a')],
    checks: { 5: 'none' },
  }))
  const noCi = board.needsUser.filter((n) => n.kind === 'no-ci')
  assert.equal(noCi.length, 1)
})

test('buildTaskBoard: CI red at the last round escalates to the user', () => {
  const flowStates = new Map([[26, {
    issue: 26, grade: 'standard', stage: 'ci', tickets: [],
    ci: { run: 2, max: 2, status: 'red' }, review: null, merge: null,
  }]])
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    prs: [pr(5, 'issue-26-a')],
    checks: { 5: 'red' },
    flowStates,
  }))
  const escalated = board.needsUser.filter((n) => n.kind === 'ci-red-escalated')
  assert.equal(escalated.length, 1)
  assert.equal(escalated[0].issue, 26)
})

test('buildTaskBoard: CI red at round 1 is NOT escalated (still self-repairing)', () => {
  const flowStates = new Map([[26, {
    issue: 26, grade: 'standard', stage: 'ci', tickets: [],
    ci: { run: 1, max: 2, status: 'red' }, review: null, merge: null,
  }]])
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    prs: [pr(5, 'issue-26-a')],
    checks: { 5: 'red' },
    flowStates,
  }))
  assert.equal(board.needsUser.filter((n) => n.kind === 'ci-red-escalated').length, 0)
})

test('buildTaskBoard: a green PR with finished review waits for the merge gate', () => {
  const flowStates = new Map([[26, {
    issue: 26, grade: 'standard', stage: 'merge', tickets: [],
    ci: { run: 0, max: 2, status: 'green' }, review: { state: 'done', axes: 2 }, merge: { authorized: false },
  }]])
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    prs: [pr(5, 'issue-26-a')],
    checks: { 5: 'green' },
    flowStates,
  }))
  const gate = board.needsUser.filter((n) => n.kind === 'merge-gate')
  assert.equal(gate.length, 1)
  assert.equal(gate[0].issue, 26)
  assert.equal(gate[0].prNumber, 5)
})

test('buildTaskBoard: needsUser is capped at three entries, blockers first', () => {
  const issues = [issue(1), issue(2), issue(3), issue(4), issue(5)]
  const branches = [branch('main', { current: true }), ...issues.map((i) => branch(`issue-${i.number}-a`))]
  const prs = issues.map((i) => pr(i.number, `issue-${i.number}-a`))
  const checks = Object.fromEntries(issues.map((i) => [i.number, 'green']))
  const flowStates = new Map(issues.map((i) => [i.number, {
    issue: i.number, grade: 'standard', stage: 'merge', tickets: [],
    ci: { run: 0, max: 2, status: 'green' }, review: { state: 'done', axes: 2 }, merge: { authorized: false },
  }]))
  const board = buildTaskBoard(snap({ git: { branches }, issues, prs, checks, flowStates }))
  assert.equal(board.needsUser.length, 3)
})

// ---- forge unavailable ------------------------------------------------------

test('buildTaskBoard: gh not logged in still renders git-derived cards', () => {
  const board = buildTaskBoard(snap({
    forgeHint: 'not-logged-in',
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: null,
    prs: null,
  }))
  // All eight columns survive without the forge; the branch still becomes a
  // card from git evidence alone, sitting at "waiting to push".
  assert.deepEqual(board.columns.map((c) => c.stage), ['intake', 'spec', 'dev', 'pr', 'ci', 'review', 'merge', 'done'])
  const card = board.columns.find((c) => c.stage === 'pr').cards.find((c) => c.issue === 26)
  assert.notEqual(card, undefined)
  assert.equal(card.prNumber, null)
  assert.equal(card.checks, 'unknown')
  assert.equal(board.forgeHint, 'not-logged-in')
})

// ---- progress dots ----------------------------------------------------------

test('buildTaskBoard: card carries an eight-slot progress index', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
  }))
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.issue === 26)
  assert.equal(card.stageIndex, 2)
  assert.equal(card.columnCount, 8)
})
