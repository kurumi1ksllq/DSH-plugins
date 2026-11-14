import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import snapshot from '../lib/preset.json' with { type: 'json' }

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')

function delegationRows(snapshot) {
  const group = snapshot.plugins.find((row) => row.id === 'delegation')
  assert.ok(group, 'preset.json must carry a delegation group')
  return group.config
}

test('tool-subagent row exists as the spawn-side delegation target', () => {
  const row = delegationRows(snapshot).find((row) => row.id === 'tool-subagent')
  assert.ok(row, 'delegation group must contain the tool-subagent row')
  assert.equal(row.config?.provider, 'spawn', 'the spawn-side row is the delegation target')
})

// ---------------------------------------------------------------------------
// #207: the `agent_preset` surface is removed, not merely discouraged.
//
// The whitelist existed for exactly one purpose: making `dsh-tool-subagent`
// spread an `agent_preset` parameter into its schema (the parameter appears
// only when `presets.choices` is defined). Measured on this deployment, that
// argument yields a child with 28 tools, no read/write/edit/glob/grep and no
// persona, while `delegate_role`'s child keeps the full toolset AND the
// persona. Leaving the parameter reachable leaves the shell path reachable, so
// the whitelist goes away entirely and the row is inherited unchanged.
// ---------------------------------------------------------------------------

test('the whitelist is gone from the module public surface', async () => {
  // A public export, so its removal is observable behaviour, not an internal
  // detail: the old name must not come back as an export someone could wire
  // up again. Deliberately NOT a source-text scan -- a scan would also match
  // this file's own explanatory comments, and the repo rule is to assert
  // public behaviour and output, not source spelling.
  const model = await import('../lib/model.mjs')
  assert.equal(
    Object.hasOwn(model, 'DELEGATION_PRESET_WHITELIST'),
    false,
    'the whitelist constant must not be exported again',
  )
})

test('derive leaves the spawn-side row exactly as the official declaration has it', async () => {
  // No extra config key may ride out of derivation, or the parameter comes back.
  const { deriveDeepPtc } = await import('../lib/model.mjs')
  const pristine = delegationRows(snapshot).find((row) => row.id === 'tool-subagent')
  assert.equal(pristine.config.allowedAgentPresets, undefined, 'the snapshot must stay official')
  const upstream = JSON.parse(JSON.stringify(snapshot))
  const { preset, report } = deriveDeepPtc(upstream, { environment: 'wsl', wslDistribution: '' }, 'win32')
  const derived = preset.plugins.find((row) => row.id === 'delegation').config
    .find((row) => row.id === 'tool-subagent')
  assert.deepEqual(derived, pristine, 'the spawn-side delegation row must come out unchanged')
  assert.equal(
    report.wrapped.some((entry) => entry.includes('tool-subagent')),
    false,
    'derivation must not report a whitelist wrap it no longer performs',
  )
})

test('no row anywhere in the derived preset carries allowedAgentPresets', async () => {
  // The source scan above only proves this package stopped stamping the key.
  // The key is what makes dsh-tool-subagent spread `agent_preset` into its
  // schema, so a stray copy elsewhere in the composition (a preset row, a
  // future patch) would silently bring the shell path back while every other
  // assertion stayed green. Walk the whole derived tree, including groups.
  const { deriveDeepPtc, walkRows } = await import('../lib/model.mjs')
  const upstream = JSON.parse(JSON.stringify(snapshot))
  const { preset } = deriveDeepPtc(upstream, { environment: 'wsl', wslDistribution: '' }, 'win32')
  const carriers = []
  walkRows(preset.plugins, (row) => {
    if (row?.config !== undefined && Object.hasOwn(row.config, 'allowedAgentPresets')) carriers.push(row.id ?? row.name)
  })
  assert.deepEqual(carriers, [], 'no derived row may carry allowedAgentPresets: ' + carriers.join(', '))
})

test('package manifest keeps its dsh engine declaration', async () => {
  // The real version discipline is enforced by check-bundle-versions
  // (engines.dsh must accommodate ^0.2.0); here we only pin that the field
  // stays present after the whitelist removal.
  const pkg = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8'))
  assert.ok(typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.length > 0,
    'engines.dsh must stay declared')
})
