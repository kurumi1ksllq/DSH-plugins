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

test('no agent_preset surface survives: the shell-child path is unreachable', async () => {
  const model = await readFile(join(PKG, 'lib/model.mjs'), 'utf8')
  assert.doesNotMatch(model, /allowedAgentPresets/, 'derive must not stamp allowedAgentPresets any more')
  assert.doesNotMatch(model, /DELEGATION_PRESET_WHITELIST/, 'the whitelist constant must be gone, not just unused')

  // The injected text is asserted where it is rendered (dsh-task-dispatcher
  // test/role-routing.test.mjs): scanning this file's source would match its
  // own explanatory comments and prove nothing about what the model sees.
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

test('package manifest keeps its dsh engine declaration', async () => {
  // The real version discipline is enforced by check-bundle-versions
  // (engines.dsh must accommodate ^0.2.0); here we only pin that the field
  // stays present after the whitelist removal.
  const pkg = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8'))
  assert.ok(typeof pkg.engines?.dsh === 'string' && pkg.engines.dsh.length > 0,
    'engines.dsh must stay declared')
})
