import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkEligibility,
  diffManifest,
  probeCapabilities,
  selectableRows,
  summarizeDiff,
} from '../lib/sync-diff.js'

function caps(overrides = {}) {
  return {
    platform: 'linux',
    hasCommand: () => false,
    gpu: false,
    ...overrides,
  }
}

function manifest(entries) {
  return {
    manifestVersion: 1,
    generatedAt: 0,
    repo: 'o/r',
    ref: 'main',
    plugins: entries.filter((e) => e.kind === 'plugin'),
    mcp: entries.filter((e) => e.kind === 'mcp'),
    skills: entries.filter((e) => e.kind === 'skill'),
  }
}

test('checkEligibility rejects a platform mismatch with a readable reason', () => {
  const result = checkEligibility({ platform: 'win32', requires: [], self: false }, caps())
  assert.equal(result.ok, false)
  assert.match(result.reason, /仅支持 win32/)
})

test('checkEligibility rejects a missing external command', () => {
  const result = checkEligibility(
    { platform: 'any', requires: ['officecli'], self: false },
    caps({ hasCommand: () => false }),
  )
  assert.equal(result.ok, false)
  assert.match(result.reason, /缺少依赖命令 officecli/)
})

test('checkEligibility accepts when the command exists', () => {
  const result = checkEligibility(
    { platform: 'any', requires: ['officecli'], self: false },
    caps({ hasCommand: (c) => c === 'officecli' }),
  )
  assert.equal(result.ok, true)
})

test('checkEligibility blocks GPU-requiring items on a GPU-less host', () => {
  const result = checkEligibility({ platform: 'any', requires: ['gpu'], self: false }, caps({ gpu: false }))
  assert.equal(result.ok, false)
  assert.match(result.reason, /需要 GPU/)
})

test('checkEligibility always blocks self entries', () => {
  const result = checkEligibility({ platform: 'any', requires: [], self: true }, caps())
  assert.equal(result.ok, false)
  assert.match(result.reason, /同步插件自身/)
})

test('diffManifest marks a platform-incompatible item blocked, not missing', () => {
  const rows = diffManifest(
    manifest([{ kind: 'skill', name: 'vmware-workstation', platform: 'win32', requires: [] }]),
    { packages: [], mcp: [], skills: [] },
    { capabilities: caps() },
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'blocked')
  assert.match(rows[0].reason, /win32/)
})

test('diffManifest marks an installable absent item missing', () => {
  const rows = diffManifest(
    manifest([{ kind: 'plugin', name: 'dsh-ctx-guard', version: '0.1.1', platform: 'any' }]),
    { packages: [], mcp: [], skills: [] },
    { capabilities: caps() },
  )
  assert.equal(rows[0].status, 'missing')
})

test('diffManifest marks a matching version current', () => {
  const rows = diffManifest(
    manifest([{ kind: 'plugin', name: 'dsh-ctx-guard', version: '0.1.1', platform: 'any' }]),
    { packages: [{ name: 'dsh-ctx-guard', version: '0.1.1' }], mcp: [], skills: [] },
    { capabilities: caps() },
  )
  assert.equal(rows[0].status, 'current')
})

test('diffManifest marks a differing version outdated', () => {
  const rows = diffManifest(
    manifest([{ kind: 'plugin', name: 'dsh-ctx-guard', version: '0.1.1', platform: 'any' }]),
    { packages: [{ name: 'dsh-ctx-guard', version: '0.0.9' }], mcp: [], skills: [] },
    { capabilities: caps() },
  )
  assert.equal(rows[0].status, 'outdated')
  assert.match(rows[0].reason, /0\.0\.9/)
})

test('diffManifest reports a disabled item as disabled, not missing', () => {
  const rows = diffManifest(
    manifest([{ kind: 'mcp', name: 'context7', platform: 'any' }]),
    { packages: [], mcp: [{ server: 'context7', enabled: false }], skills: [] },
    { capabilities: caps() },
  )
  assert.equal(rows[0].status, 'disabled')
})

test('a disabled skill stub is reported as disabled, not local-only', () => {
  // buildManifest skips disabled stubs on purpose. If the diff called them
  // local-only, the panel would offer to publish something the publisher
  // drops again — a loop that looks like a bug to the user.
  const rows = diffManifest(
    manifest([]),
    { packages: [], mcp: [], skills: [{ name: 'office-docx', disabled: true }, { name: 'ponytail' }] },
    { capabilities: caps() },
  )
  const byKey = new Map(rows.map((r) => [r.key, r]))
  assert.equal(byKey.get('skill:office-docx').status, 'disabled')
  assert.equal(byKey.get('skill:ponytail').status, 'local-only')
})

test('diffManifest reports local-only for things the manifest does not name', () => {
  const rows = diffManifest(
    manifest([]),
    {
      packages: [
        { name: 'dsh-ctx-guard', version: '0.1.1' },
        { name: '@deepseek-ai/dsh-base', version: '0.2.1' },
      ],
      mcp: [],
      skills: [{ name: 'ponytail' }],
    },
    { capabilities: caps() },
  )
  const localOnly = rows.filter((r) => r.status === 'local-only')
  // Official bundles are dsh itself and never appear as local-only.
  assert.deepEqual(
    localOnly.map((r) => r.key),
    ['plugin:dsh-ctx-guard', 'skill:ponytail'],
  )
})

test('diffManifest always skips self entries', () => {
  const rows = diffManifest(
    manifest([{ kind: 'plugin', name: 'dsh-inventory', version: '0.1.0', self: true, platform: 'any' }]),
    { packages: [], mcp: [], skills: [] },
    { capabilities: caps() },
  )
  assert.equal(rows[0].status, 'skip')
})

test('diffManifest tolerates a null snapshot', () => {
  const rows = diffManifest(
    manifest([{ kind: 'plugin', name: 'a', version: '1.0.0', platform: 'any' }]),
    null,
    { capabilities: caps() },
  )
  assert.equal(rows[0].status, 'missing')
})

test('diffManifest sorts actionable rows before informational ones', () => {
  const rows = diffManifest(
    manifest([
      { kind: 'skill', name: 'z-current', platform: 'any' },
      { kind: 'plugin', name: 'a-missing', version: '1.0.0', platform: 'any' },
    ]),
    { packages: [], mcp: [], skills: [{ name: 'z-current' }] },
    { capabilities: caps() },
  )
  assert.deepEqual(
    rows.map((r) => r.status),
    ['missing', 'current'],
  )
})

test('summarizeDiff counts each status and the actionable subset', () => {
  const rows = [
    { status: 'missing' },
    { status: 'missing' },
    { status: 'outdated' },
    { status: 'current' },
    { status: 'blocked' },
    { status: 'local-only' },
    { status: 'skip' },
  ]
  const counts = summarizeDiff(rows)
  assert.equal(counts.missing, 2)
  assert.equal(counts.outdated, 1)
  assert.equal(counts.total, 7)
  assert.equal(counts.actionable, 3)
  assert.equal(counts.disabled, 0)
})

test('selectableRows keeps only missing and outdated', () => {
  const rows = [
    { key: 'a', status: 'missing' },
    { key: 'b', status: 'blocked' },
    { key: 'c', status: 'outdated' },
    { key: 'd', status: 'current' },
  ]
  assert.deepEqual(
    selectableRows(rows).map((r) => r.key),
    ['a', 'c'],
  )
})

test('probeCapabilities defaults to the current platform and a custom probe', () => {
  const caps = probeCapabilities({ platform: 'linux', hasCommand: (c) => c === 'git', gpu: true })
  assert.equal(caps.platform, 'linux')
  assert.equal(caps.hasCommand('git'), true)
  assert.equal(caps.hasCommand('officecli'), false)
  assert.equal(caps.gpu, true)
})
