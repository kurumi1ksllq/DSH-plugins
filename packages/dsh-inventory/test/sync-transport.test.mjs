import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hostProfile, parseRepoUrl, rawUrl, apiUrl, fetchHttpText, fetchManifestText } from '../lib/sync-remote.js'

const MANIFEST = { manifestVersion: 1, plugins: [], mcp: [], skills: [] }

test('gitee profile builds gitee URLs (raw under the main domain, api v5)', () => {
  const parsed = parseRepoUrl('o/r', { host: 'gitee.com' })
  assert.equal(parsed.host, 'gitee.com')
  assert.match(rawUrl(parsed, { ref: 'main', path: 'dsh-manifest.json' }), /^https:\/\/gitee\.com\/o\/r\/raw\/main\/dsh-manifest\.json$/)
  assert.match(apiUrl(parsed, { ref: 'main', path: 'dsh-manifest.json' }), /^https:\/\/gitee\.com\/api\/v5\/repos\/o\/r\/contents\/dsh-manifest\.json\?ref=main$/)
})

test('parseRepoUrl keeps github shapes unchanged by default', () => {
  const parsed = parseRepoUrl('https://github.com/o/r.git')
  assert.equal(parsed.host, 'github.com')
  assert.deepEqual([parsed.owner, parsed.repo], ['o', 'r'])
})

test('parseRepoUrl accepts a gitee https URL and rejects a github one in gitee mode', () => {
  const ok = parseRepoUrl('https://gitee.com/o/r', { host: 'gitee.com' })
  assert.deepEqual([ok.owner, ok.repo, ok.host], ['o', 'r', 'gitee.com'])
  const bad = parseRepoUrl('https://github.com/o/r', { host: 'gitee.com' })
  assert.match(bad.error, /只支持 gitee\.com/)
})

test('fetchManifestText reads gitee raw first, without any GitHub request', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    return { ok: true, status: 200, text: async () => JSON.stringify(MANIFEST) }
  }
  const parsed = parseRepoUrl('o/r', { host: 'gitee.com' })
  const result = await fetchManifestText(parsed, { fetchImpl, timeoutMs: 100 })
  assert.equal(result.via, 'raw')
  assert.equal(seen.some((u) => u.includes('github.com')), false)
  assert.match(seen[0], /^https:\/\/gitee\.com\/o\/r\/raw\/main\//)
})

test('fetchManifestText retries gitee contents API when raw 404s', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    if (seen.length === 1) return { ok: false, status: 404 }
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: Buffer.from(JSON.stringify(MANIFEST)).toString('base64'), encoding: 'base64' }),
    }
  }
  const parsed = parseRepoUrl('o/r', { host: 'gitee.com' })
  const result = await fetchManifestText(parsed, { fetchImpl, timeoutMs: 100, token: 't' })
  assert.equal(result.via, 'api')
  // seen[1] is the default-branch probe (repo API); the contents call carries the token in the query.
  const contents = seen.find((u) => u.includes('/contents/'))
  assert.match(contents, /access_token=t/)
})

test('fetchHttpText GET returns the manifest and flags a 404 as notFound', async () => {
  const fetchImpl = async (url, init = {}) => {
    assert.equal(String(url), 'http://srv/manifests/dsh-manifest.json')
    if ((init.method ?? 'GET') === 'GET') {
      if (init.headers?.Authorization !== 'Bearer t') return { status: 401, ok: false }
      return { ok: true, status: 200, text: async () => JSON.stringify(MANIFEST) }
    }
    throw new Error('unexpected method')
  }
  const ok = await fetchHttpText('http://srv/manifests/dsh-manifest.json', { token: 't', fetchImpl, timeoutMs: 100 })
  assert.equal(ok.text, JSON.stringify(MANIFEST))
  const missing = await fetchHttpText('http://srv/x.json', { token: 't', fetchImpl: async () => ({ ok: false, status: 404 }), timeoutMs: 100 })
  assert.equal(missing.notFound, true)
})

test('fetchHttpText rejects a non-http url', async () => {
  const result = await fetchHttpText('kurumi/dsh-manager', { fetchImpl: async () => ({}), timeoutMs: 10 })
  assert.match(result.error, /直链/)
})

test('hostProfile falls back to github for unknown hosts', () => {
  assert.equal(hostProfile('example.com'), hostProfile('github.com'))
})
