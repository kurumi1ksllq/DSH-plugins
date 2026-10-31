import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  STATE_DEFAULTS,
  dshHome,
  publicState,
  readState,
  statePath,
  writeState,
} from '../lib/sync-state.js'

function scratchHome() {
  return mkdtempSync(join(tmpdir(), 'dsh-state-'))
}

test('dshHome honours DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(dshHome({ DSH_HOME: '/custom' }), '/custom')
  assert.equal(dshHome({ HOME: '/home/u' }), join('/home/u', '.dsh'))
  assert.equal(dshHome({ USERPROFILE: 'C:\\Users\\u' }), join('C:\\Users\\u', '.dsh'))
  assert.equal(dshHome({}), null)
})

test('readState returns defaults when the file is absent', () => {
  const env = { DSH_HOME: scratchHome() }
  assert.deepEqual(readState(env), { ...STATE_DEFAULTS })
})

test('readState returns defaults when the file is garbage', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  writeFileSync(statePath(env), 'not json')
  assert.deepEqual(readState(env), { ...STATE_DEFAULTS })
})

test('writeState persists and merges partial updates', () => {
  const env = { DSH_HOME: scratchHome() }
  writeState({ repo: 'o/r', token: 'secret' }, env)
  writeState({ lastPullAt: 42 }, env)
  const state = readState(env)
  assert.equal(state.repo, 'o/r')
  // A later partial write must not erase the token.
  assert.equal(state.token, 'secret')
  assert.equal(state.lastPullAt, 42)
})

test('writeState creates the file with owner-only permissions', () => {
  const env = { DSH_HOME: scratchHome() }
  writeState({ token: 't' }, env)
  if (process.platform !== 'win32') {
    const mode = statSync(statePath(env)).mode & 0o777
    assert.equal(mode, 0o600)
  }
  const raw = JSON.parse(readFileSync(statePath(env), 'utf8'))
  assert.equal(raw.token, 't')
})

test('publicState never exposes the token', () => {
  const state = { ...STATE_DEFAULTS, repo: 'o/r', token: 'secret-value' }
  const pub = publicState(state)
  assert.equal(pub.hasToken, true)
  assert.equal('token' in pub, false)
  assert.equal(JSON.stringify(pub).includes('secret-value'), false)
})

test('publicState reports no token when empty', () => {
  assert.equal(publicState({ ...STATE_DEFAULTS }).hasToken, false)
})

test('statePath is null without a home', () => {
  assert.equal(statePath({}), null)
})
