/**
 * Turn a repository snapshot into the dev-flow task board.
 *
 * The panel answers three questions in one screen: which issues are still
 * untouched, how far each one got, and what needs the user *now*. Git and GitHub
 * only know evidence (branches, commits, PRs, check runs); dev-flow knows the
 * process. This module bridges the two without touching either.
 *
 * Two rules the rest of the panel depends on:
 *   1. Columns are the dev-flow stages, in flow order, always all present. An
 *      empty column is rendered as "waiting for X" instead of blank space.
 *   2. Conflict arbitration (user decision): git/github evidence wins over the
 *      `.flow` file. A stale `.flow` stage is reported as `stale: true` on the
 *      card, never used to move it to a column the repository cannot back up.
 *
 * Pure: no spawning, no filesystem. The snapshot already carries everything.
 */

import { STAGES } from './flow-state.js'

/** The only four things dev-flow ever asks the user to decide. */
export const NEEDS_USER_KINDS = ['intake-confirm', 'no-ci', 'ci-red-escalated', 'review-pending-decision', 'merge-gate']

/** Cap on the "needs you" strip: a board that lists everything is not a board. */
export const NEEDS_USER_LIMIT = 3

/** CI red is fixed by the agent for at most this many rounds (dev-flow contract). */
export const CI_MAX_ROUNDS = 2

/**
 * Issue number encoded in a dev-flow branch name (`issue-<n>-<desc>`), or null.
 * This is the ONE place the naming convention lives; a rename here changes what
 * the whole board considers "in flow".
 * @returns {number|null}
 */
export function issueFromBranch(name) {
  if (typeof name !== 'string') return null
  const match = /^issue-(\d+)-/.exec(name)
  if (!match) return null
  const number = Number(match[1])
  return Number.isInteger(number) && number > 0 ? number : null
}

/**
 * Normalise `snapshot.flowStates` into a reader.
 *
 * Three shapes reach this function and all three must work:
 *   - a Map (the host's own object, and any vm realm — `instanceof Map` fails there);
 *   - a plain object keyed by issue number (what JSON.parse produces, i.e. the
 *     only shape the browser ever sees);
 *   - nothing.
 * Accepting only a Map made the host answer differently from the browser for the
 * same snapshot.
 * @returns {{get: (issue: number|string) => object|null}}
 */
export function toFlowStateReader(value) {
  if (value === null || value === undefined || typeof value !== 'object') return { get: () => null }
  if (typeof value.get === 'function') return { get: (issue) => value.get(issue) ?? null }
  return { get: (issue) => value[issue] ?? null }
}

function stageIndexOf(stage) {
  return STAGES.indexOf(stage)
}

/**
 * Derive the card's stage from repository evidence alone.
 *
 * Ordered from the end of the flow backwards, because the furthest thing that
 * happened is what the card is about: merged beats an open PR, an open PR beats
 * unpushed commits, unpushed commits beat "just a branch".
 *
 * `hasIssue` without `hasBranch` is intake: dev-flow creates the issue first and
 * the branch only after the plan is confirmed.
 * @param {object} p
 * @returns {'intake'|'spec'|'dev'|'pr'|'ci'|'review'|'merge'|'done'}
 */
export function stageOf({ hasIssue, hasBranch, ahead, pr, checks, merged, flow }) {
  if (merged) return 'done'
  if (pr) {
    if (checks === 'red') return 'ci'
    if (checks === 'green' || checks === 'none') {
      // CI is settled; review is the next gate, and only the flow file knows
      // whether it already ran.
      return flow?.review?.state === 'done' ? 'merge' : 'review'
    }
    return 'ci'
  }
  if (ahead > 0) return 'pr'
  if (hasBranch) return 'dev'
  if (hasIssue) return 'intake'
  return 'spec'
}

/**
 * Why the current workspace is outside dev-flow, or null when it is fine.
 *
 * Three ways to be off-flow, checked in that order:
 *   1. uncommitted work on the trunk — dev-flow forbids committing there at all;
 *   2. work on a branch that does not follow `issue-<n>-*`;
 *   3. work on an `issue-<n>-*` branch whose issue does not exist.
 *
 * Note (2) and (3) do NOT require a dirty tree. The commonest bypass is to
 * branch off, commit and push: the tree is clean, yet no issue owns the work.
 * Gating on `dirty > 0` alone hid exactly that case.
 * @returns {{branch:string, reason:string, files:number, issue?:number}|null}
 */
function offFlowOf(git, knownIssues) {
  const status = git?.status ?? {}
  const dirty = Number.isInteger(status.dirty) ? status.dirty : 0
  const branch = typeof status.branch === 'string' && status.branch.length > 0 ? status.branch : '(detached)'
  const current = git?.currentBranch ?? status.branch

  if (current === 'main' || current === 'master') {
    // dev-flow forbids committing to the trunk at all. Uncommitted work is the
    // obvious case; commits ahead of upstream are the quieter one — the tree is
    // clean, yet the work never had a branch or a review.
    const ahead = trustedAheadOf(git)
    if (dirty > 0 || ahead > 0) {
      return { branch: current, reason: 'dirty-main', files: dirty, ahead }
    }
    return null
  }
  if (current === null || current === undefined || status.detached === true) {
    return dirty > 0 ? { branch, reason: 'unnamed-branch', files: dirty } : null
  }
  const issueNumber = issueFromBranch(current)
  if (issueNumber === null) {
    // Report it even when clean: a committed feature branch is unrouted work.
    return { branch: current, reason: 'unnamed-branch', files: dirty }
  }
  // Forge data may be missing (gh down), in which case we cannot judge the
  // issue exists — stay silent rather than cry wolf.
  if (knownIssues !== null && !knownIssues.has(issueNumber)) {
    return { branch: current, reason: 'unknown-issue', files: dirty, issue: issueNumber }
  }
  return null
}

/** Merge everything known about one issue into a single card. */
function cardOf({ issueNumber, issue, branch, pr, mergedPr, checks, flow }) {
  const evidence = stageOf({
    hasIssue: issue !== null,
    hasBranch: branch !== undefined && branch !== null,
    ahead: branch?.ahead ?? 0,
    pr: pr ?? null,
    checks,
    merged: Boolean(mergedPr),
    flow: flow ?? null,
  })
  // Evidence wins. The flow file may only disagree, and disagreement is shown.
  const stale = flow !== null && flow?.stage !== evidence
  const stageIndex = stageIndexOf(evidence)
  return {
    // The number survives without forge data: it came from the branch name, which
    // is exactly what lets a gh-less repo still show "issue 26 is here".
    issue: issueNumber ?? issue?.number ?? null,
    title: issue !== null ? issue.title : branch?.name ?? '',
    url: issue?.url ?? null,
    grade: flow?.grade ?? null,
    stage: evidence,
    stageIndex: stageIndex < 0 ? 0 : stageIndex,
    columnCount: STAGES.length,
    stale,
    flowStage: flow?.stage ?? null,
    hasBranch: Boolean(branch),
    branchName: branch?.name ?? null,
    ahead: branch?.ahead ?? 0,
    behind: branch?.behind ?? 0,
    prNumber: pr?.number ?? null,
    prUrl: pr?.url ?? null,
    prDraft: pr?.isDraft === true,
    prConflicts: pr?.mergeable === 'CONFLICTING',
    checks: checks ?? 'unknown',
    tickets: flow?.tickets ?? [],
    ci: flow?.ci ?? null,
    review: flow?.review ?? null,
    merge: flow?.merge ?? null,
  }
}

/** Build the whole board. */
export function buildTaskBoard(snapshot) {
  const git = snapshot?.git ?? {}
  const branches = Array.isArray(git.branches) ? git.branches : []
  const issues = Array.isArray(snapshot?.issues) ? snapshot.issues : []
  const prs = Array.isArray(snapshot?.prs) ? snapshot.prs : []
  const mergedPrs = Array.isArray(snapshot?.mergedPrs) ? snapshot.mergedPrs : []
  const checks = snapshot?.checks && typeof snapshot.checks === 'object' ? snapshot.checks : {}
  const flowStates = toFlowStateReader(snapshot?.flowStates)

  const branchByIssue = new Map()
  for (const branch of branches) {
    const n = issueFromBranch(branch?.name)
    if (n !== null && !branchByIssue.has(n)) branchByIssue.set(n, branch)
  }

  // Cards are issue-first (user decision): an open issue with no branch yet is
  // still a card, sitting at intake.
  const keys = new Set()
  for (const issue of issues) {
    if (Number.isInteger(issue?.number)) keys.add(issue.number)
  }
  for (const n of branchByIssue.keys()) keys.add(n)

  const cards = []
  for (const key of keys) {
    const issue = issues.find((i) => i?.number === key) ?? null
    const branch = branchByIssue.get(key) ?? null
    const pr = prs.find((p) => p?.headRefName === branch?.name) ?? null
    const mergedPr = pr === null ? mergedPrs.find((p) => p?.headRefName === branch?.name) ?? null : null
    const checksState = pr === null ? undefined : checks[pr.number]
    cards.push(
      cardOf({ issueNumber: key, issue, branch, pr, mergedPr, checks: checksState, flow: flowStates.get(key) ?? null }),
    )
  }

  const columns = STAGES.map((stage) => ({
    stage,
    cards: cards.filter((c) => c.stage === stage),
    empty: emptyHintOf(stage),
  }))

  // `null` means "we cannot tell" (gh unavailable); a Set means we can.
  const knownIssues = Array.isArray(snapshot?.issues) ? new Set(issues.map((i) => i?.number)) : null
  const offFlowEntry = offFlowOf(git, knownIssues)
  const offFlow = offFlowEntry === null ? [] : [offFlowEntry]

  const needsUser = buildNeedsUser({ cards, allIssues: issues, checks })
  // Mirror the pending items onto the cards they belong to, so a card says what
  // IT is waiting for instead of forcing a look back up at the strip.
  for (const card of cards) {
    card.action = needsUser.find((n) => n.issue !== null && n.issue === card.issue) ?? null
  }

  return {
    columns,
    needsUser,
    offFlow,
    forgeHint: snapshot?.forgeHint ?? null,
  }
}

/**
 * Unpushed commits on the CURRENT branch, from the branch list.
 * Returns 0 when the branch is not listed (detached, or no upstream yet) rather
 * than inventing a number the board would then report as a violation.
 */
function trustedAheadOf(git) {
  const current = git?.currentBranch ?? git?.status?.branch
  if (typeof current !== 'string') return 0
  const branches = Array.isArray(git?.branches) ? git.branches : []
  const entry = branches.find((b) => b?.name === current)
  const ahead = entry?.ahead
  return Number.isInteger(ahead) && ahead > 0 ? ahead : 0
}

/** What an empty column is waiting for; the board reads as a checklist. */
function emptyHintOf(stage) {
  switch (stage) {
    case 'intake': return 'no-unconfirmed-issue'
    case 'spec': return 'no-spec-pending'
    case 'dev': return 'nothing-in-tdd'
    case 'pr': return 'no-branch-awaiting-push'
    case 'ci': return 'no-pr-in-ci'
    case 'review': return 'no-review-pending'
    case 'merge': return 'no-pr-awaiting-merge'
    case 'done': return 'nothing-merged-yet'
    default: return ''
  }
}

/**
 * Strip of items that need the user, capped, blockers first.
 *
 * Every item must map to a real dev-flow gate; anything else (a dirty file, a
 * stale branch) belongs in its own column, not here.
 */
function buildNeedsUser({ cards, allIssues, checks }) {
  const blockers = []
  const infos = []

  // 1. Stop point 1 is "issue created, plan not confirmed". dev-flow creates the
  // branch only AFTER that confirmation, so the signal is an issue with NO
  // branch — not a branch with no .flow file (that would fire on every normal
  // in-flight task and train the user to ignore the strip).
  for (const card of cards) {
    if (card.issue !== null && !card.hasBranch && card.stage === 'intake') {
      infos.push({ kind: 'intake-confirm', issue: card.issue, prNumber: null, severity: 'info' })
    }
  }

  // 2. CI red at the last allowed round: dev-flow forbids a third push.
  for (const card of cards) {
    if (card.checks !== 'red') continue
    const run = card.ci?.run
    const max = card.ci?.max ?? CI_MAX_ROUNDS
    if (Number.isInteger(run) && run >= max) {
      blockers.push({ kind: 'ci-red-escalated', issue: card.issue, prNumber: card.prNumber, severity: 'blocker' })
    }
  }

  // 2b. T4.df: a review that RAN but produced findings (state pending-decision)
  // needs the user's ruling just as much as a finished review needs the merge
  // shout — but before #129-fix it only sat in its column silently. Surface it.
  for (const card of cards) {
    if (card.review?.state !== 'pending-decision') continue
    if (card.prNumber === null) continue
    blockers.push({ kind: 'review-pending-decision', issue: card.issue, prNumber: card.prNumber, severity: 'blocker' })
  }

  // 3. A PR whose review finished is waiting for the literal "merge #n" shout.
  for (const card of cards) {
    if (card.review?.state !== 'done') continue
    if (card.merge?.authorized === true) continue
    if (card.prNumber === null) continue
    blockers.push({ kind: 'merge-gate', issue: card.issue, prNumber: card.prNumber, severity: 'blocker' })
  }

  // 4. No CI at all: a property of the REPOSITORY, so it is answered from the
  // check map itself rather than from cards. A PR on an unplaceable branch would
  // otherwise suppress the question entirely.
  const anyNone = Object.values(checks ?? {}).some((state) => state === 'none')
  if (anyNone) infos.push({ kind: 'no-ci', issue: null, prNumber: null, severity: 'info' })

  return [...blockers, ...infos].slice(0, NEEDS_USER_LIMIT)
}
