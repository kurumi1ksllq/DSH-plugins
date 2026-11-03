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

// ---- prChecks over a fake `gh` on PATH -------------------------------------
// The earlier cases never touched prChecks' I/O branches, so a broken `none`
// path passed the whole suite. These run a stub `gh` so the real spawn, exit
// code and stdout handling are exercised.

import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Build a dir containing a fake `gh` that prints `body` and exits `code`. */
function fakeGhDir(body, code) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'))
  const script = `#!/bin/sh\nprintf '%s' '${body.replace(/'/g, "'\\''")}'\nexit ${code}\n`
  writeFileSync(join(dir, 'gh'), script)
  chmodSync(join(dir, 'gh'), 0o755)
  return dir
}

/** Run `fn` with `dir` prepended to PATH. */
async function withPath(dir, fn) {
  const previous = process.env.PATH
  process.env.PATH = `${dir}:${previous}`
  try {
    return await fn()
  } finally {
    process.env.PATH = previous
  }
}

test('prChecks: all checks green over a real process', async () => {
  const dir = fakeGhDir('[{"name":"test","state":"SUCCESS"}]', 0)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'green')
})

test('prChecks: a failing check is red', async () => {
  const dir = fakeGhDir('[{"name":"test","state":"FAILURE"}]', 1)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'red')
})

test('prChecks: gh exits 1 with "no checks reported" is none, not unknown', async () => {
  const dir = fakeGhDir('no checks reported on the branch\n', 1)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'none')
})

test('prChecks: an empty check list is none', async () => {
  const dir = fakeGhDir('[]', 0)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'none')
})

test('prChecks: pending checks (gh exit 8) stay unknown, never green', async () => {
  const dir = fakeGhDir('[{"name":"test","state":"IN_PROGRESS"}]', 8)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'unknown')
})

test('prChecks: a hard failure with no output is unknown', async () => {
  const dir = fakeGhDir('', 1)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'unknown')
})

test('prChecks: unparseable output on exit 0 is unknown', async () => {
  const dir = fakeGhDir('not json', 0)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'unknown')
})

test('prChecks: whitespace-only output on failure is unknown, not none', async () => {
  // "failed and said nothing useful" must not read as "this repo has no CI".
  const dir = fakeGhDir('   \n', 1)
  assert.equal(await withPath(dir, () => prChecks('/tmp', 7)), 'unknown')
})
