import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import snapshot from '../lib/preset.json' with { type: 'json' }

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const REPO = resolve(PKG, '..', '..')

function delegationRows(snapshot) {
  const group = snapshot.plugins.find((row) => row.id === 'delegation')
  assert.ok(group, 'preset.json must carry a delegation group')
  return group.config
}

test('tool-subagent row exists as the spawn-side delegation target', () => {
  const row = delegationRows(snapshot).find((row) => row.id === 'tool-subagent')
  assert.ok(row, 'delegation group must contain the tool-subagent row')
  assert.equal(row.config?.provider, 'spawn', 'the whitelist rides the spawn-side row')
})

test('every whitelisted preset id is mirrored by the routing table, both directions', async () => {
  // Two-way equality: an id in the routing table but missing from the
  // whitelist would make the injected text advertise a delegation that errors
  // on first use, which is the dangerous direction.
  const { DELEGATION_PRESET_WHITELIST } = await import('../lib/model.mjs')
  const routingText = await readFile(
    join(REPO, 'packages/dsh-task-dispatcher/lib/delegation-text.mjs'),
    'utf8',
  )
  const routing = [...routingText.matchAll(/id: '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(
    [...DELEGATION_PRESET_WHITELIST].sort(),
    [...new Set(routing)].sort(),
    `whitelist and routing table diverged — update both together (spec issue-151 §验收 C): whitelist=${DELEGATION_PRESET_WHITELIST.join(',')} routing=${routing.join(',')}`,
  )
})

test('derive stamps the whitelist on the spawn-side row, snapshot stays official', async () => {
  // Single source of truth is DELEGATION_PRESET_WHITELIST in lib/model.mjs.
  // The checked-in snapshot keeps the official row untouched; derivation
  // applies the ids deterministically to whatever declaration it starts from.
  const { deriveDeepPtc, DELEGATION_PRESET_WHITELIST } = await import('../lib/model.mjs')
  const pristine = delegationRows(snapshot).find((row) => row.id === 'tool-subagent')
  assert.equal(
    pristine.config.allowedAgentPresets,
    undefined,
    'the snapshot must keep the official row untouched (whitelist rides derivation)',
  )
  const upstream = JSON.parse(JSON.stringify(snapshot))
  const preset = deriveDeepPtc(upstream, { environment: 'wsl', wslDistribution: '' }, 'win32').preset
  const derived = preset.plugins.find((row) => row.id === 'delegation').config
    .find((row) => row.id === 'tool-subagent')
  assert.deepEqual(derived.config.allowedAgentPresets, [...DELEGATION_PRESET_WHITELIST])
})

test('package manifest keeps its dsh engine declaration', async () => {
  // The real version discipline is enforced by check-bundle-versions
  // (engines.dsh must accommodate ^0.2.0); here we only pin that the field
  // stays present after the whitelist change.
  const pkg = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8'))
  assert.ok(typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.length > 0,
    'engines.dsh must stay declared')
})
