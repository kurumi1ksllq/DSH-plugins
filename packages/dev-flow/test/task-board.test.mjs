import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTaskBoard, issueFromBranch } from '../lib-git-status/task-board.js'

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

// ---- stage derivation (through the public board, not the internal helper) ---
// These used to call `stageOf()` with its internal argument shape. That shape
// differs from what `buildTaskBoard()` passes in, so a change in how the card is
// assembled could have left every stage test green while the board moved cards
// to the wrong column. Each case now asserts where a card LANDS.

/** The column a card for `issue` ends up in, or null when it has no card. */
function columnOf(board, issue) {
  for (const column of board.columns) {
    if (column.cards.some((card) => card.issue === issue)) return column.stage
  }
  return null
}

test('a branch with nothing ahead sits in dev', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-1-a')] },
    issues: [issue(1)],
  }))
  assert.equal(columnOf(board, 1), 'dev')
})

test('unpushed commits move the card to pr, because pushing is the next step', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-1-a', { ahead: 2 })] },
    issues: [issue(1)],
  }))
  assert.equal(columnOf(board, 1), 'pr')
})

test('an open PR with unknown CI sits in ci', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-1-a', { ahead: 2 })] },
    issues: [issue(1)],
    prs: [pr(1, 'issue-1-a')],
    checks: {},
  }))
  assert.equal(columnOf(board, 1), 'ci')
})

test('a merged PR lands in done', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-1-a')] },
    issues: [issue(1)],
    mergedPrs: [pr(9, 'issue-1-a')],
  }))
  assert.equal(columnOf(board, 1), 'done')
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

test('the board asks the user about exactly two things: intent and merge', () => {
  // #157: the agent decides grading, cutting, missing CI, CI red and review
  // findings itself. What is left for the user is the intent up front and the
  // merge word at the end — a strip that also lists the other three would train
  // the user to ignore it, which is worse than not showing it.

  // 1. intake-confirm: an issue with no branch yet.
  const intake = buildTaskBoard(snap({ issues: [issue(31)] }))
  assert.ok(intake.needsUser.some((n) => n.kind === 'intake-confirm'), 'intake-confirm never fires')

  // 2. merge-gate: review done, merge not yet authorised.
  const gate = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    prs: [pr(5, 'issue-26-a')],
    checks: { 5: 'green' },
    flowStates: new Map([[26, {
      issue: 26, grade: 'standard', stage: 'merge', tickets: [],
      ci: { run: 0, max: 2, status: 'green' }, review: { state: 'done', axes: 2 }, merge: { authorized: false },
    }]]),
  }))
  assert.ok(gate.needsUser.some((n) => n.kind === 'merge-gate'), 'merge-gate never fires')

  // And the vocabulary is closed: nothing the agent decides may appear here.
  const observed = new Set([...intake.needsUser, ...gate.needsUser].map((n) => n.kind))
  assert.deepEqual([...observed].sort(), ['intake-confirm', 'merge-gate'])
})

test('the needs-user vocabulary stays closed when every legacy trigger is present', () => {
  // #157 removed three kinds (no-ci, ci-red-escalated, review-pending-decision)
  // from the strip. The existing cases assert each one is absent from ITS OWN
  // scenario — which cannot notice a fourth kind being added later, and cannot
  // notice one of the three creeping back in a scenario they do not cover.
  //
  // This case puts every legacy trigger in ONE snapshot and asserts the observed
  // kinds are exactly the closed set. A new kind, or any of the three returning,
  // makes the deepEqual fail with the offending name in the diff.
  const flowStates = new Map([
    // Red CI at the last self-repair round.
    [26, {
      issue: 26, grade: 'standard', stage: 'ci', tickets: [],
      ci: { run: 2, max: 2, status: 'red' }, review: null, merge: null,
    }],
    // A review that ran and produced findings.
    [27, {
      issue: 27, grade: 'standard', stage: 'review', tickets: [],
      ci: { run: 0, max: 2, status: 'green' }, review: { state: 'pending-decision', axes: 2 }, merge: null,
    }],
    // A finished review waiting for the merge word.
    [28, {
      issue: 28, grade: 'standard', stage: 'merge', tickets: [],
      ci: { run: 0, max: 2, status: 'green' }, review: { state: 'done', axes: 2 }, merge: { authorized: false },
    }],
  ])
  const board = buildTaskBoard(snap({
    git: {
      branches: [
        branch('main', { current: true }),
        branch('issue-26-a', { ahead: 1 }),
        branch('issue-27-a', { ahead: 1 }),
        branch('issue-28-a', { ahead: 1 }),
      ],
    },
    // 29 has no branch at all → the intent stop point.
    issues: [issue(26), issue(27), issue(28), issue(29)],
    prs: [pr(5, 'issue-26-a'), pr(6, 'issue-27-a'), pr(7, 'issue-28-a')],
    // A repository whose checks report nothing at all.
    checks: { 5: 'red', 6: 'green', 7: 'green', 8: 'none' },
    flowStates,
  }))

  const observed = [...new Set(board.needsUser.map((entry) => entry.kind))].sort()
  assert.deepEqual(
    observed,
    ['intake-confirm', 'merge-gate'],
    'the strip may only carry the two questions dev-flow still asks the user',
  )
})

test('buildTaskBoard: missing CI is stated by the cards, not asked of the user', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26), issue(27)],
    prs: [pr(5, 'issue-26-a')],
    checks: { 5: 'none' },
  }))
  assert.equal(board.needsUser.filter((n) => n.kind === 'no-ci').length, 0, 'the agent adds a minimal workflow itself')
  const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.prNumber === 5)
  assert.equal(card?.checks, 'none', 'the state still has to be visible on the card')
})

test('buildTaskBoard: CI red at the last round stays with the agent', () => {
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
  assert.equal(board.needsUser.filter((n) => n.kind === 'ci-red-escalated').length, 0)
  const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.issue === 26)
  assert.equal(card.action, null, 'a red CI is the agent' + "'" + 's problem to report, not a card action')
  // "still visible" has to mean the facts the card carries, not just the absence
  // of an action: the renderer draws these two fields verbatim.
  assert.equal(card.checks, 'red')
  assert.deepEqual(card.ci, { run: 2, max: 2, status: 'red' })
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

// ---- review findings: intake-confirm, off-flow, card action line -----------

test('intake-confirm fires for an issue with NO branch yet, not for one already branch-ed', () => {
  // Stop point 1 is "issue created, plan not confirmed". A branch means the plan
  // WAS confirmed (dev-flow creates the branch only after stop point 2), so a
  // normal in-flight task must never be reported as needing the user.
  const withBranch = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
  }))
  assert.equal(withBranch.needsUser.filter((n) => n.kind === 'intake-confirm').length, 0)

  const noBranch = buildTaskBoard(snap({ issues: [issue(31)] }))
  assert.equal(noBranch.needsUser.filter((n) => n.kind === 'intake-confirm').length, 1)
})

test('off-flow catches a committed non-issue branch even when the tree is clean', () => {
  // The commonest way to bypass dev-flow: work on feature/x and commit it. The
  // workspace is clean, so a dirty-only check let it vanish from the board.
  const board = buildTaskBoard(snap({
    git: {
      currentBranch: 'feature/random',
      status: { branch: 'feature/random', detached: false, dirty: 0, untracked: 0, conflicts: 0, staged: 0, unstaged: 0 },
      branches: [branch('main'), branch('feature/random', { current: true, ahead: 2 })],
    },
  }))
  assert.equal(board.offFlow.length, 1)
  assert.equal(board.offFlow[0].branch, 'feature/random')
  assert.equal(board.offFlow[0].reason, 'unnamed-branch')
})

test('off-flow catches an issue branch whose issue does not exist', () => {
  // "issue-99-x" reads like dev-flow but #99 is not an issue, so nothing on the
  // board owns it — it is bypassing the flow with a convincing name.
  const board = buildTaskBoard(snap({
    git: {
      currentBranch: 'issue-99-ghost',
      status: { branch: 'issue-99-ghost', detached: false, dirty: 0, untracked: 0, conflicts: 0, staged: 0, unstaged: 0 },
      branches: [branch('main'), branch('issue-99-ghost', { current: true, ahead: 1 })],
    },
    issues: [issue(26)],
  }))
  assert.equal(board.offFlow.length, 1)
  assert.equal(board.offFlow[0].reason, 'unknown-issue')
  assert.equal(board.offFlow[0].issue, 99)
})

test('a clean main with no stray branches is never off-flow', () => {
  assert.equal(buildTaskBoard(snap({ issues: [issue(26)] })).offFlow.length, 0)
})

test('a card carries its own action line when that issue needs the user', () => {
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
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.issue === 26)
  assert.notEqual(card.action, null, 'the card must say what it is waiting for')
  assert.equal(card.action.kind, 'merge-gate')
  assert.equal(card.action.prNumber, 5)
})

test('a card with nothing pending carries no action line', () => {
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
  }))
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.issue === 26)
  assert.equal(card.action, null)
})

test('missing CI alone does not raise a user item, even with no matching card', () => {
  const board = buildTaskBoard(snap({
    prs: [pr(5, 'feature/x')],
    checks: { 5: 'none' },
  }))
  assert.equal(board.needsUser.filter((n) => n.kind === 'no-ci').length, 0)
})
// ---- follow-up: HTTP-shaped input, clean-main commits, whitespace stdout ----

test('buildTaskBoard accepts the HTTP shape of flowStates (plain object)', () => {
  // Over HTTP the snapshot carries flowStates as a plain object keyed by issue
  // number. Reading only a Map made the host and the browser disagree about the
  // very same snapshot.
  const board = buildTaskBoard(snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
    flowStates: { 26: { issue: 26, grade: 'standard', stage: 'dev', tickets: [], ci: null, review: null, merge: null } },
  }))
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.issue === 26)
  assert.equal(card.grade, 'standard', 'flow state from a plain object must be honoured')
  assert.equal(card.stale, false)
})

test('committing straight onto main is off-flow even with a clean tree', () => {
  // spec names this the canonical violation: dev-flow forbids committing to the
  // trunk. A clean tree does not make it fine.
  const board = buildTaskBoard(snap({
    git: {
      currentBranch: 'main',
      status: { branch: 'main', detached: false, dirty: 0, untracked: 0, conflicts: 0, staged: 0, unstaged: 0 },
      branches: [branch('main', { current: true, ahead: 3 })],
    },
  }))
  assert.equal(board.offFlow.length, 1)
  assert.equal(board.offFlow[0].reason, 'dirty-main')
  assert.equal(board.offFlow[0].files, 0)
})
