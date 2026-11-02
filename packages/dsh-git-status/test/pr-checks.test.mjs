import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyChecks, prChecks } from '../lib/gh.js'

/** Minimal `gh pr checks --json state` payloads. */
const allGreen = JSON.stringify([
  { name: 'test', state: 'SUCCESS' },
  { name: 'lint', state: 'SUCCESS' },
])
const oneRed = JSON.stringify([
  { name: 'test', state: 'SUCCESS' },
  { name: 'lint', state: 'FAILURE' },
])
const pending = JSON.stringify([{ name: 'test', state: 'IN_PROGRESS' }])

/**
 * `classifyChecks` is the pure half: it decides green/red/none/unknown from the
 * raw check list, so the three-state contract is testable without spawning gh.
 */
test('classifyChecks: no checks at all is none, never green', () => {
  assert.equal(classifyChecks([]), 'none')
})

test('classifyChecks: every check succeeded is green', () => {
  assert.equal(classifyChecks(JSON.parse(allGreen)), 'green')
})

test('classifyChecks: any failure is red', () => {
  assert.equal(classifyChecks(JSON.parse(oneRed)), 'red')
  assert.equal(classifyChecks([{ name: 'a', state: 'CANCELLED' }]), 'red')
  assert.equal(classifyChecks([{ name: 'a', state: 'TIMED_OUT' }]), 'red')
  assert.equal(classifyChecks([{ name: 'a', state: 'STARTUP_FAILURE' }]), 'red')
})

test('classifyChecks: still running is unknown, not green', () => {
  assert.equal(classifyChecks(JSON.parse(pending)), 'unknown')
  assert.equal(classifyChecks([{ name: 'a', state: 'QUEUED' }]), 'unknown')
})

test('classifyChecks: a red among green wins', () => {
  assert.equal(classifyChecks([{ name: 'a', state: 'SUCCESS' }, { name: 'b', state: 'FAILURE' }]), 'red')
})

test('classifyChecks: a failure outranks a still-running check', () => {
  assert.equal(classifyChecks([{ name: 'a', state: 'IN_PROGRESS' }, { name: 'b', state: 'FAILURE' }]), 'red')
})

test('prChecks: refuses a non-positive PR number without spawning gh', async () => {
  assert.equal(await prChecks('/tmp', 0), 'unknown')
  assert.equal(await prChecks('/tmp', -3), 'unknown')
  assert.equal(await prChecks('/tmp', null), 'unknown')
})
