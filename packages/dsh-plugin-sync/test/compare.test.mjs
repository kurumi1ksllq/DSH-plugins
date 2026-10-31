/**
 * Tests for the installed-vs-wanted comparison and the log summary.
 *
 * Run: node --test test/*.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { diff, summarize } from '../lib/compare.js'

describe('diff', () => {
  const wanted = [
    { name: 'dsh-ctx-guard', version: '0.1.1' },
    { name: 'dsh-inventory', version: '0.2.0' },
    { name: 'dsh-brand-new', version: '1.0.0' },
  ]

  it('classifies current, outdated and missing', () => {
    const installed = [
      { name: 'dsh-ctx-guard', version: '0.1.1', present: true },
      { name: 'dsh-inventory', version: '0.1.0', present: true },
    ]
    const result = diff(installed, wanted)
    const byName = Object.fromEntries(result.actions.map((a) => [a.name, a.state]))
    assert.equal(byName['dsh-ctx-guard'], 'current')
    assert.equal(byName['dsh-inventory'], 'outdated')
    assert.equal(byName['dsh-brand-new'], 'missing')
    assert.equal(result.pending.length, 2)
  })

  it('treats a dependency with no node_modules entry as missing', () => {
    const installed = [{ name: 'dsh-ctx-guard', version: '0.1.1', present: false }]
    const result = diff(installed, [{ name: 'dsh-ctx-guard', version: '0.1.1' }])
    assert.equal(result.actions[0].state, 'missing')
    assert.equal(result.actions[0].installed, undefined)
  })

  it('never reports built-in packages as extra', () => {
    const installed = [{ name: '@deepseek-ai/dsh-base', version: '9.9.9', present: true, builtin: true }]
    assert.deepEqual(diff(installed, []).extras, [])
  })

  it('reports a locally added plugin as extra without queueing it', () => {
    const installed = [{ name: 'dsh-local-only', version: '0.3.0', present: true, builtin: false }]
    const result = diff(installed, [])
    assert.equal(result.extras.length, 1)
    assert.equal(result.extras[0].name, 'dsh-local-only')
    assert.equal(result.pending.length, 0)
  })

  it('excludes the plugin itself from what apply mode may touch', () => {
    const result = diff([], [{ name: 'dsh-plugin-sync', version: '0.2.0' }], { exclude: ['dsh-plugin-sync'] })
    assert.equal(result.pending.length, 1)
    assert.equal(result.applicable.length, 0)
    assert.equal(result.pending[0].excluded, true)
  })

  it('leaves non-excluded pending actions applicable', () => {
    const result = diff([], [{ name: 'dsh-ctx-guard', version: '0.1.1' }], { exclude: ['dsh-plugin-sync'] })
    assert.equal(result.applicable.length, 1)
    assert.equal(result.applicable[0].name, 'dsh-ctx-guard')
  })

  it('carries the manifest spec onto a missing action', () => {
    const result = diff([], [{ name: 'a', version: '1', spec: 'github:owner/repo#v1' }])
    assert.equal(result.actions[0].spec, 'github:owner/repo#v1')
  })

  it('reports nothing pending when everything matches', () => {
    const installed = wanted.map((w) => ({ ...w, present: true }))
    const result = diff(installed, wanted)
    assert.equal(result.pending.length, 0)
    assert.equal(result.actions.every((a) => a.state === 'current'), true)
  })
})

describe('summarize', () => {
  it('says it skipped when the fetch failed', () => {
    assert.equal(
      summarize({ ok: false, reason: 'git-failed: no network', pending: [], actions: [], applied: [] }),
      'plugin-sync: skipped (git-failed: no network)',
    )
  })

  it('says up to date when nothing is pending', () => {
    assert.equal(summarize({ ok: true, pending: [], actions: [1, 2, 3], applied: [] }), 'plugin-sync: up to date (3 plugins)')
  })

  it('counts missing and outdated separately', () => {
    assert.equal(
      summarize({ ok: true, pending: [{ state: 'missing' }, { state: 'outdated' }], actions: [], applied: [] }),
      'plugin-sync: 1 missing, 1 outdated',
    )
  })

  it('appends the applied count only when something was applied', () => {
    assert.equal(
      summarize({ ok: true, pending: [{ state: 'missing' }], actions: [], applied: [{ ok: true }] }),
      'plugin-sync: 1 missing, 1 applied',
    )
    assert.equal(summarize({ ok: true, pending: [{ state: 'missing' }], actions: [], applied: [] }), 'plugin-sync: 1 missing')
  })
})
