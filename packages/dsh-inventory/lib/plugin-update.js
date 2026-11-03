/**
 * The decision half of "update the plugins from the Plugins page" (issue #45).
 *
 * Everything here is about deciding whether an update may start, and what it
 * would change. Nothing here moves a file: the route that calls this does that,
 * and only after `checkUpdatable` says yes.
 *
 * Why the gate is strict: a recomposition is not a transaction. When the
 * replacement code fails to import, dsh-hmr stops the old version and reports
 * `failed` — it never restores it ("旧版本不会被恢复", dsh-hmr README.zh.md). So
 * every refusal that can be detected on disk must happen before the checkout
 * moves, and the refusal has to name the thing that is in the way.
 */

import { execFileSync } from 'node:child_process'

/** Run git and capture stdout; a failure is a value, not an exception. */
export function gitIn(dir, args, options = {}) {
  try {
    const stdout = execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { ok: true, stdout }
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
    return { ok: false, error: stderr.length > 0 ? stderr : String(error?.message ?? error) }
  }
}

/**
 * What the local checkout looks like right now.
 *
 * `branch: null` means detached HEAD — an update would move a checkout nobody
 * is on, so the caller refuses rather than guessing which branch to advance.
 *
 * @param {string} dir
 * @returns {{ok: boolean, branch?: string|null, head?: string, clean?: boolean, dirty?: string[], error?: string}}
 */
export function readCheckoutState(dir) {
  const top = gitIn(dir, ['rev-parse', '--is-inside-work-tree'])
  if (top.ok !== true || top.stdout.trim() !== 'true') {
    return { ok: false, error: `not a git repository: ${dir}` }
  }

  const head = gitIn(dir, ['rev-parse', 'HEAD'])
  if (head.ok !== true) return { ok: false, error: `cannot read HEAD: ${head.error}` }

  const branch = gitIn(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const status = gitIn(dir, ['status', '--porcelain'])
  if (status.ok !== true) return { ok: false, error: `cannot read status: ${status.error}` }

  const dirty = status.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Porcelain v1 is `XY <path>`; a rename shows `XY <old> -> <new>` and the
    // arrow form is what a reader needs to recognize the file.
    .map((line) => line.slice(3).trim())

  return {
    ok: true,
    branch: branch.ok === true ? branch.stdout.trim() : null,
    head: head.stdout.trim(),
    clean: dirty.length === 0,
    dirty,
  }
}

/**
 * name → version, read from the `packages/**\/package.json` files of a ref.
 *
 * Only files some way under `packages/` count: the workspace root has a name and
 * a version too, and it is not a bundle. A file that is not JSON is skipped —
 * a broken package.json in a future commit is a reason to show fewer rows, not
 * to fail the whole read.
 *
 * @param {{path: string, text: string}[]} files
 * @returns {Record<string, string>}
 */
export function parsePackagesVersions(files) {
  const versions = {}
  for (const file of files) {
    if (typeof file?.path !== 'string' || !file.path.startsWith('packages/')) continue
    let manifest
    try {
      manifest = JSON.parse(file.text)
    } catch {
      continue
    }
    if (typeof manifest?.name !== 'string' || typeof manifest?.version !== 'string') continue
    versions[manifest.name] = manifest.version
  }
  return versions
}

/**
 * How the local HEAD relates to the target: `same`, `behind`, `ahead`, `diverged`.
 *
 * Read with `rev-list --count` on both sides rather than `merge-base --is-ancestor`
 * alone, because "behind by 3" is what the button's tooltip should say.
 *
 * @param {string} dir
 * @param {string} target
 * @returns {{relation: 'same'|'behind'|'ahead'|'diverged'|'unknown', ahead: number, behind: number}}
 */
export function relationTo(dir, target) {
  const counts = gitIn(dir, ['rev-list', '--left-right', '--count', `HEAD...${target}`])
  if (counts.ok !== true) return { relation: 'unknown', ahead: 0, behind: 0 }
  const [aheadText = '0', behindText = '0'] = counts.stdout.trim().split(/\s+/)
  const ahead = Number(aheadText)
  const behind = Number(behindText)
  if (ahead === 0 && behind === 0) return { relation: 'same', ahead, behind }
  if (ahead === 0) return { relation: 'behind', ahead, behind }
  if (behind === 0) return { relation: 'ahead', ahead, behind }
  return { relation: 'diverged', ahead, behind }
}

/**
 * The gate. Pure: takes facts, returns a verdict, touches nothing.
 *
 * Order matters — the first thing that blocks is the one reported, and it is
 * reported before any caller could have moved a file.
 *
 * @param {{state: object, local: {name: string, version?: string}[], remote: Record<string, string>,
 *          targetHead: string, relation: string}} facts
 * @returns {{ok: boolean, reason?: string, detail?: string, changed?: {name: string, from: string, to: string}[]}}
 */
export function checkUpdatable(facts) {
  const { state, local = [], remote = {}, targetHead, relation } = facts

  if (state?.ok !== true) {
    return { ok: false, reason: 'no-checkout', detail: state?.error ?? 'the plugin checkout is unreadable' }
  }
  if (state.branch === null || state.branch === undefined) {
    return {
      ok: false,
      reason: 'detached',
      detail: 'HEAD is not on a branch, so there is no branch to advance',
    }
  }
  if (state.clean !== true) {
    const dirty = Array.isArray(state.dirty) ? state.dirty : []
    return {
      ok: false,
      reason: 'dirty-tree',
      detail: `uncommitted changes: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ', …' : ''}`,
    }
  }
  if (relation === 'diverged') {
    return {
      ok: false,
      reason: 'not-fast-forwardable',
      detail: 'the checkout and the target have both moved; a merge would need a human',
    }
  }
  if (relation === 'same' || state.head === targetHead) {
    return { ok: false, reason: 'up-to-date', detail: 'the checkout already is at the target' }
  }

  const changed = []
  for (const item of local) {
    const to = remote[item.name]
    if (typeof to !== 'string') continue
    if (typeof item.version === 'string' && item.version === to) continue
    changed.push({ name: item.name, from: item.version ?? '?', to })
  }

  return { ok: true, changed }
}

/**
 * Run one update, in the only order that is safe.
 *
 * 1. the gate decides (nothing moves on a refusal),
 * 2. the checkout moves,
 * 3. the caller is answered,
 * 4. a recomposition is requested.
 *
 * Steps 3 and 4 are in that order because the bundle being updated is often the
 * one answering: `reconcileProfile` stops the affected rows (waiting on their
 * fibers) before it recomposes, so a response written after step 4 may never be
 * written at all.
 *
 * A failure in step 4 is reported as a failure of *that* stage and nothing else.
 * dsh-hmr does not restore the replaced version ("旧版本不会被恢复"), so the
 * honest instruction is "fix the files and update again", never "rolled back".
 *
 * @param {{gate: object, respond: () => void, moveCheckout: () => Promise<object>,
 *          reconcile?: () => Promise<object>}} steps
 * @returns {Promise<object>}
 */
export async function runUpdate({ gate, respond, moveCheckout, reconcile }) {
  if (gate?.ok !== true) {
    return {
      ok: false,
      stage: 'gate',
      reason: gate?.reason ?? 'refused',
      detail: gate?.detail ?? 'the update was refused before anything moved',
    }
  }

  const moved = await moveCheckout()
  respond()
  if (moved?.ok !== true) {
    return { ok: false, stage: 'checkout', error: moved?.error ?? 'the checkout did not move' }
  }

  const summary = { ok: true, changed: moved.changed ?? gate.changed ?? [], from: moved.from, to: moved.to }

  if (typeof reconcile !== 'function') {
    // No hmr service (headless / SDK profiles): the files are new but the running
    // process still has the old code. Say so instead of pretending.
    return { ...summary, application: 'restart-required', restartReason: 'no-hmr' }
  }

  try {
    const result = (await reconcile()) ?? {}
    const pending = Array.isArray(result.pending) ? result.pending : []
    if (typeof result.restartReason === 'string' || pending.length > 0) {
      return {
        ...summary,
        application: 'restart-required',
        ...(typeof result.restartReason === 'string' ? { restartReason: result.restartReason } : {}),
        ...(pending.length > 0 ? { pending } : {}),
      }
    }
    return { ...summary, application: 'applied', warnings: result.warnings ?? [] }
  } catch (error) {
    return {
      ok: false,
      stage: 'reconcile',
      changed: summary.changed,
      error: String(error?.message ?? error),
      detail: `the new code failed to load (${String(error?.message ?? error)}), so the old version is stopped — dsh-hmr does not restore it. Fix the files and update again(修好文件后再点一次)。`,
    }
  }
}

/** The bundles checked out on disk: name + version from `packages/**\/package.json`. */
export function localBundles(repoDir) {
  const listed = gitIn(repoDir, ['ls-files', 'packages/*/package.json', 'packages/*/*/package.json'])
  if (listed.ok !== true) return []
  const files = []
  for (const path of listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
    const shown = gitIn(repoDir, ['show', `HEAD:${path}`])
    const onDisk = gitIn(repoDir, ['show', `:${path}`])
    // The checkout's own copy wins: an uncommitted local edit is what the loader
    // is running, but the gate refuses dirty trees anyway.
    files.push({ path, text: onDisk.ok === true ? onDisk.stdout : shown.ok === true ? shown.stdout : '' })
  }
  const versions = parsePackagesVersions(files)
  return Object.entries(versions).map(([name, version]) => ({ name, version }))
}

/** name → version at one ref of this repository. */
export function remoteVersionsAt(repoDir, ref) {
  const listed = gitIn(repoDir, ['ls-tree', '-r', '--name-only', ref, 'packages'])
  if (listed.ok !== true) return {}
  const files = []
  for (const path of listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
    if (!path.endsWith('/package.json')) continue
    const shown = gitIn(repoDir, ['show', `${ref}:${path}`])
    if (shown.ok === true) files.push({ path, text: shown.stdout })
  }
  return parsePackagesVersions(files)
}

/**
 * Fetch and fast-forward this checkout to the target ref.
 *
 * Never merges, never rebases and never touches a dirty tree: the gate already
 * refused those cases, and a checkout that has to be forced is a human's
 * decision, not a button's.
 *
 * @param {string} repoDir
 * @param {{remote?: string, ref?: string, run?: (file: string, args: string[]) => Promise<object>}} options
 * @returns {Promise<{ok: boolean, changed?: object[], from?: string, to?: string, error?: string}>}
 */
export async function moveCheckout(repoDir, options = {}) {
  const remote = options.remote ?? 'origin'
  const ref = options.ref ?? 'main'
  const run =
    typeof options.run === 'function'
      ? options.run
      : async (file, args) => {
          const result = gitIn(repoDir, args)
          return result.ok === true ? { ok: true, stdout: result.stdout } : result
        }

  const from = readCheckoutState(repoDir).head
  const before = localBundles(repoDir)

  const fetched = await run('git', ['fetch', '--quiet', remote, ref])
  if (fetched?.ok !== true) {
    return { ok: false, error: `fetch failed: ${fetched?.error ?? 'unknown error'}` }
  }

  const target = `${remote}/${ref}`
  const merged = await run('git', ['merge', '--ff-only', '--quiet', target])
  if (merged?.ok !== true) {
    return { ok: false, error: `fast-forward refused: ${merged?.error ?? 'unknown error'}` }
  }

  const after = localBundles(repoDir)
  const afterVersions = Object.fromEntries(after.map((item) => [item.name, item.version]))
  const changed = before
    .filter((item) => afterVersions[item.name] !== item.version)
    .map((item) => ({ name: item.name, from: item.version, to: afterVersions[item.name] }))

  const to = readCheckoutState(repoDir).head
  return { ok: true, changed, from, to }
}
