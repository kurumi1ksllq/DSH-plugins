import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MANIFEST_VERSION,
  buildManifest,
  describeSource,
  entryKey,
  entriesOf,
  normalizePlatform,
  parseManifest,
  platformFits,
} from '../lib/manifest.js'

test('normalises platform aliases to the canonical set', () => {
  assert.equal(normalizePlatform('Windows'), 'win32')
  assert.equal(normalizePlatform('macOS'), 'darwin')
  assert.equal(normalizePlatform('linux'), 'linux')
  assert.equal(normalizePlatform('unix'), 'any')
  assert.equal(normalizePlatform(undefined), 'any')
  assert.equal(normalizePlatform('plan9'), 'any')
})

test('platformFits treats any as universal and compares otherwise', () => {
  assert.equal(platformFits('any', 'linux'), true)
  assert.equal(platformFits('win32', 'win32'), true)
  assert.equal(platformFits('win32', 'linux'), false)
  assert.equal(platformFits(undefined, 'linux'), true)
})

test('describeSource turns link specs into repo and keeps npm versions', () => {
  assert.deepEqual(describeSource('link:E:/Project-hub/DSH-plugins/packages/dsh-ctx-guard'), { source: 'repo' })
  assert.deepEqual(describeSource('file:../local'), { source: 'repo' })
  assert.deepEqual(describeSource('0.1.8'), { source: 'npm', spec: '0.1.8' })
  assert.deepEqual(describeSource('npm:1.2.3'), { source: 'npm', spec: '1.2.3' })
  assert.deepEqual(describeSource('git+https://github.com/x/y.git'), {
    source: 'git',
    spec: 'git+https://github.com/x/y.git',
  })
  assert.deepEqual(describeSource(''), { source: 'unknown' })
  assert.deepEqual(describeSource(null), { source: 'unknown' })
})

test('buildManifest skips official bundles and disabled skill stubs', () => {
  const snapshot = {
    packages: [
      { name: '@deepseek-ai/dsh-base', spec: '0.2.1', version: '0.2.1' },
      { name: 'dsh-ctx-guard', spec: 'link:E:/x', version: '0.1.1' },
    ],
    mcp: [{ server: 'context7', transport: 'stdio', enabled: true }],
    skills: [
      { name: 'ui-design', disabled: false, modelInvocable: true },
      { name: 'office-docx', disabled: true, modelInvocable: false },
    ],
  }
  const manifest = buildManifest(snapshot, { now: 1, repo: 'kurumi1ksllq/dsh-manager' })
  assert.equal(manifest.manifestVersion, MANIFEST_VERSION)
  assert.equal(manifest.generatedAt, 1)
  assert.equal(manifest.repo, 'kurumi1ksllq/dsh-manager')
  assert.deepEqual(
    manifest.plugins.map((p) => p.name),
    ['dsh-ctx-guard'],
  )
  assert.equal(manifest.plugins[0].source, 'repo')
  assert.equal(manifest.mcp.length, 1)
  assert.deepEqual(
    manifest.skills.map((s) => s.name),
    ['ui-design'],
  )
})

test('buildManifest applies annotations by kind-scoped key', () => {
  const snapshot = {
    packages: [{ name: 'dsh-git-bash-tool', spec: 'link:E:/x', version: '0.1.0' }],
    skills: [{ name: 'vmware-workstation', disabled: false, modelInvocable: true }],
    mcp: [],
  }
  const annotations = {
    'dsh-git-bash-tool': { platform: 'win32' },
    'skill:vmware-workstation': { platform: 'win32', requires: ['vmware-workstation'] },
  }
  const manifest = buildManifest(snapshot, { annotations, now: 0 })
  assert.equal(manifest.plugins[0].platform, 'win32')
  assert.equal(manifest.skills[0].platform, 'win32')
  assert.deepEqual(manifest.skills[0].requires, ['vmware-workstation'])
})

test('buildManifest marks self entries', () => {
  const manifest = buildManifest(
    { packages: [{ name: 'dsh-inventory', spec: 'link:E:/x', version: '0.1.0' }], mcp: [], skills: [] },
    { annotations: { 'dsh-inventory': { self: true } }, now: 0 },
  )
  assert.equal(manifest.plugins[0].self, true)
})

test('parseManifest rejects bad JSON, wrong version and non-objects', () => {
  assert.match(parseManifest('{oops').error, /不是合法 JSON/)
  assert.match(parseManifest('[]').error, /顶层必须是对象/)
  assert.match(parseManifest(JSON.stringify({ manifestVersion: 99 })).error, /版本不受支持/)
})

test('parseManifest round-trips a built manifest', () => {
  const built = buildManifest(
    {
      packages: [{ name: 'a', spec: '1.0.0', version: '1.0.0' }],
      mcp: [{ server: 'm', transport: 'stdio' }],
      skills: [{ name: 's', disabled: false, modelInvocable: true }],
    },
    { now: 5, repo: 'o/r' },
  )
  const parsed = parseManifest(JSON.stringify(built)).manifest
  assert.equal(parsed.repo, 'o/r')
  assert.equal(parsed.generatedAt, 5)
  assert.deepEqual(
    entriesOf(parsed).map(entryKey),
    ['plugin:a', 'mcp:m', 'skill:s'],
  )
})

test('parseManifest drops nameless entries and normalises fields', () => {
  const text = JSON.stringify({
    manifestVersion: 1,
    plugins: [{ name: 'ok', platform: 'Windows', requires: ['officecli', 42] }, { nope: true }],
  })
  const parsed = parseManifest(text).manifest
  assert.equal(parsed.plugins.length, 1)
  assert.equal(parsed.plugins[0].platform, 'win32')
  assert.deepEqual(parsed.plugins[0].requires, ['officecli'])
})

test('annotations match by kind:name or by bare name', () => {
  // Both spellings appear in the wild — the panel writes kind:name, a hand
  // edited manifest tends to write the bare name. A miss here silently drops a
  // platform marker, which would offer a Windows-only plugin to a Linux host.
  const snapshot = { packages: [{ name: 'dsh-git-bash-tool', version: '0.1.0' }], mcp: [], skills: [] }
  const byBare = buildManifest(snapshot, { annotations: { 'dsh-git-bash-tool': { platform: 'win32' } }, now: 1 })
  const byKey = buildManifest(snapshot, { annotations: { 'plugin:dsh-git-bash-tool': { platform: 'win32' } }, now: 1 })
  assert.equal(byBare.plugins[0].platform, 'win32')
  assert.equal(byKey.plugins[0].platform, 'win32')
})

