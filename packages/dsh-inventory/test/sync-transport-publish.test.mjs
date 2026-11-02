import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { giteeContentsUrl, lookupFile, publishHttp, publishManifest } from '../lib/sync-publish.js'
import { syncConfigure, syncPublish, syncStatus } from '../lib/sync-service.js'
import { STATE_DEFAULTS } from '../lib/sync-state.js'

const MANIFEST = { manifestVersion: 1, repo: 'x/y', ref: 'main', plugins: [], mcp: [], skills: [] }
const SNAP = { plugins: [], mcp: [], skills: [], counts: { plugins: 0, mcp: 0, skills: 0 }, warnings: [] }

test('giteeContentsUrl puts the token in the query and keeps the path', () => {
  const url = giteeContentsUrl('o', 'r', 'deep/dir/dsh-manifest.json', 'tok')
  assert.match(url, /^https:\/\/gitee\.com\/api\/v5\/repos\/o\/r\/contents\/deep\/dir\/dsh-manifest\.json\?access_token=tok$/)
})

test('publishManifest PUTs to gitee v5 with the sha of the existing file', async () => {
  let put = null
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sha: 'abc', content: Buffer.from('{}').toString('base64'), encoding: 'base64' }),
      }
    }
    put = { url: String(url), body: JSON.parse(init.body) }
    return { ok: true, status: 200, json: async () => ({ content: {} }) }
  }
  const result = await publishManifest({
    owner: 'o', repo: 'r', path: 'dsh-manifest.json', ref: 'main', token: 't',
    manifest: MANIFEST, host: 'gitee.com', fetchImpl, timeoutMs: 100,
  })
  assert.equal(result.ok, true)
  assert.match(put.url, /^https:\/\/gitee\.com\/api\/v5\/repos\/o\/r\/contents\/dsh-manifest\.json\?access_token=t$/)
  assert.equal(put.body.sha, 'abc')
  assert.match(put.body.branch, /main/)
})

test('publishHttp PUTs the manifest text with a Bearer header', async () => {
  let put = null
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'PUT') {
      put = { url: String(url), headers: init.headers, body: init.body }
      return { ok: true, status: 200 }
    }
    throw new Error('unexpected')
  }
  const result = await publishHttp({
    url: 'http://srv/manifests/dsh-manifest.json', token: 't', manifest: MANIFEST, fetchImpl, timeoutMs: 100,
  })
  assert.equal(result.ok, true)
  assert.equal(put.url, 'http://srv/manifests/dsh-manifest.json')
  assert.equal(put.headers.Authorization, 'Bearer t')
  assert.deepEqual(JSON.parse(put.body), MANIFEST)
})

test('lookupFile explains a bad token on gitee (401)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 })
  const result = await lookupFile({
    owner: 'o', repo: 'r', path: 'dsh-manifest.json', ref: 'main', token: 'bad', host: 'gitee.com', fetchImpl, timeoutMs: 100,
  })
  assert.match(result.error, /token 无效或已过期/)
})

function scratchStateDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-sync-svc-'))
}

test('resolveTransport-level behaviour: syncStatus routes http mode through the direct URL', async () => {
  const env = { DSH_HOME: scratchStateDir() }
  try {
    syncConfigure({ mode: 'http', repo: 'http://srv/manifests/dsh-manifest.json', token: 't' }, )
    const status = await syncStatus({
      snapshot: SNAP,
      state: { ...STATE_DEFAULTS, mode: 'http', repo: 'http://srv/manifests/dsh-manifest.json', token: 't' },
      options: {
        fetchImpl: async (url) => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ manifestVersion: 1, generatedAt: 0, repo: 'http://srv/manifests/dsh-manifest.json', ref: 'main', plugins: [], mcp: [], skills: [] }),
        }),
        timeoutMs: 100,
      },
    })
    assert.equal(status.via, 'http')
    assert.equal(status.manifest.repo, 'http://srv/manifests/dsh-manifest.json')
    assert.equal(status.capabilities.canPull, true)
  } finally {
    rmSync(env.DSH_HOME, { recursive: true, force: true })
  }
})

test('syncPublish refuses an http mode repo value that is not a full URL', async () => {
  const result = await syncPublish({
    snapshot: SNAP,
    state: { ...STATE_DEFAULTS, mode: 'http', repo: 'kurumi/dsh-manager', token: 't' },
    options: { fetchImpl: async () => ({}), timeoutMs: 50 },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /直链/)
})
