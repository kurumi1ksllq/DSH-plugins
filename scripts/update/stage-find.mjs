/**
 * Locate the staging tree for a bundle: the newest `<checkout>/.tmp/update/
 * stage/<runId>/<body>` that carries our marker file.
 *
 * The marker is what makes an exchange safe to attempt: a directory without it
 * is not a generation we produced, verified, or know how to roll back to.
 *
 * After a successful swap the roles invert: the staging path now holds the
 * PREVIOUS generation (that is the free rollback copy), and its marker travelled
 * with the tree. So a stage found there is a rollback candidate, not an update
 * candidate, and it is identified by the swap journal rather than by the marker
 * alone.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readJson, stateDir } from './lib.mjs'

export const MARKER = '.dsh-update-stage.json'

export function stageRoot(checkout, id) {
  return join(checkout, '.tmp', 'update', 'stage', id)
}

export function stagePath(checkout, id, body) {
  return join(stageRoot(checkout, id), body)
}

/** All stages for one bundle, newest first, each tagged with its origin. */
export function listStages(row, { stateRoot = null } = {}) {
  const base = join(row.checkout, '.tmp', 'update', 'stage')
  if (!existsSync(base)) return []
  const found = []
  for (const id of readdirSync(base).sort().reverse()) {
    const dir = stagePath(row.checkout, id, row.body)
    if (!existsSync(dir)) continue
    // What this path holds is decided by the LATEST exchange that touched it,
    // not by whether some swap ever mentioned it: a rollback moves the
    // candidate back into the staging path, so "swapped once" is not a
    // permanent property of a directory.
    const latest = latestExchange(row, dir, stateRoot)
    if (latest !== null && latest.command === 'swap') {
      found.push({ id, dir, marker: markerForRollbackCopy(row, latest.outcome), origin: 'swap' })
      continue
    }
    const onDisk = readJson(join(dir, MARKER))
    if (onDisk !== null) found.push({ id, dir, marker: onDisk, origin: 'stage' })
  }
  return found
}

/** Marker-shaped view of the generation a swap left at the staging path. */
function markerForRollbackCopy(row, outcome) {
  return {
    // The commit now sitting there: whatever was live before the exchange.
    // With nothing recorded, the plan's live commit is the best guess.
    commit: outcome.liveCommit ?? row.head,
    body: row.body,
    checkout: row.checkout,
    fromSwap: true,
    swappedIn: outcome.swappedIn ?? null,
  }
}

/**
 * The most recent exchange (swap or rollback) that moved this staging path.
 *
 * Both commands write `outcome.old` = the staging directory they exchanged, so
 * the newest such outcome tells us what that directory holds now:
 * `swap` → the previous generation (a rollback copy);
 * `rollback` → the candidate that was just swapped back out of live.
 *
 * Journals are per-run (`swap-<id>.jsonl`, `rollback-<id>.jsonl`), so the
 * stage's run id is only a path fragment to match on — never a file name.
 */
function latestExchange(row, dir, stateRoot = null) {
  const journalRoot = join(stateRoot ?? stateDir(), 'journal')
  if (!existsSync(journalRoot)) return null
  const files = readdirSync(journalRoot).filter((name) => name.startsWith('swap-') || name.startsWith('rollback-'))
  let latest = null
  for (const name of files) {
    const command = name.startsWith('swap-') ? 'swap' : 'rollback'
    const file = join(journalRoot, name)
    if (!existsSync(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue // a torn line is not a record
      }
      if (record.command !== command) continue
      for (const outcome of record.outcomes ?? []) {
        if (outcome.ok !== true || outcome.name !== row.name || outcome.old !== dir) continue
        // Order by the record's own timestamp, not by file name: sorting
        // `swap-*` against `rollback-*` alphabetically is not chronological,
        // and picking the wrong one flips the rollback direction.
        if (latest === null || record.at > latest.at) latest = { command, outcome, at: record.at }
      }
    }
  }
  return latest
}

/**
 * The newest stage whose commit differs from the live commit — i.e. a real
 * update candidate. Falls back to the newest stage at all, so the caller can
 * explain "this is the same commit" instead of "no stage".
 */
export function locateStage(row, { preferCommit = null, stateRoot = null } = {}) {
  const stages = listStages(row, { stateRoot })
  if (stages.length === 0) return null
  if (preferCommit !== null) {
    const hit = stages.find((stage) => stage.marker.commit === preferCommit)
    if (hit !== undefined) return hit
  }
  const differing = stages.find((stage) => stage.marker.commit !== row.head)
  return differing ?? stages[0]
}

/**
 * The newest rollback copy: a stage the swap journal says holds the previous
 * generation. `rollback` must use this, never `locateStage`, or it could
 * exchange in the wrong direction.
 */
export function locateRollback(row, { stateRoot = null } = {}) {
  return listStages(row, { stateRoot }).find((stage) => stage.origin === 'swap') ?? null
}

export const isStage = (dir) => readJson(join(dir, MARKER)) !== null
