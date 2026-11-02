#!/usr/bin/env node
/**
 * Reliable plugin updater for the bundles linked into a DSH profile.
 *
 *   node scripts/update.mjs plan     [--profile-dir DIR] [--target REF] [--json]
 *   node scripts/update.mjs fetch    [--profile-dir DIR] [--package NAME]
 *   node scripts/update.mjs stage    [--profile-dir DIR] [--package NAME] [--gates a,b,c]
 *   node scripts/update.mjs swap     [--profile-dir DIR] [--package NAME] --confirm
 *   node scripts/update.mjs rollback [--profile-dir DIR] [--package NAME] --confirm
 *   node scripts/update.mjs observe  [--profile-dir DIR]
 *
 * Design: docs/update-scheme.md (§4.2) and docs/update-checkout.md.
 *
 * Non-negotiables this CLI encodes:
 *   1. Verify everything BEFORE the swap — HMR does not restore the old version
 *      when the replacement fails to import.
 *   2. Replace files in place at the same realpath. Pointing `link:` at a new
 *      directory is `package-moved`, which forces a restart.
 *   3. Never restart DSH. A `restart required:` verdict is reported, not acted on.
 *
 * Every mutating stage takes the same advisory lock and appends to one journal,
 * so an interrupted run is recoverable by `rollback`: the previous generation
 * still sits at the staging path — that is what RENAME_EXCHANGE leaves there.
 */
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs, USAGE, commandPlan, printPlan, localRows } from './update/args.mjs'
import { commandStage } from './update/cli-stage.mjs'
import { currentObservation, describeExchange, runExchange, runObserve } from './update/cli-swap.mjs'
import { acquireLock, runId, stateDir, writeJournal } from './update/lib.mjs'
import { planLinks, summarize } from './update/plan.mjs'
import { fetchCheckout } from './update/stage.mjs'
import { locateRollback, locateStage } from './update/stage-find.mjs'

/** Take the advisory lock, or return the reason the caller must abort. */
function lock(options) {
  const root = stateDir(options.stateDirPath)
  const held = acquireLock(join(root, 'update.lock'), { waitMs: 5000 })
  if (held.error !== undefined) return { error: held.error }
  return { root, ...held }
}

async function commandFetch(options) {
  const plan = await planLinks(options.profileDir, { target: options.target })
  const rows = localRows(plan, options)
  if (rows.length === 0) return { ok: false, error: 'no local bundle matched --package' }
  const held = lock(options)
  if (held.error !== undefined) return { ok: false, error: held.error }
  const id = runId('fetch')
  try {
    const seen = new Map()
    const results = []
    for (const row of rows) {
      if (!seen.has(row.checkout)) seen.set(row.checkout, await fetchCheckout(row.checkout))
      results.push({ name: row.name, ...seen.get(row.checkout) })
    }
    writeJournal(held.root, id, { command: 'fetch', profileDir: options.profileDir, results })
    const fresh = await planLinks(options.profileDir, { target: options.target })
    if (options.json) {
      return { ok: results.every((result) => result.ok), id, results, plan: { rows: fresh.rows, summary: summarize(fresh.rows) } }
    }
    return {
      ok: results.every((result) => result.ok),
      text: [
        ...results.map((result) => `${result.ok ? 'fetched ' : 'FAILED  '} ${result.checkout}${result.ok ? '' : ` — ${result.detail}`}`),
        '',
        printPlan(fresh),
      ].join('\n'),
    }
  } finally {
    held.release()
  }
}

/** Shared body of `swap` and `rollback`: same lock, journal and reporting. */
async function exchangeCommand(options, { verb, done, journalLabel }) {
  const plan = await planLinks(options.profileDir, { target: options.target })
  const rows = localRows(plan, options)
  if (rows.length === 0) return { ok: false, error: 'no local bundle matched --package' }
  const held = lock(options)
  if (held.error !== undefined) return { ok: false, error: held.error }
  const id = runId(journalLabel)
  const outcomes = []
  try {
    for (const row of rows) {
      // `swap` and `rollback` look for DIFFERENT things at the staging path:
      // an update candidate, or a copy the journal proves holds the previous
      // generation. Using one locator for both is how a rollback could silently
      // exchange in the wrong direction.
      const located = journalLabel === 'rollback'
        ? locateRollback(row, { stateRoot: held.root })
        : locateStage(row, { preferCommit: options.target, stateRoot: held.root })
      if (located === null) {
        outcomes.push({
          name: row.name,
          ok: false,
          detail: journalLabel === 'rollback'
            ? 'no rollback copy found: no swap journal records this bundle as exchanged'
            : 'no verified stage found for this bundle; run `stage` first',
        })
        continue
      }
      if (journalLabel === 'swap' && located.origin === 'swap') {
        outcomes.push({ name: row.name, ok: false, detail: 'this staging path already holds the previous generation; run `stage` again to build a new candidate' })
        continue
      }
      if (journalLabel === 'swap' && located.marker.commit === row.head) {
        outcomes.push({ name: row.name, ok: false, detail: 'the staged commit equals the live commit; nothing to swap' })
        continue
      }
      outcomes.push(await runExchange({ row, located, options, stateRoot: held.root, runId: id, verb }))
    }
    const observation = journalLabel === 'swap' && options.confirm ? currentObservation(options.profileDir).report : null
    writeJournal(held.root, id, { command: journalLabel, profileDir: options.profileDir, confirm: options.confirm, outcomes, observation })
    if (options.json) return { ok: outcomes.every((outcome) => outcome.ok), id, outcomes, observation }
    const lines = outcomes.map((outcome) => describeExchange(outcome, done))
    if (observation !== null) {
      lines.push('', `observe: verdict=${observation.verdict}`, `         ${observation.advice ?? 'no advice'}`)
      lines.push('         trigger one recomposition, then check the plugin page; `rollback --confirm` undoes the exchange.')
    } else if (!options.confirm && outcomes.every((outcome) => outcome.ok)) {
      lines.push('', 'dry run: nothing was touched. Re-run with --confirm to exchange the files.')
    }
    return { ok: outcomes.every((outcome) => outcome.ok), text: lines.join('\n') }
  } finally {
    held.release()
  }
}

const COMMANDS = {
  plan: commandPlan,
  fetch: commandFetch,
  stage: commandStage,
  swap: (options) => exchangeCommand(options, { verb: 'exchange', done: 'swapped', journalLabel: 'swap' }),
  rollback: (options) => exchangeCommand(options, { verb: 'exchange back', done: 'restored', journalLabel: 'rollback' }),
  observe: runObserve,
}

export async function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`)
    process.exitCode = 2
    return
  }
  const command = COMMANDS[options.command]
  if (command === undefined) {
    process.stdout.write(`${USAGE}\n`)
    process.exitCode = options.command === 'help' ? 0 : 2
    return
  }
  let result
  try {
    result = await command(options)
  } catch (error) {
    result = { ok: false, error: String(error?.message ?? error) }
  }
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else if (result.text !== undefined) process.stdout.write(`${result.text}\n`)
  else if (result.error !== undefined) process.stderr.write(`update: ${result.error}\n`)
  process.exitCode = result.ok ? 0 : 1
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) await main(process.argv.slice(2))
