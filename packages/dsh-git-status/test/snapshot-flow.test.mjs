import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { getSnapshot, invalidateSnapshot } from '../lib/snapshot.js'

const GIT = process.env.GIT_IN_PATH ?? 'git'

function repoWithIssueBranch() {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-flow-'))
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

// The env ships a token-free environment so ghStatus() reports not-logged-in:
// the snapshot must still carry git-derived flow state.
const noForge = { env: {} }

test('snapshot carries an empty flowStates map and checks map when nothing is recorded', async () => {
  const dir = repoWithIssueBranch()
  invalidateSnapshot()
  const snap = await getSnapshot({ ...noForge, sessionCwd: dir })
  assert.equal(snap.isGit, true)
  // Plain object, not a Map: the route JSON.stringify's this payload.
  assert.equal(snap.flowStates instanceof Map, false)
  assert.deepEqual(snap.flowStates, {})
  assert.deepEqual(snap.checks, {})
})

test('snapshot reads the flow state of a branch-named issue without forge access', async () => {
  const dir = repoWithIssueBranch()
  writeFlow(dir, 42, 'dev')
  invalidateSnapshot()
  const snap = await getSnapshot({ ...noForge, sessionCwd: dir })
  assert.equal(snap.isGit, true)
  const state = snap.flowStates[42]
  assert.notEqual(state, undefined)
  assert.equal(state.stage, 'dev')
  assert.equal(state.grade, 'standard')
})

test('snapshot ignores a broken flow file instead of failing the route', async () => {
  const dir = repoWithIssueBranch()
  const flowDir = join(dir, 'docs', 'specs', '.flow')
  mkdirSync(flowDir, { recursive: true })
  writeFileSync(join(flowDir, '42.json'), '{ nope')
  invalidateSnapshot()
  const snap = await getSnapshot({ ...noForge, sessionCwd: dir })
  assert.equal(snap.isGit, true)
  assert.deepEqual(snap.flowStates, {})
})

test('a non-git workspace still answers with stable empty fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-plain-'))
  invalidateSnapshot()
  const snap = await getSnapshot({ ...noForge, sessionCwd: dir })
  assert.equal(snap.isGit, false)
  assert.deepEqual(snap.flowStates, {})
  assert.deepEqual(snap.checks, {})
})
