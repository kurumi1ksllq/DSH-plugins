import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { dshHome } from '../lib/dsh-home.js'
import { dshHome as vaultHome } from '../lib/vault.js'
import { dshHome as stateHome } from '../lib/sync-state.js'
import { readDefaultWorkspace, sharedSkillRoots } from '../lib/workspaces.js'

test('all home resolvers agree for every input shape', () => {
  for (const env of [{ DSH_HOME: '/custom' }, { HOME: '/home/u' }, { USERPROFILE: 'C:\\Users\\u' }]) {
    assert.equal(vaultHome(env), dshHome(env))
    assert.equal(stateHome(env), dshHome(env))
  }
})

test('DSH_HOME override drives every resolver to the same root', () => {
  process.env.DSH_HOME = '/inv-home-agree'
  try {
    assert.equal(vaultHome(), '/inv-home-agree')
    assert.equal(stateHome(), '/inv-home-agree')
    // sharedSkillRoots puts the user-dsh root under the same home.
    const userRoot = sharedSkillRoots().find((r) => r.source === 'user-dsh')
    assert.equal(userRoot.dir, join('/inv-home-agree', 'skills'))
  } finally {
    delete process.env.DSH_HOME
  }
})

test('readDefaultWorkspace defaults to the shared resolver', () => {
  process.env.DSH_HOME = '/inv-home-agree'
  try {
    // No storages/workspace.json there, so undefined — but the resolution
    // itself must not throw and must have consulted the shared home.
    assert.equal(readDefaultWorkspace(), undefined)
  } finally {
    delete process.env.DSH_HOME
  }
})
