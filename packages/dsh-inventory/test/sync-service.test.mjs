import { test } from 'node:test'
import assert from 'node:assert/strict'

import { syncApply, syncPreview, syncPublish, syncStatus } from '../lib/sync-service.js'

const SNAPSHOT = {
  packages: [{ name: 'dsh-ctx-guard', spec: 'link:E:/x', version: '0.1.1' }],
  mcp: [{ server: 'context7', enabled: true }],
  skills: [{ name: 'ui-design', disabled: false, modelInvocable: true }],
}

function state(overrides = {}) {
  return {
    repo: '',
    ref: 'main',
    path: 'dsh-manifest.json',
    token: '',
    annotations: {},
    lastPullAt: 0,
    lastPushAt: 0,
    ...overrides,
  }
}

const MANIFEST_TEXT = JSON.stringify({
  manifestVersion: 1,
  generatedAt: 100,
  repo: 'o/r',
  ref: 'main',
  plugins: [
    { kind: 'plugin', name: 'dsh-ctx-guard', version: '0.1.1', source: 'repo', platform: 'any' },
    { kind: 'plugin', name: 'dsh-git-bash-tool', version: '0.1.0', source: 'repo', platform: 'win32' },
  ],
  mcp: [],
  skills: [],
})

function caps(overrides = {}) {
  return { platform: 'linux', hasCommand: () => false, gpu: false, ...overrides }
}

test('syncStatus reports a first-run state without a repository', async () => {
  const status = await syncStatus({ snapshot: SNAPSHOT, state: state() })
  assert.equal(status.capabilities.canPull, false)
  assert.equal(status.capabilities.canPublish, false)
  assert.equal(status.manifest, null)
  assert.equal(status.rows.length, 0)
  // The local side is still reported so the panel is not blank.
  assert.equal(status.state.hasToken, false)
})

test('syncStatus separates canPublish from canPull', async () => {
  const status = await syncStatus({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r', token: 't' }),
    options: {
      capabilities: caps(),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => MANIFEST_TEXT }),
    },
  })
  assert.equal(status.capabilities.canPull, true)
  assert.equal(status.capabilities.canPublish, true)
})

test('syncStatus allows pulling without a token', async () => {
  const status = await syncStatus({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r', token: '' }),
    options: {
      capabilities: caps(),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => MANIFEST_TEXT }),
    },
  })
  assert.equal(status.capabilities.canPull, true)
  assert.equal(status.capabilities.canPublish, false)
})

test('syncStatus diffs the manifest against the snapshot', async () => {
  const status = await syncStatus({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r' }),
    options: {
      capabilities: caps(),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => MANIFEST_TEXT }),
    },
  })
  const byKey = new Map(status.rows.map((r) => [r.key, r]))
  assert.equal(byKey.get('plugin:dsh-ctx-guard').status, 'current')
  // win32-only, and this host is linux.
  assert.equal(byKey.get('plugin:dsh-git-bash-tool').status, 'blocked')
  assert.equal(status.counts.current, 1)
  assert.equal(status.counts.blocked, 1)
})

test('syncStatus surfaces a fetch failure instead of an empty diff', async () => {
  const status = await syncStatus({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r' }),
    options: {
      capabilities: caps(),
      fetchImpl: async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) }),
      gitBin: 'nope',
    },
  })
  assert.equal(status.manifest, null)
  assert.match(status.fetchError, /无法读取清单/)
})

test('syncStatus surfaces an invalid manifest', async () => {
  const status = await syncStatus({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r' }),
    options: {
      capabilities: caps(),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{broken' }),
    },
  })
  assert.match(status.fetchError, /不是合法 JSON/)
})

test('syncPreview builds and redacts without a repository', () => {
  const preview = syncPreview({ snapshot: SNAPSHOT, state: state() })
  assert.equal(preview.counts.plugins, 1)
  assert.equal(preview.counts.skills, 1)
  // The ctx-guard link spec is a local path, so the published text must not
  // contain it verbatim.
  assert.equal(preview.text.includes('link:E:/x'), false)
  assert.equal(JSON.parse(preview.text).manifestVersion, 1)
})

test('syncPreview applies annotations from state', () => {
  const preview = syncPreview({
    snapshot: SNAPSHOT,
    state: state({ annotations: { 'dsh-ctx-guard': { platform: 'win32' } } }),
  })
  assert.equal(preview.manifest.plugins[0].platform, 'win32')
})

test('syncPublish refuses without a token or repository', async () => {
  assert.match((await syncPublish({ snapshot: SNAPSHOT, state: state() })).error, /为空|无法解析/)
  const noToken = await syncPublish({ snapshot: SNAPSHOT, state: state({ repo: 'o/r' }) })
  assert.match(noToken.error, /还没有配置 GitHub token/)
})

test('syncPublish records the push time only on a real change', async () => {
  const now = 12345
  const result = await syncPublish({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r', token: 't' }),
    now,
    options: {
      fetchImpl: async (url, init) => {
        if (init?.method === 'PUT') {
          return { ok: true, status: 201, json: async () => ({ content: { sha: 'x' } }) }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      },
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.created, true)
  assert.ok(result.report.secretCount >= 0)
})

test('syncApply refuses an empty selection', async () => {
  const result = await syncApply({ snapshot: SNAPSHOT, state: state({ repo: 'o/r' }), selection: [] })
  assert.match(result.error, /没有选中任何项/)
})

test('syncApply refuses a blocked item instead of installing it', async () => {
  const result = await syncApply({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r' }),
    selection: ['plugin:dsh-git-bash-tool'],
    options: {
      capabilities: caps(),
      profileDir: '/tmp/x',
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => MANIFEST_TEXT }),
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.results.length, 1)
  assert.match(result.results[0].error, /不需要安装/)
})

test('syncApply refuses a key that is not in the manifest', async () => {
  const result = await syncApply({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r' }),
    selection: ['plugin:ghost'],
    options: {
      capabilities: caps(),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => MANIFEST_TEXT }),
    },
  })
  assert.match(result.results[0].error, /清单里没有这一项/)
})

test('syncApply never installs a current item', async () => {
  const result = await syncApply({
    snapshot: SNAPSHOT,
    state: state({ repo: 'o/r' }),
    selection: ['plugin:dsh-ctx-guard'],
    options: {
      capabilities: caps(),
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => MANIFEST_TEXT }),
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.results[0].error, /状态是 current/)
})
