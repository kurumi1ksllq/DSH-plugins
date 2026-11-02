/**
 * `swap`, `rollback` and `observe` commands.
 *
 * `swap` is dry-run unless `--confirm`. A real swap:
 *   1. takes the advisory lock;
 *   2. snapshots the five profile files it could disturb;
 *   3. exchanges the live bundle directory with the verified staging tree in
 *      ONE syscall (old generation lands at the staging path = free rollback);
 *   4. refreshes git's index stats so `git status` does not report the whole
 *      package as modified;
 *   5. observes, and reports a `restart required:` reason instead of ever
 *      restarting DSH.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { snapshotProfileFiles } from './lib.mjs'
import { preflight, refreshIndex, swapTrees } from './swap.mjs'
import { logCandidates, observe, tailFile } from './observe.mjs'

/**
 * Commit the live directory holds right now. For a fresh stage that is the
 * plan's `head`. For a rollback copy (origin 'swap') the tree at that path IS
 * the pre-swap generation, so the marker commit recorded then is the answer.
 */
function liveCommitOf(located) {
  // For a rollback copy the tree at that path IS the pre-swap generation.
  if (located.origin === 'swap') return located.marker.commit
  return located.marker.liveCommit ?? located.marker.prevCommit ?? null
}

export function currentObservation(profileDir) {
  const logFile = logCandidates(profileDir).find((file) => existsSync(file)) ?? null
  return { logFile, report: observe({ logTail: logFile === null ? null : tailFile(logFile) }) }
}

function swapBlocker(row, located) {
  if (located === null) return 'no verified stage found for this bundle; run `stage` first'
  if (located.marker.commit === row.head) return 'the staged commit equals the live commit; nothing to swap'
  const problems = preflight(row.target, located.dir)
  return problems.length > 0 ? problems.join('; ') : null
}

/**
 * Exchange one bundle's live directory with its verified stage, or report what
 * would happen when `--confirm` is absent.
 */
export async function runExchange({ row, located, options, stateRoot, runId: id, verb }) {
  if (!options.confirm) {
    return { name: row.name, ok: true, dryRun: true, detail: `would ${verb} ${row.target} <-> ${located.dir}` }
  }
  const snapshot = snapshotProfileFiles(options.profileDir, join(stateRoot, 'snapshots', id, row.name))
  const swapped = swapTrees(row.target, located.dir, { allowNonatomic: options.allowNonatomic })
  if (swapped.error !== undefined) return { name: row.name, ok: false, detail: swapped.error }
  const refreshed = refreshIndex(row.checkout)
  return {
    name: row.name,
    ok: true,
    mode: swapped.mode,
    live: row.target,
    old: located.dir,
    // The commit the live directory held BEFORE the exchange. Recording it is
    // what lets a later `rollback` recognise this tree as its rollback copy.
    liveCommit: liveCommitOf(located),
    swappedIn: located.marker.commit,
    snapshot: snapshot.kept,
    refreshed,
    targetCommit: located.marker.commit,
  }
}

/** One report line per exchange outcome. */
export function describeExchange(outcome, done) {
  if (outcome.ok && outcome.dryRun) return `dry-run      ${outcome.name} - ${outcome.detail}`
  if (!outcome.ok) return `REFUSED      ${outcome.name} - ${outcome.detail}`
  return `${done.padEnd(12)} ${outcome.name} - ${outcome.mode}: ${outcome.old} now holds the other generation (${String(outcome.targetCommit).slice(0, 12)})`
}

export async function runObserve(options) {
  const { logFile, report } = currentObservation(options.profileDir)
  if (options.json) return { ok: true, logFile, report }
  return {
    ok: true,
    text: [
      `log: ${logFile ?? '(no service log found; verdict uses the available evidence only)'}`,
      `verdict: ${report.verdict}`,
      `restart reasons: ${report.restartReasons.length === 0 ? '(none seen)' : report.restartReasons.join(', ')}`,
      ...(report.advice === null ? [] : [`advice: ${report.advice}`]),
    ].join('\n'),
  }
}

