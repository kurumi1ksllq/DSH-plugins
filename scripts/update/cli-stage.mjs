/**
 * `stage` command (design stage 2 + 3): materialise the target commit into a
 * staging tree and run every gate against THAT tree. Never touches live code.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { acquireLock, readJson, runId, stateDir, writeJournal } from './lib.mjs'
import { planLinks } from './plan.mjs'
import { localRows } from './args.mjs'
import { stageBundle } from './stage.mjs'
import { DEFAULT_GATES, runGates } from './gates.mjs'
import { MARKER } from './stage-find.mjs'

/** Read the stage marker and stamp it with the live commit it would replace. */
function markerOf(stage, row) {
  const onDisk = readJson(join(stage, MARKER)) ?? {}
  // The marker travels with the tree on an exchange, so the swapped-out copy
  // must already carry the commit it should be rolled back to.
  const stamped = { ...onDisk, liveCommit: row.head }
  writeFileSync(join(stage, MARKER), `${JSON.stringify(stamped, null, 2)}\n`, 'utf8')
  return stamped
}

async function stageOne(row, options, id) {
  const staged = await stageBundle(row, { runId: id, allowDirty: options.allowDirty })
  if (!staged.ok) return { name: row.name, ok: false, detail: staged.detail }
  const gates = await runGates(row.target, options.gates, { row, stage: staged.stage, dshBin: options.dshBin })
  return {
    name: row.name,
    ok: gates.ok,
    stage: staged.stage,
    commit: staged.commit,
    seeded: staged.seeded,
    // The marker on disk carries the STAGED commit; the live commit has to be
    // recorded alongside, or a rollback copy would be misidentified.
    marker: markerOf(staged.stage, row),
    gates,
    detail: gates.ok
      ? 'verified'
      : gates.gates
        .filter((gate) => gate.ok === false)
        .map((gate) => `${gate.gate}: ${gate.results?.[0]?.detail ?? 'failed'}`)
        .join('; '),
  }
}

function printStage(results) {
  const lines = []
  for (const result of results) {
    lines.push(`${result.ok ? 'verified' : 'REJECTED'} ${result.name} @ ${String(result.commit ?? '').slice(0, 12)}`)
    if (result.stage !== undefined) lines.push(`         stage: ${result.stage}`)
    for (const gate of result.gates?.gates ?? []) {
      if (gate.skipped !== undefined) lines.push(`         ${gate.gate.padEnd(9)} skipped (${gate.skipped})`)
      else {
        const worst = gate.results?.find((entry) => entry.outcome !== 'ok' && entry.outcome !== 'skipped')
        lines.push(`         ${gate.gate.padEnd(9)} ${gate.ok === false ? `FAIL — ${worst?.detail ?? ''}` : 'ok'}`)
      }
    }
    if (result.seeded?.length > 0) lines.push(`         seeded generated files: ${result.seeded.join(', ')}`)
    if (!result.ok && result.detail !== undefined) lines.push(`         ${result.detail}`)
  }
  lines.push('')
  lines.push(
    results.every((result) => result.ok)
      ? 'all stages verified; the live tree was not touched. Next: `swap --confirm` exchanges files in place (still no restart).'
      : 'at least one stage failed; the live tree was NOT touched.',
  )
  return lines.join('\n')
}

/** Take the advisory lock, or report why the caller must abort. */
function lock(options) {
  const root = stateDir(options.stateDirPath)
  const held = acquireLock(join(root, 'update.lock'), { waitMs: 5000 })
  if (held.error !== undefined) return { error: held.error }
  return { root, ...held }
}

export async function commandStage(options) {
  const plan = await planLinks(options.profileDir, { target: options.target })
  const rows = localRows(plan, options)
  if (rows.length === 0) return { ok: false, error: 'no local bundle matched --package' }
  const held = lock(options)
  if (held.error !== undefined) return { ok: false, error: held.error }
  const id = runId('stage')
  try {
    const results = []
    for (const row of rows) results.push(await stageOne(row, options, id))
    writeJournal(held.root, id, { command: 'stage', profileDir: options.profileDir, results })
    if (options.json) return { ok: results.every((result) => result.ok), id, results }
    return { ok: results.every((result) => result.ok), text: printStage(results) }
  } finally {
    held.release()
  }
}
