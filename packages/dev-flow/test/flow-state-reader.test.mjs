import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readFlowState, STAGES, GRADES, TICKET_STATES, CI_STATUSES, REVIEW_STATES } from '../lib-git-status/flow-state.js'

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
 * Prove a rejection on the SAME file that just succeeded.
 *
 * A stub that always answers null would "pass" every negative test, so each case
 * writes a valid file, confirms the reader accepts it, then overwrites that very
 * same file with the suspect content and confirms the reader refuses it. Only the
 * bytes changed — the directory, the reader and the issue number are identical.
 */
async function rejectsAfterAccepting(payload) {
  const dir = repoWith(26, valid)
  assert.notEqual(await readFlowState(dir, 26), null, 'the happy path must work in this same directory')
  writeFileSync(join(dir, 'docs', 'specs', '.flow', '26.json'), typeof payload === 'string' ? payload : JSON.stringify(payload))
  assert.equal(await readFlowState(dir, 26), null, 'the suspect content must be refused')
}

test('enum sets are the dev-flow stages in order', () => {
  assert.deepEqual(STAGES, ['intake', 'spec', 'dev', 'pr', 'ci', 'review', 'merge', 'done'])
  assert.deepEqual(GRADES, ['trivial', 'standard'])
  assert.deepEqual(TICKET_STATES, ['todo', 'red', 'green', 'done'])
  assert.deepEqual(CI_STATUSES, ['green', 'red', 'none', 'unknown'])
  assert.deepEqual(REVIEW_STATES, ['not-started', 'running', 'pending-decision', 'done'])
})

test('the reader finds the flow file at docs/specs/.flow/<issue>.json', async () => {
  // The directory layout is an implementation detail, so it is asserted through
  // behaviour: the file is found where the dev-flow contract puts it, and a file
  // anywhere else is not picked up. Spelling the path out in the test would
  // break on any refactor while the real behaviour stayed correct.
  const dir = repoWith(26, valid)
  const state = await readFlowState(dir, 26)
  assert.notEqual(state, null, 'a file at docs/specs/.flow/26.json must be read')

  // Same payload, wrong location: the reader must not go hunting for it.
  const misplaced = mkdtempSync(join(tmpdir(), 'flow-state-misplaced-'))
  writeFileSync(join(misplaced, '26.json'), JSON.stringify(valid))
  assert.equal(await readFlowState(misplaced, 26), null, 'the file must live under docs/specs/.flow/')
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
  await rejectsAfterAccepting('{ not json')
})

// #110 P3a:未知枚举从「整文件拒绝」改为「单字段降级」——
// 文件其余字段照常呈现,坏字段以 null/剔除呈现,面板按 git 证据判 stale。
test('an unknown stage degrades to null but keeps the rest of the file', async () => {
  const dir = repoWith(26, { ...valid, stage: 'shipped' })
  const state = await readFlowState(dir, 26)
  assert.notEqual(state, null, 'the file must survive an unknown stage')
  assert.equal(state.stage, null)
  assert.equal(state.grade, valid.grade)
  assert.deepEqual(state.tickets.map((t) => t.id), valid.tickets.map((t) => t.id))
})

test('an unknown grade degrades to null but keeps the stage', async () => {
  const dir = repoWith(26, { ...valid, grade: 'medium' })
  const state = await readFlowState(dir, 26)
  assert.notEqual(state, null)
  assert.equal(state.grade, null)
  assert.equal(state.stage, valid.stage)
})

test('a ticket with an unknown state is dropped, its siblings survive', async () => {
  const dir = repoWith(26, {
    ...valid,
    tickets: [
      { id: 1, title: 'good', state: 'done' },
      { id: 2, title: 'bad', state: 'blocked' },
    ],
  })
  const state = await readFlowState(dir, 26)
  assert.notEqual(state, null)
  assert.deepEqual(state.tickets.map((t) => t.id), [1])
})

test('an unknown CI status degrades the ci block to null', async () => {
  const dir = repoWith(26, { ...valid, ci: { run: 1, max: 2, status: 'flaky' } })
  const state = await readFlowState(dir, 26)
  assert.notEqual(state, null)
  assert.equal(state.ci, null)
  assert.equal(state.stage, valid.stage)
})

test('an unknown review state degrades the review block to null', async () => {
  const dir = repoWith(26, { ...valid, review: { state: 'shrug', axes: 2 } })
  const state = await readFlowState(dir, 26)
  assert.notEqual(state, null)
  assert.equal(state.review, null)
})

test('a future version field is refused; v:1 and legacy absence are accepted', async () => {
  const future = repoWith(26, { ...valid, v: 2 })
  assert.equal(await readFlowState(future, 26), null, 'an unknown file version must be refused wholesale')
  const v1 = repoWith(26, { ...valid, v: 1 })
  assert.notEqual(await readFlowState(v1, 26), null, 'v:1 must be accepted')
  const legacy = repoWith(26, valid)
  assert.notEqual(await readFlowState(legacy, 26), null, 'files written before v existed stay valid')
})

test('specPath passes through when it is a string and degrades otherwise', async () => {
  const withPath = repoWith(26, { ...valid, specPath: 'docs/specs/some-topic.md' })
  const state = await readFlowState(withPath, 26)
  assert.equal(state.specPath, 'docs/specs/some-topic.md')
  const without = repoWith(26, { ...valid, specPath: 42 })
  assert.equal((await readFlowState(without, 26)).specPath, null)
})

test('readFlowState rejects a non-integer issue', async () => {
  await rejectsAfterAccepting({ ...valid, issue: '26' })
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
