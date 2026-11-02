/**
 * Stage 2 of the update tool: FETCH + STAGE.
 *
 * Nothing here touches the live tree. It refreshes the remote-tracking refs in
 * the checkout that owns a bundle, then materialises the target commit into
 * `<checkout>/.tmp/update/stage/<runId>/<body>`.
 *
 * Why a staging tree inside the checkout and not `git worktree` or $TMPDIR:
 * the stage is exchanged into the live path later, and rename(2) cannot cross
 * filesystems — staging under /tmp would silently degrade the atomic exchange
 * into copy+delete. `git worktree` additionally writes `.git/worktrees/*` into
 * a checkout we intend to keep, and a fresh worktree has no gitignored build
 * output, so its `package.json` main would be unresolvable.
 *
 * The stage is seeded from the live tree's gitignored, generated files
 * (`plugin/lib/**`) only where the fresh tree lacks them. The `build` gate
 * then still re-checks freshness from sources, so a stage that merely
 * *inherited* a stale artifact fails anyway.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { sh, tail } from './lib.mjs'

/** Generated bundles whose runtime files are produced by their own build. */
export const GENERATED = [
  {
    body: 'packages/dsh-websearch-failover',
    outputs: ['plugin/lib'],
  },
]

const MARKER = '.dsh-update-stage.json'

export function stageRoot(checkout, runId) {
  return join(checkout, '.tmp', 'update', 'stage', runId)
}

export function stagePath(checkout, runId, body) {
  return join(stageRoot(checkout, runId), body)
}

/** Refresh remote-tracking refs. Read-only for the working tree. */
export async function fetchCheckout(checkout, { remote = 'origin', timeoutMs = 180000 } = {}) {
  const out = await sh('git', ['-C', checkout, 'fetch', '--prune', remote], { timeoutMs })
  return { checkout, ok: out.ok, detail: out.ok ? 'fetched' : tail(out, 3) }
}

/**
 * Untar one commit of `body` out of a checkout into `dest`, unwrapping the
 * leading `<body>/` directory so `dest` itself is the bundle.
 */
async function extractBundle(checkout, commit, body, dest) {
  const tarFile = `${dest}.tar`
  const withPrefix = await sh('git', ['-C', checkout, 'archive', '--format=tar', `--output=${tarFile}`, commit, '--', body])
  if (!withPrefix.ok) return { ok: false, detail: `git archive ${commit} ${body}: ${tail(withPrefix, 2)}` }

  const outer = join(dest, '..', `.extract-${process.pid}`)
  rmSync(outer, { recursive: true, force: true })
  mkdirSync(outer, { recursive: true })
  const untar = await sh('tar', ['-x', '-f', tarFile, '-C', outer])
  rmSync(tarFile, { force: true })
  if (!untar.ok) return { ok: false, detail: `tar -x: ${tail(untar, 2)}` }

  const inner = join(outer, body)
  if (!existsSync(inner)) {
    // Commit predates the monorepo layout: same paths at the repository root.
    for (const entry of readdirSync(outer)) cpSync(join(outer, entry), join(dest, entry), { recursive: true, dereference: true })
  } else {
    for (const entry of readdirSync(inner)) cpSync(join(inner, entry), join(dest, entry), { recursive: true, dereference: true })
  }
  rmSync(outer, { recursive: true, force: true })
  return { ok: true }
}

/**
 * Materialise `commit` into the staging path for one bundle.
 *
 * @returns {Promise<{ok: boolean, stage: string, commit?: string, seeded?: string[], detail?: string}>}
 */
export async function stageBundle(row, { runId, commit = null, allowDirty = false } = {}) {
  if (row.status === 'blocked' && !allowDirty) {
    return { ok: false, stage: row.target ?? '', detail: `plan is blocked: ${row.reasons.join('; ')}` }
  }
  // Resolve the requested revision to a commit id: `row.to_commit` is already
  // one, but an explicit `--target origin/next` is a ref name and must be
  // pinned here, or the marker would claim "verified" for a moving ref.
  const requested = commit ?? row.to_commit ?? row.head
  if (requested === null || requested === undefined) return { ok: false, stage: row.target ?? '', detail: 'no target commit' }
  const resolved = await sh('git', ['-C', row.checkout, 'rev-parse', '--verify', `${requested}^{commit}`])
  if (!resolved.ok) return { ok: false, stage: row.target ?? '', detail: `cannot resolve ${requested}: ${tail(resolved, 2)}` }
  const to = resolved.stdout.trim()

  const dest = stagePath(row.checkout, runId, row.body)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  const extracted = await extractBundle(row.checkout, to, row.body, dest)
  if (!extracted.ok) return { ok: false, stage: dest, detail: extracted.detail }

  const seeded = seedGenerated(row, dest)
  // Record the live commit too: the marker travels with the tree when the two
  // directories are exchanged, and the swapped-out copy is the rollback target.
  writeFileSync(
    join(dest, MARKER),
    `${JSON.stringify({ runId, commit: to, liveCommit: row.head, body: row.body, checkout: row.checkout, stagedAt: new Date().toISOString(), seeded }, null, 2)}\n`,
    'utf8',
  )
  return { ok: true, stage: dest, commit: to, seeded }
}

/**
 * Copy gitignored generated outputs from the live tree when the staged tree
 * does not contain them. Without this, a repository that gitignores its
 * bundle output stages a package whose entry cannot be imported, and the
 * `build` gate would blame the candidate instead of the artifact policy.
 */
export function seedGenerated(row, dest) {
  const seeded = []
  for (const target of GENERATED) {
    const relBody = relative(row.body, target.body)
    if (relBody.startsWith('..')) continue
    const liveBundle = relBody === '' ? join(row.checkout, row.body) : join(row.checkout, row.body, relBody)
    const stagedBundle = relBody === '' ? dest : join(dest, relBody)
    if (!existsSync(stagedBundle)) continue
    for (const output of target.outputs) {
      const from = join(liveBundle, output)
      const to = join(stagedBundle, output)
      if (!existsSync(from) || existsSync(to)) continue
      cpSync(from, to, { recursive: true })
      seeded.push(relative(dest, to))
    }
  }
  return seeded
}

/** Drop a staging tree. Never touches the live path. */
export function discardStage(checkout, runId) {
  rmSync(stageRoot(checkout, runId), { recursive: true, force: true })
}

/** True when the staging tree carries our marker (guards blind exchanges). */
export function isStage(dir) {
  return existsSync(join(dir, MARKER))
}

export function readStageMarker(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), 'utf8'))
  } catch {
    return null
  }
}

/** Total size of a directory tree, for the report. */
export function dirBytes(dir) {
  let total = 0
  const walk = (current) => {
    let entries = []
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        try {
          total += statSync(full).size
        } catch {
          /* raced with a builder; ignore */
        }
      }
    }
  }
  walk(dir)
  return total
}
