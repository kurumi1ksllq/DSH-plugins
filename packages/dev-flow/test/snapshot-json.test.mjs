import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { getSnapshot, invalidateSnapshot } from '../lib-git-status/snapshot.js'

const GIT = process.env.GIT_IN_PATH ?? 'git'

function repoWithIssueBranch() {
  const dir = mkdtempSync(join(tmpdir(), 'snap-json-'))
  execFileSync(GIT, ['init', '-b', 'main'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  execFileSync(GIT, ['add', '.'], { cwd: dir })
  execFileSync(GIT, ['commit', '-m', 'init'], { cwd: dir })
  execFileSync(GIT, ['switch', '-c', 'issue-42-flow-test'], { cwd: dir })
  return dir
}

function writeFlow(dir, issue, stage) {
  const flowDir = join(dir, 'docs', 'specs', '.flow')
  mkdirSync(flowDir, { recursive: true })
  writeFileSync(join(flowDir, `${issue}.json`), JSON.stringify({
    issue,
    grade: 'standard',
    stage,
    updatedAt: '2026-11-03T06:00:00+08:00',
    tickets: [{ id: 1, title: 'x', state: 'green' }],
    ci: { run: 1, max: 2, status: 'unknown' },
    review: { state: 'not-started', axes: 2 },
    merge: { authorized: false },
  }))
}

/**
 * The snapshot is served by an HTTP route that JSON.stringify's it. A Map looks
 * populated on the host and arrives as `{}` in the browser, so every progress
 * fact silently vanished. This test walks the SAME boundary the browser does.
 */
test('flow states survive the HTTP JSON boundary', async () => {
  const dir = repoWithIssueBranch()
  writeFlow(dir, 42, 'dev')
  invalidateSnapshot()
  const snap = await getSnapshot({ env: {}, sessionCwd: dir })

  const wire = JSON.parse(JSON.stringify(snap))
  const state = wire.flowStates['42']
  assert.notEqual(state, undefined, 'flow state must survive JSON.stringify for the browser')
  assert.equal(state.stage, 'dev')
  assert.equal(state.grade, 'standard')
  assert.equal(state.tickets[0].state, 'green')
  assert.equal(state.ci.status, 'unknown')
})

test('flowStates is a plain JSON object keyed by issue number', async () => {
  const dir = repoWithIssueBranch()
  writeFlow(dir, 42, 'ci')
  invalidateSnapshot()
  const snap = await getSnapshot({ env: {}, sessionCwd: dir })
  assert.equal(snap.flowStates instanceof Map, false, 'a Map cannot cross the JSON boundary')
  assert.equal(typeof snap.flowStates, 'object')
  assert.equal(snap.flowStates['42'].stage, 'ci')
})

test('an empty snapshot still serves a plain object, not a Map', async () => {
  const dir = repoWithIssueBranch()
  invalidateSnapshot()
  const snap = await getSnapshot({ env: {}, sessionCwd: dir })
  const wire = JSON.parse(JSON.stringify(snap))
  assert.deepEqual(wire.flowStates, {})
})

test('the snapshot carries a board computed from the same data', async () => {
  const dir = repoWithIssueBranch()
  writeFlow(dir, 42, 'dev')
  invalidateSnapshot()
  const snap = await getSnapshot({ env: {}, sessionCwd: dir })
  const wire = JSON.parse(JSON.stringify(snap))
  assert.notEqual(wire.board, undefined, 'the host must ship the board, not re-derive it in the browser')
  assert.equal(wire.board.columns.length, 8)
  const card = wire.board.columns.flatMap((c) => c.cards).find((c) => c.issue === 42)
  assert.notEqual(card, undefined)
  assert.equal(card.stage, 'dev')
  assert.equal(card.grade, 'standard')
})
