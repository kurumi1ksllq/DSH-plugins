/**
 * Read the dev-flow task state a branch keeps next to its spec.
 *
 * Git and GitHub say what happened to a branch (dirty files, commits ahead,
 * a PR, CI runs). They cannot say what the agent is doing inside TDD — whether
 * the current ticket is red or green, how many CI self-repair rounds are spent,
 * or whether a review report is waiting for the user's ruling. dev-flow's own
 * contract makes a file the single source of truth for that, so the panel reads
 * `docs/specs/.flow/<issue>.json` from the *same* repo it already describes.
 *
 * This module is deliberately unforgiving about the file's shape and forgiving
 * about its existence: a missing file is the normal case (a repo that never ran
 * dev-flow), while a malformed one is a bug worth surfacing as "no state" rather
 * than a crash inside the web route. Every bad input resolves to null, never a
 * throw, and never a partially-filled object that the board would render as
 * fact.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Stage values double as the board's column ids, in flow order. */
export const STAGES = ['intake', 'spec', 'dev', 'pr', 'ci', 'review', 'merge', 'done']

/** The only two dev-flow grades. `trivial` is a user decision, never inferred. */
export const GRADES = ['trivial', 'standard']

/** Per-ticket TDD state: red before green, done after the four checks pass. */
export const TICKET_STATES = ['todo', 'red', 'green', 'done']

/** CI three-state contract plus `unknown` for "gh could not tell us". */
export const CI_STATUSES = ['green', 'red', 'none', 'unknown']

/** Review runs once (two axes) and then waits for the user's ruling. */
export const REVIEW_STATES = ['not-started', 'running', 'pending-decision', 'done']

const FLOW_DIR = ['docs', 'specs', '.flow']

/**
 * Absolute path of one issue's flow file inside a repo.
 * The number is validated by callers; this is the single place that spells the
 * directory out, so the reader and any future writer cannot drift apart.
 * @returns {string}
 */
export function flowStatePath(repoDir, issue) {
  return join(repoDir, ...FLOW_DIR, `${issue}.json`)
}

/** Positive integer issue number, or null. Guards path traversal by construction. */
function toIssueNumber(issue) {
  if (typeof issue === 'number') {
    return Number.isInteger(issue) && issue > 0 ? issue : null
  }
  if (typeof issue === 'string' && /^[1-9][0-9]*$/.test(issue)) return Number(issue)
  return null
}

function isEnum(value, allowed) {
  return typeof value === 'string' && allowed.includes(value)
}

/** A non-negative integer, or null. */
function toCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

function parseTickets(raw) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const out = []
  for (const ticket of raw) {
    if (!ticket || typeof ticket !== 'object') return null
    if (!Number.isInteger(ticket.id)) return null
    if (!isEnum(ticket.state, TICKET_STATES)) return null
    out.push({
      id: ticket.id,
      title: typeof ticket.title === 'string' ? ticket.title : '',
      state: ticket.state,
    })
  }
  return out
}

function parseCi(raw) {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') return null
  if (!isEnum(raw.status, CI_STATUSES)) return null
  // A partial block still renders (the board can say "red" without a round
  // count); what it may never do is invent a status.
  return { run: toCount(raw.run), max: toCount(raw.max), status: raw.status }
}

function parseReview(raw) {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') return null
  if (!isEnum(raw.state, REVIEW_STATES)) return null
  return { state: raw.state, axes: toCount(raw.axes) }
}

function parseMerge(raw) {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') return null
  if (typeof raw.authorized !== 'boolean') return null
  return { authorized: raw.authorized }
}

/**
 * Validate one parsed flow file. Returns the normalised state or null.
 * @param {unknown} raw
 * @param {number} issue the issue number the caller asked for
 */
export function normalizeFlowState(raw, issue) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.issue !== issue) return null
  if (!isEnum(raw.grade, GRADES)) return null
  if (!isEnum(raw.stage, STAGES)) return null
  const tickets = parseTickets(raw.tickets)
  if (tickets === null) return null
  const ci = parseCi(raw.ci)
  if (raw.ci !== undefined && raw.ci !== null && ci === null) return null
  const review = parseReview(raw.review)
  if (raw.review !== undefined && raw.review !== null && review === null) return null
  const merge = parseMerge(raw.merge)
  if (raw.merge !== undefined && raw.merge !== null && merge === null) return null
  return {
    issue,
    grade: raw.grade,
    stage: raw.stage,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    tickets,
    ci,
    review,
    merge,
  }
}

/**
 * Read and validate `docs/specs/.flow/<issue>.json`.
 *
 * Missing file, unreadable file, malformed JSON, wrong issue number, and any
 * out-of-contract enum all resolve to null: the board then renders that card
 * from git evidence alone instead of claiming a stage nobody recorded.
 * @returns {Promise<object|null>}
 */
export async function readFlowState(repoDir, issue) {
  const number = toIssueNumber(issue)
  if (number === null) return null
  if (typeof repoDir !== 'string' || repoDir.length === 0) return null
  let text
  try {
    text = await readFile(flowStatePath(repoDir, number), 'utf8')
  } catch {
    return null
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  return normalizeFlowState(raw, number)
}

/**
 * Read every flow file a repo carries, keyed by issue number.
 * Unknown or broken files are skipped rather than failing the whole board.
 * @param {string} repoDir
 * @param {number[]} issues issue numbers worth reading (the board's cards)
 * @returns {Promise<Map<number, object>>}
 */
export async function readFlowStates(repoDir, issues) {
  const numbers = [...new Set((issues ?? []).map(toIssueNumber).filter((n) => n !== null))]
  const entries = await Promise.all(numbers.map(async (n) => [n, await readFlowState(repoDir, n)]))
  const out = new Map()
  for (const [n, state] of entries) {
    if (state !== null) out.set(n, state)
  }
  return out
}
