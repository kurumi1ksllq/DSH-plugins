/**
 * Tests for config merging and manifest parsing. No harness boot, no git.
 *
 * Run: node --test test/*.test.mjs
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULTS, MANIFEST_NAME, mergeConfig } from '../lib/config.js'
import { parseManifest } from '../lib/compare.js'

describe('mergeConfig', () => {
  it('returns the documented defaults for empty input', () => {
    assert.deepEqual(mergeConfig(undefined), DEFAULTS)
    assert.deepEqual(mergeConfig(null), DEFAULTS)
    assert.deepEqual(mergeConfig({}), DEFAULTS)
  })

  it('defaults to report-only so a fresh install never writes', () => {
    assert.equal(DEFAULTS.apply, false)
    assert.equal(DEFAULTS.repo, '')
    assert.equal(DEFAULTS.direction, 'remote')
  })

  it('keeps its own name out of the apply set', () => {
    assert.deepEqual(DEFAULTS.exclude, ['dsh-plugin-sync'])
  })

  it('overrides known keys and ignores unknown ones', () => {
    const merged = mergeConfig({ repo: 'https://example.invalid/repo.git', ref: 'dev', nonsense: 1 })
    assert.equal(merged.repo, 'https://example.invalid/repo.git')
    assert.equal(merged.ref, 'dev')
    assert.equal(Object.hasOwn(merged, 'nonsense'), false)
  })

  it('drops undefined values instead of clobbering defaults', () => {
    const merged = mergeConfig({ repo: undefined, apply: undefined })
    assert.equal(merged.repo, DEFAULTS.repo)
    assert.equal(merged.apply, DEFAULTS.apply)
  })

  it('normalizes direction: anything but local means remote', () => {
    assert.equal(mergeConfig({ direction: 'remote' }).direction, 'remote')
    assert.equal(mergeConfig({ direction: 'local' }).direction, 'local')
    assert.equal(mergeConfig({ direction: 'sideways' }).direction, 'remote')
  })

  it('clamps the git timeout to a sane floor', () => {
    assert.equal(mergeConfig({ gitTimeoutMs: 50 }).gitTimeoutMs, 1000)
    assert.equal(mergeConfig({ gitTimeoutMs: 'fast' }).gitTimeoutMs, DEFAULTS.gitTimeoutMs)
  })

  it('filters the exclude list down to strings', () => {
    assert.deepEqual(mergeConfig({ exclude: ['a', 3, null, 'b'] }).exclude, ['a', 'b'])
  })

  it('falls back to the default exclude list when given a non-array', () => {
    assert.deepEqual(mergeConfig({ exclude: 'nope' }).exclude, DEFAULTS.exclude)
  })
})

describe('parseManifest', () => {
  it('names the manifest file dsh-plugins.json', () => {
    assert.equal(MANIFEST_NAME, 'dsh-plugins.json')
  })

  it('accepts a well-formed manifest', () => {
    const { plugins, problems } = parseManifest({
      plugins: [
        { name: 'dsh-ctx-guard', version: '0.1.1' },
        { name: 'dsh-inventory', version: '0.1.0', spec: 'github:owner/repo#v0.1.0' },
      ],
    })
    assert.deepEqual(problems, [])
    assert.equal(plugins.length, 2)
    assert.equal(plugins[0].name, 'dsh-ctx-guard')
    assert.equal(plugins[1].spec, 'github:owner/repo#v0.1.0')
  })

  it('rejects a non-object manifest', () => {
    assert.deepEqual(parseManifest([]).problems, ['manifest is not an object'])
    assert.deepEqual(parseManifest('nope').problems, ['manifest is not an object'])
    assert.deepEqual(parseManifest(null).problems, ['manifest is not an object'])
  })

  it('rejects a manifest without a plugins array', () => {
    assert.deepEqual(parseManifest({}).problems, ['manifest.plugins is not an array'])
    assert.deepEqual(parseManifest({ plugins: {} }).problems, ['manifest.plugins is not an array'])
  })

  it('reports per-entry problems and keeps the good entries', () => {
    const { plugins, problems } = parseManifest({
      plugins: [{ name: 'good', version: '1.0.0' }, { version: '1.0.0' }, { name: 'no-version' }, 'nope'],
    })
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0].name, 'good')
    assert.equal(problems.length, 3)
    assert.ok(problems.some((p) => p.includes('missing name')))
    assert.ok(problems.some((p) => p.includes('no-version: missing version')))
    assert.ok(problems.some((p) => p.includes('not an object')))
  })

  it('defaults optional to false', () => {
    assert.equal(parseManifest({ plugins: [{ name: 'a', version: '1' }] }).plugins[0].optional, false)
    assert.equal(parseManifest({ plugins: [{ name: 'a', version: '1', optional: true }] }).plugins[0].optional, true)
  })
})
