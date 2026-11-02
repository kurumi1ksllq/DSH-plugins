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
import { LEGACY_ID } from '../lib/fleet.js'

function scratchHome() {
  return mkdtempSync(join(tmpdir(), 'dsh-state-'))
}

/** `STATE_DEFAULTS` minus the fields a read is allowed to fill in for us. */
function withoutMachineId(defaults) {
  const { machineId, ...rest } = defaults
  return rest
}

test('dshHome honours DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(dshHome({ DSH_HOME: '/custom' }), '/custom')
  assert.equal(dshHome({ HOME: '/home/u' }), join('/home/u', '.dsh'))
  assert.equal(dshHome({ USERPROFILE: 'C:\\Users\\u' }), join('C:\\Users\\u', '.dsh'))
  // No env override: the shared resolver in dsh-home.js falls back to os.homedir(),
  // so an empty env still resolves (never null) — same value for every module.
  const resolved = dshHome({})
  assert.equal(typeof resolved, 'string')
  assert.equal(resolved.endsWith(join('.dsh')), true)
})

test('readState mints a machineId when the file is absent', () => {
  const env = { DSH_HOME: scratchHome() }
  const state = readState(env)
  // Everything except the minted id is still the documented default.
  const { machineId, ...rest } = state
  assert.deepEqual(rest, withoutMachineId({ ...STATE_DEFAULTS }))
  assert.equal(typeof machineId, 'string')
  assert.equal(machineId.length > 0, true)
  assert.notEqual(machineId, LEGACY_ID)
  // Minted once and persisted: a second read returns the same id.
  assert.equal(readState(env).machineId, machineId)
})

test('readState mints a machineId when the file is garbage', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  writeFileSync(statePath(env), 'not json')
  const state = readState(env)
  const { machineId, ...rest } = state
  assert.deepEqual(rest, withoutMachineId({ ...STATE_DEFAULTS }))
  assert.equal(typeof machineId, 'string')
  assert.equal(machineId.length > 0, true)
})

test('readState keeps an existing machineId across reads', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  writeFileSync(statePath(env), JSON.stringify({ repo: 'o/r', machineId: 'box-a' }))
  assert.equal(readState(env).machineId, 'box-a')
})

test('writeState persists and merges partial updates', async () => {
  const env = { DSH_HOME: scratchHome() }
  await writeState({ repo: 'o/r', token: 'secret' }, env)
  await writeState({ lastPullAt: 42 }, env)
  const state = readState(env)
  assert.equal(state.repo, 'o/r')
  // A later partial write must not erase the token.
  assert.equal(state.token, 'secret')
  assert.equal(state.lastPullAt, 42)
})

test('writeState creates the file with owner-only permissions', async () => {
  const env = { DSH_HOME: scratchHome() }
  await writeState({ token: 't' }, env)
  if (process.platform !== 'win32') {
    const mode = statSync(statePath(env)).mode & 0o777
    assert.equal(mode, 0o600)
  }
  const raw = JSON.parse(readFileSync(statePath(env), 'utf8'))
  assert.equal(raw.token, 't')
})

test('writeState serializes concurrent partial updates', async () => {
  const env = { DSH_HOME: scratchHome() }
  // 50 concurrent partial writes, each its own field: without the queue the
  // read→merge→write of one call would clobber the others' keys.
  const patches = []
  for (let i = 0; i < 50; i += 1) {
    patches.push({ [`annotations`]: { ...(patches[i - 1]?.annotations ?? {}), [`k${i}`]: i } })
  }
  // Also mix in plain top-level fields to catch merges of scalars.
  patches.push({ lastPullAt: 7 }, { lastPushAt: 8 }, { repo: 'o/r' })
  await Promise.all(patches.map((patch) => writeState(patch, env)))
  const state = readState(env)
  for (let i = 0; i < 50; i += 1) {
    assert.equal(state.annotations[`k${i}`], i, `annotations.k${i} must survive`)
  }
  assert.equal(state.lastPullAt, 7)
  assert.equal(state.lastPushAt, 8)
  assert.equal(state.repo, 'o/r')
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

test('statePath falls back to os.homedir() when env has no home', () => {
  // dsh-home.js never returns null: an empty env resolves via os.homedir().
  const resolved = statePath({})
  assert.equal(typeof resolved, 'string')
  assert.equal(resolved.endsWith(join('.dsh', 'plugin-sync.json')), true)
})
