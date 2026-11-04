/**
 * The update half of the Plugins page (issue #45).
 *
 * Two properties matter more than the happy path, because a recomposition is
 * not a transaction: a failed replacement stops the old code and never brings it
 * back. So every refusal has to happen BEFORE a single file moves, and the
 * reasons have to be specific enough to act on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  changedFiles,
  checkUpdatable,
  checkoutOverride,
  localBundles,
  needsBuild,
  needsInstall,
  probeTargetEntries,
  moveCheckout,
  parsePackagesVersions,
  readCheckoutState,
  remoteVersionsAt,
  runUpdate,
} from '../lib/plugin-update.js'

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

/** A checkout with one commit on `main`, and a sibling worktree-free clone to pull from. */
function initCheckout(prefix = 'pu-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 't@example.com')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  mkdirSync(join(dir, 'packages', 'dsh-one'), { recursive: true })
  writeFileSync(join(dir, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.1.0' }))
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'one')
  return dir
}

// ---- reading the checkout's own state -------------------------------------

test('readCheckoutState reports the branch, head and whether the tree is clean', () => {
  const dir = initCheckout()
  const state = readCheckoutState(dir)
  assert.equal(state.branch, 'main')
  assert.equal(state.head.length, 40)
  assert.equal(state.clean, true, 'a freshly committed tree has nothing uncommitted')
})

test('readCheckoutState reports a dirty tree with the files that made it dirty', () => {
  const dir = initCheckout()
  writeFileSync(join(dir, 'packages', 'dsh-one', 'loose.txt'), 'x\n')
  const state = readCheckoutState(dir)
  assert.equal(state.clean, false)
  assert.deepEqual(state.dirty, ['packages/dsh-one/loose.txt'])
})

test('readCheckoutState reports a missing repository instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-norepo-'))
  const state = readCheckoutState(dir)
  assert.equal(state.ok, false)
  assert.match(state.error, /not a git repository/i)
})

// ---- parsing the target's versions ---------------------------------------

test('parsePackagesVersions reads name→version from the bundles under packages/', () => {
  const versions = parsePackagesVersions([
    { path: 'packages/dsh-one/package.json', text: JSON.stringify({ name: 'dsh-one', version: '0.2.0' }) },
    { path: 'packages/websearch/plugin/package.json', text: JSON.stringify({ name: 'dsh-websearch-failover', version: '0.3.0' }) },
    { path: 'packages/broken/package.json', text: '{not json' },
    { path: 'package.json', text: JSON.stringify({ name: 'workspace', version: '0.0.0' }) },
  ])
  assert.deepEqual(versions, { 'dsh-one': '0.2.0', 'dsh-websearch-failover': '0.3.0' })
})

// ---- the refusal gate ----------------------------------------------------

function bundle(name, version) {
  return { name, version }
}

test('checkUpdatable refuses a dirty tree before anything is touched', () => {
  const verdict = checkUpdatable({
    state: { ok: true, clean: false, dirty: ['README.md'], branch: 'main', head: 'a'.repeat(40) },
    local: [bundle('dsh-one', '0.1.0')],
    remote: { 'dsh-one': '0.2.0' },
    targetHead: 'b'.repeat(40),
    relation: 'behind',
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'dirty-tree')
  assert.match(verdict.detail, /README\.md/)
})

test('checkUpdatable refuses a checkout that cannot fast-forward', () => {
  const verdict = checkUpdatable({
    state: { ok: true, clean: true, dirty: [], branch: 'main', head: 'a'.repeat(40) },
    local: [bundle('dsh-one', '0.1.0')],
    remote: { 'dsh-one': '0.2.0' },
    targetHead: 'b'.repeat(40),
    relation: 'diverged',
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'not-fast-forwardable')
})

test('checkUpdatable refuses when the caller is detached from any branch', () => {
  const verdict = checkUpdatable({
    state: { ok: true, clean: true, dirty: [], branch: null, head: 'a'.repeat(40) },
    local: [bundle('dsh-one', '0.1.0')],
    remote: { 'dsh-one': '0.2.0' },
    targetHead: 'b'.repeat(40),
    relation: 'behind',
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'detached')
})

test('checkUpdatable refuses when the target does not move this checkout', () => {
  const head = 'a'.repeat(40)
  const verdict = checkUpdatable({
    state: { ok: true, clean: true, dirty: [], branch: 'main', head },
    local: [bundle('dsh-one', '0.2.0')],
    remote: { 'dsh-one': '0.2.0' },
    targetHead: head,
    relation: 'same',
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'up-to-date')
})

test('checkUpdatable accepts a clean, behind checkout and lists what will change', () => {
  const verdict = checkUpdatable({
    state: { ok: true, clean: true, dirty: [], branch: 'main', head: 'a'.repeat(40) },
    local: [bundle('dsh-one', '0.1.0'), bundle('dsh-two', '1.0.0')],
    remote: { 'dsh-one': '0.2.0', 'dsh-two': '1.0.0' },
    targetHead: 'b'.repeat(40),
    relation: 'behind',
  })
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.changed, [{ name: 'dsh-one', from: '0.1.0', to: '0.2.0' }])
})

// ---- the apply sequence ---------------------------------------------------

test('runUpdate answers the caller BEFORE asking for a recomposition', async () => {
  // The bundle being updated can be the one serving this request: recomposition
  // stops it (`stopPlanned` deletes the row and awaits its fiber) before it
  // returns. A body written afterwards would never reach the browser.
  const order = []
  const result = await runUpdate({
    gate: { ok: true, changed: [{ name: 'dsh-one', from: '0.1.0', to: '0.2.0' }] },
    respond: () => order.push('respond'),
    moveCheckout: async () => {
      order.push('move')
      return { ok: true }
    },
    reconcile: async () => {
      order.push('reconcile')
      return { warnings: [], pending: [] }
    },
  })
  assert.deepEqual(order, ['move', 'respond', 'reconcile'])
  assert.equal(result.ok, true)
})

test('runUpdate never moves the checkout when the gate refuses', async () => {
  const order = []
  const result = await runUpdate({
    gate: { ok: false, reason: 'dirty-tree', detail: 'uncommitted changes: README.md' },
    respond: () => order.push('respond'),
    moveCheckout: async () => {
      order.push('move')
      return { ok: true }
    },
    reconcile: async () => {
      order.push('reconcile')
      return { warnings: [], pending: [] }
    },
  })
  assert.deepEqual(order, [])
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'dirty-tree')
})

test('runUpdate reports a failed move and still answers, without reconciling', async () => {
  const order = []
  const result = await runUpdate({
    gate: { ok: true, changed: [] },
    respond: () => order.push('respond'),
    moveCheckout: async () => {
      order.push('move')
      return { ok: false, error: 'merge refused' }
    },
    reconcile: async () => {
      order.push('reconcile')
      return { warnings: [], pending: [] }
    },
  })
  assert.deepEqual(order, ['move', 'respond'])
  assert.equal(result.ok, false)
  assert.equal(result.error, 'merge refused')
})

test('runUpdate reports a failed recomposition as failed, not as rolled back', async () => {
  // dsh-hmr does not restore the replaced version: the old code is already
  // stopped. Claiming a rollback here would be a lie the user acts on.
  const result = await runUpdate({
    gate: { ok: true, changed: [] },
    respond: () => {},
    moveCheckout: async () => ({ ok: true }),
    reconcile: async () => {
      throw new Error('import failed')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'reconcile')
  assert.match(result.detail, /import failed/)
  assert.match(result.detail, /again|再点一次/)
})

test('runUpdate degrades honestly when the profile has no hmr service', async () => {
  const result = await runUpdate({
    gate: { ok: true, changed: [] },
    respond: () => {},
    moveCheckout: async () => ({ ok: true }),
    reconcile: undefined,
  })
  assert.equal(result.ok, true, 'the files did move, so the update itself succeeded')
  assert.deepEqual(result.restart, { application: 'restart-required', restartReason: 'no-hmr' })
})

// ---- reading the target and moving the checkout ---------------------------

test('remoteVersionsAt reads the bundles from a ref, not from the working tree', () => {
  const dir = initCheckout()
  git(dir, 'checkout', '-q', '-b', 'next')
  writeFileSync(join(dir, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.2.0' }))
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'bump')
  git(dir, 'checkout', '-q', 'main')

  assert.deepEqual(remoteVersionsAt(dir, 'next'), { 'dsh-one': '0.2.0' })
  assert.deepEqual(remoteVersionsAt(dir, 'main'), { 'dsh-one': '0.1.0' })
})

test('localBundles reports the versions actually checked out', () => {
  const dir = initCheckout()
  assert.deepEqual(localBundles(dir), [{ name: 'dsh-one', version: '0.1.0' }])
})

test('moveCheckout reports a failed fetch and leaves HEAD where it was', async () => {
  const dir = initCheckout()
  const before = readCheckoutState(dir).head
  const result = await moveCheckout(dir, {
    remote: 'origin',
    ref: 'main',
    run: async (file, args) => {
      if (file === 'git' && args.includes('fetch')) return { ok: false, error: 'could not resolve host' }
      return { ok: true, stdout: '' }
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /could not resolve host/)
  assert.equal(readCheckoutState(dir).head, before, 'a failed fetch must not move HEAD')
})

test('moveCheckout fast-forwards a behind checkout to the fetched ref', async () => {
  const dir = initCheckout()
  const clone = mkdtempSync(join(tmpdir(), 'pu-origin-'))
  execFileSync('git', ['clone', '-q', dir, clone], { encoding: 'utf8' })
  git(clone, 'config', 'user.email', 't@example.com')
  git(clone, 'config', 'user.name', 'T')
  writeFileSync(join(clone, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.9.0' }))
  git(clone, 'add', '.')
  git(clone, 'commit', '-q', '-m', 'bump')
  git(dir, 'remote', 'add', 'origin', clone)

  // No injected runner here: the point is that the real fetch + ff-only merge move
  // HEAD, which a stub could not demonstrate.
  const result = await moveCheckout(dir, { remote: 'origin', ref: 'main' })
  assert.equal(result.ok, true)
  assert.notEqual(result.from, result.to, 'the checkout must actually move')
  assert.deepEqual(result.changed, [{ name: 'dsh-one', from: '0.1.0', to: '0.9.0' }])
  assert.equal(JSON.parse(execFileSync('git', ['-C', dir, 'show', 'HEAD:packages/dsh-one/package.json'], { encoding: 'utf8' })).version, '0.9.0')
})

test('checkUpdatable reports the FIRST reason, not the last one found', () => {
  // The order is the point: a dirty tree is something the user fixes in place,
  // while a diverged checkout needs a decision — reporting the second would send
  // them to the wrong fix.
  const verdict = checkUpdatable({
    state: { ok: true, clean: false, dirty: ['README.md'], branch: 'main', head: 'a'.repeat(40) },
    local: [bundle('dsh-one', '0.1.0')],
    remote: { 'dsh-one': '0.2.0' },
    targetHead: 'b'.repeat(40),
    relation: 'diverged',
  })
  assert.equal(verdict.reason, 'dirty-tree')
})

test('checkUpdatable refuses a checkout that is ahead of the target', () => {
  // Local commits the target lacks: `merge --ff-only` is a no-op, so the only
  // thing an "update" would do is stop and restart every row for nothing.
  const verdict = checkUpdatable({
    state: { ok: true, clean: true, dirty: [], branch: 'main', head: 'a'.repeat(40) },
    local: [bundle('dsh-one', '0.1.0')],
    remote: { 'dsh-one': '0.1.0' },
    targetHead: 'b'.repeat(40),
    relation: 'ahead',
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'ahead-of-target')
})

test('checkUpdatable refuses when the relation could not be read', () => {
  const verdict = checkUpdatable({
    state: { ok: true, clean: true, dirty: [], branch: 'main', head: 'a'.repeat(40) },
    local: [],
    remote: {},
    targetHead: 'b'.repeat(40),
    relation: 'unknown',
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'unknown-relation')
})

test('readCheckoutState keeps the whole path of a modified tracked file', () => {
  // Porcelain v1 marks a modified tracked file with a LEADING space (` M path`);
  // trimming before slicing ate two characters of the path.
  const dir = initCheckout()
  writeFileSync(join(dir, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.1.1' }))
  const state = readCheckoutState(dir)
  assert.deepEqual(state.dirty, ['packages/dsh-one/package.json'])
})

// ---- the entry probe ------------------------------------------------------

test('probeTargetEntries parses the target’s entry files, not the working tree', () => {
  const dir = initCheckout()
  writeFileSync(join(dir, 'packages', 'dsh-one', 'index.js'), 'export const ok = 1\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'entry')

  const good = probeTargetEntries(dir, 'HEAD', ['packages/dsh-one'])
  assert.equal(good.ok, true)

  // A broken entry in the target must be caught BEFORE anything moves.
  writeFileSync(join(dir, 'packages', 'dsh-one', 'index.js'), 'export const =\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'break')
  const bad = probeTargetEntries(dir, 'HEAD', ['packages/dsh-one'])
  assert.equal(bad.ok, false)
  assert.equal(bad.failures[0].path, 'packages/dsh-one/index.js')
})

test('the build predicate follows the file list', () => {
  assert.equal(needsBuild(['packages/dsh-websearch-failover/lib/core.mjs']), true)
  assert.equal(needsBuild(['packages/dsh-inventory/client.js']), false)
})

test('a version-only bump does not ask for an install', () => {
  // A `pnpm install` for a version bump is pure cost — and on a checkout with no
  // dependencies it failed and rolled the update back.
  const dir = initCheckout()
  writeFileSync(join(dir, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.1.1' }))
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'version only')
  const from = git(dir, 'rev-parse', 'HEAD~1').trim()
  const to = git(dir, 'rev-parse', 'HEAD').trim()
  assert.equal(needsInstall(dir, from, to, ['packages/dsh-one/package.json']), false)
})

test('a dependency change asks for an install', () => {
  const dir = initCheckout()
  writeFileSync(
    join(dir, 'packages', 'dsh-one', 'package.json'),
    JSON.stringify({ name: 'dsh-one', version: '0.1.0', dependencies: { 'left-pad': '^1.0.0' } }),
  )
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'add dep')
  const from = git(dir, 'rev-parse', 'HEAD~1').trim()
  const to = git(dir, 'rev-parse', 'HEAD').trim()
  assert.equal(needsInstall(dir, from, to, ['packages/dsh-one/package.json']), true)
})

test('a moved lockfile asks for an install on its own', () => {
  const dir = initCheckout()
  assert.equal(needsInstall(dir, 'HEAD', 'HEAD', ['pnpm-lock.yaml']), true)
  assert.equal(needsInstall(dir, 'HEAD', 'HEAD', ['packages/dsh-one/index.js']), false)
})

test('changedFiles lists exactly the paths between two commits', () => {
  const dir = initCheckout()
  writeFileSync(join(dir, 'packages', 'dsh-one', 'index.js'), 'export const a = 1\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'entry')
  const from = git(dir, 'rev-parse', 'HEAD~1').trim()
  const to = git(dir, 'rev-parse', 'HEAD').trim()
  assert.deepEqual(changedFiles(dir, from, to), ['packages/dsh-one/index.js'])
})

test('a pnpm-level config change asks for an install', () => {
  // `pnpm.overrides` / `patchedDependencies` move the dependency graph without
  // necessarily moving the lockfile.
  const dir = initCheckout()
  writeFileSync(
    join(dir, 'packages', 'dsh-one', 'package.json'),
    JSON.stringify({ name: 'dsh-one', version: '0.1.0', pnpm: { overrides: { 'left-pad': '1.3.0' } } }),
  )
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'override')
  const from = git(dir, 'rev-parse', 'HEAD~1').trim()
  const to = git(dir, 'rev-parse', 'HEAD').trim()
  assert.equal(needsInstall(dir, from, to, ['packages/dsh-one/package.json']), true)
})

test('the checkout override is honoured only when it is absolute', () => {
  // It names the repository the route will fetch, merge and `pnpm install` in.
  // A relative value would resolve against the service's cwd.
  assert.equal(checkoutOverride({ DSH_INVENTORY_UPDATE_REPO: '/tmp/repo' }), '/tmp/repo')
  assert.equal(checkoutOverride({ DSH_INVENTORY_UPDATE_REPO: 'repo' }), undefined)
  assert.equal(checkoutOverride({ DSH_INVENTORY_UPDATE_REPO: '' }), undefined)
  assert.equal(checkoutOverride({}), undefined)
})
