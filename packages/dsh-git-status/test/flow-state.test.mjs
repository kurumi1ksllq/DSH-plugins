import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readFlowState, flowStatePath, STAGES, GRADES, TICKET_STATES, CI_STATUSES, REVIEW_STATES } from '../lib/flow-state.js'

function repoWith(issueNumber, payload) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-state-'))
  const flowDir = join(dir, 'docs', 'specs', '.flow')
  mkdirSync(flowDir, { recursive: true })
  writeFileSync(join(flowDir, `${issueNumber}.json`), typeof payload === 'string' ? payload : JSON.stringify(payload))
  return dir
}

const valid = {
  issue: 26,
  grade: 'standard',
  stage: 'ci',
  updatedAt: '2026-11-03T06:00:00+08:00',
  tickets: [
    { id: 1, title: '建表', state: 'done' },
    { id: 2, title: '校验', state: 'red' },
  ],
  ci: { run: 1, max: 2, status: 'red' },
  review: { state: 'pending-decision', axes: 2 },
  merge: { authorized: false },
}

/**
 * A negative case is only meaningful when the SAME input succeeds on the happy
 * path: otherwise a stub that always answers null would "pass" every rejection
 * test and hide a missing implementation.
 */
function rejectsBecauseMalformed(dir) {
  return readFlowState(dir, 26).then((state) => {
    assert.equal(state, null)
  })
}

test('enum sets are the dev-flow stages in order', () => {
  assert.deepEqual(STAGES, ['intake', 'spec', 'dev', 'pr', 'ci', 'review', 'merge', 'done'])
  assert.deepEqual(GRADES, ['trivial', 'standard'])
  assert.deepEqual(TICKET_STATES, ['todo', 'red', 'green', 'done'])
  assert.deepEqual(CI_STATUSES, ['green', 'red', 'none', 'unknown'])
  assert.deepEqual(REVIEW_STATES, ['not-started', 'running', 'pending-decision', 'done'])
})

test('flowStatePath points at docs/specs/.flow/<issue>.json under the repo', () => {
  assert.equal(flowStatePath('/tmp/repo', 26), join('/tmp/repo', 'docs', 'specs', '.flow', '26.json'))
})

test('readFlowState parses a valid file', async () => {
  const dir = repoWith(26, valid)
  const state = await readFlowState(dir, 26)
  assert.equal(state.issue, 26)
  assert.equal(state.grade, 'standard')
  assert.equal(state.stage, 'ci')
  assert.equal(state.tickets.length, 2)
  assert.equal(state.tickets[1].state, 'red')
  assert.equal(state.ci.run, 1)
  assert.equal(state.ci.max, 2)
  assert.equal(state.review.state, 'pending-decision')
  assert.equal(state.merge.authorized, false)
})

test('readFlowState returns null when the file is missing (and the happy path still works)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-state-empty-'))
  assert.equal(await readFlowState(dir, 26), null)
  // Same reader, a repo that DOES have the file, must not answer null.
  const okDir = repoWith(26, valid)
  assert.notEqual(await readFlowState(okDir, 26), null)
})

test('readFlowState returns null on malformed JSON without throwing', async () => {
  const dir = repoWith(26, '{ not json')
  await rejectsBecauseMalformed(dir)
  assert.notEqual(await readFlowState(repoWith(26, valid), 26), null)
})

test('readFlowState rejects an unknown stage', async () => {
  await rejectsBecauseMalformed(repoWith(26, { ...valid, stage: 'shipped' }))
  assert.notEqual(await readFlowState(repoWith(26, valid), 26), null)
})

test('readFlowState rejects an unknown grade', async () => {
  await rejectsBecauseMalformed(repoWith(26, { ...valid, grade: 'medium' }))
  assert.notEqual(await readFlowState(repoWith(26, valid), 26), null)
})

test('readFlowState rejects an unknown ticket state', async () => {
  await rejectsBecauseMalformed(repoWith(26, { ...valid, tickets: [{ id: 1, title: 'x', state: 'blocked' }] }))
  assert.notEqual(await readFlowState(repoWith(26, valid), 26), null)
})

test('readFlowState rejects a non-integer issue', async () => {
  await rejectsBecauseMalformed(repoWith(26, { ...valid, issue: '26' }))
  assert.notEqual(await readFlowState(repoWith(26, valid), 26), null)
})

test('readFlowState rejects an unknown CI status', async () => {
  await rejectsBecauseMalformed(repoWith(26, { ...valid, ci: { run: 1, max: 2, status: 'flaky' } }))
  assert.notEqual(await readFlowState(repoWith(26, valid), 26), null)
})

test('readFlowState rejects an unknown review state', async () => {
  await rejectsBecauseMalformed(repoWith(26, { ...valid, review: { state: 'shrug', axes: 2 } }))
  assert.notEqual(await readFlowState(repoWith(26, valid), 26), null)
})

test('readFlowState rejects a request whose issue escapes the flow directory', async () => {
  const dir = repoWith(26, valid)
  for (const bad of ['../26', 0, -1, 1.5, '26abc']) {
    assert.equal(await readFlowState(dir, bad), null, `issue ${String(bad)} must be refused`)
  }
  assert.notEqual(await readFlowState(dir, 26), null)
})

test('readFlowState tolerates missing optional blocks', async () => {
  const dir = repoWith(26, { issue: 26, grade: 'trivial', stage: 'dev', updatedAt: '2026-11-03T06:00:00+08:00' })
  const state = await readFlowState(dir, 26)
  assert.notEqual(state, null)
  assert.equal(state.stage, 'dev')
  assert.deepEqual(state.tickets, [])
  assert.equal(state.ci, null)
  assert.equal(state.review, null)
  assert.equal(state.merge, null)
})
