/**
 * Stage 1 of the update tool: PLAN. Read-only, always safe to run.
 *
 * The unit of planning is the profile's `link:` target, NOT "the repository
 * this script lives in": a profile can mix two checkouts of one monorepo (the
 * live one did, see docs/update-checkout.md), so "the repo" is not a
 * well-defined update target.
 *
 * Read-only in the strict sense: it never fetches, so `to` comes from local
 * remote-tracking refs and can be stale. Fetching is stage 2's job, after the
 * user approved the plan.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { gitDirty, gitHead, owningCheckout, readJson, resolveLinkTarget, sh } from './lib.mjs'

/**
 * Short explanation of a revision: `<pkg>@<version>` when a tag for THIS bundle
 * points at the commit, otherwise the abbreviated commit.
 *
 * `git describe --tags` is wrong here: the repository tags every package at the
 * same commits, so it answers with whichever tag sorts first, which would name
 * the wrong package. The only tag that matters is the one naming this bundle.
 */
function describe(checkout, ref, pkgName) {
  const commit = String(ref)
  let tags = []
  try {
    tags = execFileSync('git', ['-C', checkout, 'tag', '--points-at', commit], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    tags = []
  }
  const own = tags.find((tag) => tag.startsWith(`${pkgName}@`))
  return own ?? commit.slice(0, 7)
}

/**
 * Body offset of a bundle directory inside its owning checkout: `packages/x`
 * for `packages/x`, `packages/x/plugin` for a bundle whose entity is `plugin/`.
 */
function bundleBody(rel) {
  const parts = rel.split('/')
  const pkgIndex = parts.lastIndexOf('packages')
  if (pkgIndex === -1 || parts.length < pkgIndex + 2) return rel
  const head = parts.slice(0, pkgIndex + 2).join('/')
  return parts.length > pkgIndex + 2 ? `${head}/${parts.slice(pkgIndex + 2).join('/')}` : head
}

/**
 * THE decisive read: which directory does the profile actually load, from
 * which checkout, at which commit, and what would updating it move it to?
 *
 * @returns {Promise<{profileDir: string, rows: object[], error?: string}>}
 */
export async function planLinks(profileDir, { target = null } = {}) {
  const profile = readJson(join(profileDir, 'package.json'))
  if (profile === null) return { profileDir, rows: [], error: `cannot read ${join(profileDir, 'package.json')}` }
  const dependencies = profile.dependencies ?? {}
  const bundles = new Set(Array.isArray(profile.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : [])
  const rows = []

  for (const [name, spec] of Object.entries(dependencies)) {
    const rowName = name
    const declared = resolveLinkTarget(spec, profileDir)
    const enabled = bundles.size === 0 ? null : bundles.has(name)
    if (declared === null) {
      rows.push({
        name,
        lane: 'manager',
        spec: String(spec),
        enabled,
        status: 'manager-lane',
        reasons: [],
        notes: ['registry/git spec: install and update belong to dsh-plugin-manager, not to a file swap'],
      })
      continue
    }

    const reasons = []
    const notes = []
    if (!existsSync(declared)) {
      rows.push({ name, lane: 'local', spec, enabled, target: declared, status: 'blocked', reasons: ['link target does not exist on disk'], notes })
      continue
    }
    const real = realpathSync(declared)
    const checkout = await owningCheckout(real)
    if (checkout === null) {
      rows.push({ name, lane: 'local', spec, enabled, target: real, status: 'blocked', reasons: ['link target is not inside a git checkout'], notes })
      continue
    }

    const rel = real.slice(checkout.length + 1)
    const body = bundleBody(rel)
    const head = await gitHead(checkout)
    // Scope the dirty check to the package directory, not to the bundle body
    // alone: for a `plugin/` bundle the body is `packages/x/plugin`, and an
    // exchange would move uncommitted work elsewhere in `packages/x` aside too.
    const repoPath = body.split('/').slice(0, body.split('/').indexOf('packages') + 2).join('/')
    const dirty = await gitDirty(checkout, repoPath)
    if (dirty !== null && dirty.length > 0) {
      reasons.push(`working tree dirty under ${body} (${dirty.split('\n').length} path(s)): a swap would move uncommitted work aside`)
    }
    if (real !== declared) notes.push(`link spec points at ${declared}, realpath is ${real} (symlinked wiring)`)

    let to = target
    let upstream = null
    if (to === null) {
      const upstreamRef = await sh('git', ['-C', checkout, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      if (upstreamRef.ok) {
        upstream = upstreamRef.stdout.trim()
        const resolvedUpstream = await sh('git', ['-C', checkout, 'rev-parse', upstream])
        if (resolvedUpstream.ok) to = resolvedUpstream.stdout.trim()
      }
    }

    const status = reasons.length > 0
      ? 'blocked'
      : to === null
        ? 'unknown-target'
        : to === head
          ? 'up-to-date'
          : 'updatable'

    rows.push({
      name,
      lane: 'local',
      spec,
      enabled,
      status,
      reasons,
      notes,
      checkout,
      body,
      target: real,
      // Commit the live directory holds right now: the value a swap must
      // record so a later rollback can recognise its own copy.
      head,
      liveCommit: head,
      markerLiveCommit: head,
      from: describe(checkout, head ?? 'HEAD', rowName),
      to: to === null ? null : describe(checkout, to, rowName),
      upstream,
      to_commit: to,
      fetched: false,
    })
  }

  return { profileDir, rows }
}

export function summarize(rows) {
  const count = (status) => rows.filter((row) => row.status === status).length
  const checkouts = new Map()
  for (const row of rows) {
    if (row.checkout === undefined) continue
    checkouts.set(row.checkout, (checkouts.get(row.checkout) ?? 0) + 1)
  }
  return {
    total: rows.length,
    local: rows.filter((row) => row.lane === 'local').length,
    managerLane: count('manager-lane'),
    updatable: count('updatable'),
    upToDate: count('up-to-date'),
    blocked: count('blocked'),
    unknownTarget: count('unknown-target'),
    checkouts: [...checkouts.entries()].map(([checkout, packages]) => ({ checkout, packages })),
  }
}
