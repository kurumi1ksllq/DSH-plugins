/**
 * The update's side effects, exercised on throwaway repositories (issue #60).
 *
 * These live here, and not in the route test, because the route handler resolves
 * the checkout the *running plugin* was loaded from: a test that POSTs to it runs
 * `git fetch` against the real repository and writes the real
 * `$DSH_HOME/plugin-update/last.json`. One such test overwrote a user's genuine
 * update result, so the panel's "last outcome" was really a test artifact — and it
 * was briefly read as a product bug.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { performUpdate, readLastOutcome } from '../lib/plugin-update.js'

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

/**
 * A checkout with an `origin` it can actually fetch from, plus the commit that
 * origin is one step ahead with.
 */
function makeWorld() {
  const origin = mkdtempSync(join(tmpdir(), 'pu60-origin-'))
  git(origin, 'init', '-q', '-b', 'main')
  git(origin, 'config', 'user.email', 't@example.com')
  git(origin, 'config', 'user.name', 'T')
  mkdirSync(join(origin, 'packages', 'dsh-one'), { recursive: true })
  writeFileSync(join(origin, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.1.0' }))
  writeFileSync(join(origin, 'packages', 'dsh-one', 'index.js'), 'export const one = 1\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'one')

  const repo = mkdtempSync(join(tmpdir(), 'pu60-repo-'))
  git(repo, 'clone', '-q', origin, repo)
  git(repo, 'config', 'user.email', 't@example.com')
  git(repo, 'config', 'user.name', 'T')

  // Origin moves one step ahead: a new version, a parseable entry.
  writeFileSync(join(origin, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.2.0' }))
  writeFileSync(join(origin, 'packages', 'dsh-one', 'index.js'), 'export const two = 2\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'bump')

  const stateDir = mkdtempSync(join(tmpdir(), 'pu60-state-'))
  return { origin, repo, stateDir }
}

test('a refused update writes the reason and leaves HEAD where it was', async () => {
  const { repo, stateDir } = makeWorld()
  const before = git(repo, 'rev-parse', 'HEAD').trim()
  // Dirty the tree: the gate must refuse before touching anything.
  writeFileSync(join(repo, 'packages', 'dsh-one', 'loose.txt'), 'x\n')

  const answered = []
  const result = await performUpdate({ repo, stateDir, respond: (payload) => answered.push(payload) })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'dirty-tree')
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), before, 'a refusal must not move HEAD')

  const last = readLastOutcome(stateDir)
  assert.equal(last.ok, false)
  assert.equal(last.reason, 'dirty-tree')
})

test('a successful update advances HEAD, records what changed, and answers first', async () => {
  const { repo, stateDir } = makeWorld()
  const before = git(repo, 'rev-parse', 'HEAD').trim()
  const order = []

  const result = await performUpdate({
    repo,
    stateDir,
    respond: () => order.push('respond'),
    reconcile: async () => {
      order.push('reconcile')
      return { warnings: [], pending: [] }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.changed, [{ name: 'dsh-one', from: '0.1.0', to: '0.2.0' }])
  assert.notEqual(git(repo, 'rev-parse', 'HEAD').trim(), before, 'the checkout must move')
  assert.deepEqual(order, ['respond', 'reconcile'], 'the answer must precede the recomposition')

  const last = readLastOutcome(stateDir)
  assert.equal(last.ok, true)
  assert.deepEqual(last.changed, [{ name: 'dsh-one', from: '0.1.0', to: '0.2.0' }])
  assert.deepEqual(last.restart, { application: 'applied' })
})

test('without an hmr service the update reports restart-required instead of pretending', async () => {
  const { repo, stateDir } = makeWorld()
  const result = await performUpdate({ repo, stateDir, respond: () => {} })
  assert.equal(result.ok, true)
  assert.deepEqual(result.restart, { application: 'restart-required', restartReason: 'no-hmr' })
  assert.deepEqual(readLastOutcome(stateDir).restart, { application: 'restart-required', restartReason: 'no-hmr' })
})

test('the last outcome lives under the directory it is given, never a global one', async () => {
  const { repo, stateDir } = makeWorld()
  await performUpdate({ repo, stateDir, respond: () => {} })
  assert.equal(existsSync(join(stateDir, 'last.json')), true)
  assert.equal(existsSync(join(stateDir, 'plugin-update', 'last.json')), false, 'performUpdate owns exactly one layout')
})

test('a broken entry in the target is refused before the checkout moves', async () => {
  const { origin, repo, stateDir } = makeWorld()
  writeFileSync(join(origin, 'packages', 'dsh-one', 'index.js'), 'export const =\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'break')
  const before = git(repo, 'rev-parse', 'HEAD').trim()

  const result = await performUpdate({ repo, stateDir, respond: () => {} })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'probe')
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), before)
})
