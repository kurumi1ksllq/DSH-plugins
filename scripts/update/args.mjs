/**
 * Argument parsing and the read-only `plan` rendering for scripts/update.mjs.
 */
import { join, resolve } from 'node:path'

import { ALL_GATES, DEFAULT_GATES } from './gates.mjs'
import { planLinks, summarize } from './plan.mjs'

export const USAGE = `usage: node scripts/update.mjs <plan|fetch|stage|swap|rollback|observe> [options]

  --profile-dir DIR   DSH profile to read (default $DSH_HOME/profiles/web)
  --package NAME      restrict to one bundle name (repeatable)
  --target REF        pin the target revision (default: each checkout's upstream)
  --gates LIST        comma list from ${ALL_GATES.join(', ')} (default: ${DEFAULT_GATES.join(', ')})
  --state-dir DIR     override the journal/lock root (default $DSH_HOME/update)
  --dsh BIN           dsh binary for the compose gate (default: dsh on PATH)
  --allow-dirty       stage a bundle whose working tree is dirty (documented risk)
  --allow-nonatomic   accept a non-atomic swap when RENAME_EXCHANGE is unavailable
  --confirm           actually mutate (swap/rollback); without it they are dry runs
  --json              machine-readable output`

export function parseArgs(argv) {
  const options = {
    command: argv[0] ?? 'plan',
    profileDir: null,
    packages: [],
    target: null,
    gates: [...DEFAULT_GATES],
    stateDirPath: null,
    dshBin: 'dsh',
    allowDirty: false,
    allowNonatomic: false,
    confirm: false,
    json: false,
  }
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile-dir') options.profileDir = resolve(argv[++i])
    else if (arg === '--package') options.packages.push(argv[++i])
    else if (arg === '--target') options.target = argv[++i]
    else if (arg === '--gates') options.gates = String(argv[++i]).split(',').map((gate) => gate.trim()).filter(Boolean)
    else if (arg === '--state-dir') options.stateDirPath = resolve(argv[++i])
    else if (arg === '--dsh') options.dshBin = argv[++i]
    else if (arg === '--allow-dirty') options.allowDirty = true
    else if (arg === '--allow-nonatomic') options.allowNonatomic = true
    else if (arg === '--confirm') options.confirm = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.command = 'help'
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
  }
  if (options.profileDir === null) {
    const home = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(process.env.HOME ?? '.', '.dsh')
    options.profileDir = join(home, 'profiles', 'web')
  }
  const bad = options.gates.filter((gate) => !ALL_GATES.includes(gate))
  if (bad.length > 0) throw new Error(`unknown gate(s): ${bad.join(', ')}`)
  return options
}

const wanted = (row, options) => options.packages.length === 0 || options.packages.includes(row.name)

export const localRows = (plan, options) => plan.rows.filter((row) => row.lane === 'local' && wanted(row, options))

export function printPlan(plan) {
  const summary = summarize(plan.rows)
  const lines = [`profile: ${plan.profileDir}`]
  for (const { checkout, packages } of summary.checkouts) lines.push(`  checkout ${checkout}: ${packages} local package(s)`)
  lines.push('')
  for (const row of plan.rows) {
    lines.push(`${row.status.padEnd(14)} ${row.name}  [${row.lane}]${row.enabled === false ? ' (not in dsh.profile.bundles)' : ''}`)
    if (row.lane === 'local') {
      lines.push(`               ${row.checkout} (${row.body})`)
      lines.push(`               ${row.from} -> ${row.to ?? '(unknown target)'}${row.upstream ? ` via ${row.upstream}` : ''}`)
    }
    for (const note of row.notes) lines.push(`               · ${note}`)
    for (const reason of row.reasons) lines.push(`               ! ${reason}`)
  }
  lines.push('')
  lines.push(
    `total=${summary.total} local=${summary.local} manager=${summary.managerLane} updatable=${summary.updatable} up-to-date=${summary.upToDate} blocked=${summary.blocked}`,
  )
  if (summary.checkouts.length > 1) {
    lines.push('')
    lines.push(
      `NOTE: this profile loads ${summary.checkouts.length} different checkouts, so updating only one of them yields a mixed-generation profile — see docs/update-checkout.md.`,
    )
  }
  return lines.join('\n')
}

export async function commandPlan(options) {
  const plan = await planLinks(options.profileDir, { target: options.target })
  if (plan.error !== undefined) throw new Error(plan.error)
  if (options.json) return { ok: true, plan: { profileDir: plan.profileDir, rows: plan.rows, summary: summarize(plan.rows) } }
  return { ok: true, text: printPlan(plan) }
}
