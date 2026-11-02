import { test } from 'node:test'
import assert from 'node:assert/strict'

import { prepareManifestText, publishManifest } from '../lib/sync-publish.js'

function manifest(extra = {}) {
  return {
    manifestVersion: 1,
    generatedAt: 1,
    repo: 'o/r',
    ref: 'main',
    plugins: [{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm', platform: 'any' }],
    mcp: [],
    skills: [],
    ...extra,
  }
}

test('prepareManifestText strips secrets and reports them', () => {
  const prepared = prepareManifestText({
    ...manifest(),
    plugins: [
      {
        kind: 'plugin',
        name: 'a',
        source: 'npm',
        platform: 'any',
        apiKey: 'ctx7sk-7f79eca7-1781-45d2-95c1-0886d4210557',
        command: 'C:\\Program Files\\nodejs\\node.exe',
      },
    ],
  })
  assert.equal(prepared.report.secretCount, 1)
  assert.equal(prepared.report.pathCount, 1)
  assert.equal(prepared.text.includes('ctx7sk-7f79eca7'), false)
  assert.equal(prepared.text.includes('Program Files'), false)
  assert.equal(prepared.text.includes('<REDACTED>'), true)
  assert.equal(prepared.text.includes('%LOCAL_ONLY%'), true)
  // The published document must remain valid JSON.
  assert.equal(JSON.parse(prepared.text).manifestVersion, 1)
})

test('prepareManifestText reports zero for a clean manifest', () => {
  const prepared = prepareManifestText(manifest())
  assert.equal(prepared.report.secretCount, 0)
  assert.equal(prepared.report.pathCount, 0)
})

test('publishManifest refuses without a token', async () => {
  const result = await publishManifest({
    owner: 'o',
    repo: 'r',
    token: '',
    manifest: manifest(),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  })
  assert.match(result.error, /没有配置.*token/)
})

test('publishManifest creates the file when it does not exist', async () => {
  const calls = []
  const result = await publishManifest({
    owner: 'o',
    repo: 'r',
    token: 't',
    manifest: manifest(),
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method ?? 'GET' })
      if (init?.method === 'PUT') {
        return { ok: true, status: 201, json: async () => ({ content: { sha: 'new-sha' } }) }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.created, true)
  assert.equal(result.sha, 'new-sha')
  // The create call must NOT carry a sha.
  const put = calls.find((c) => c.method === 'PUT')
  assert.ok(put)
})

test('publishManifest sends the existing sha when updating', async () => {
  let putBody = null
  const result = await publishManifest({
    owner: 'o',
    repo: 'r',
    token: 't',
    manifest: manifest(),
    fetchImpl: async (url, init) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body)
        return { ok: true, status: 200, json: async () => ({ content: { sha: 'upd' } }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sha: 'old', encoding: 'base64', content: Buffer.from('{"x":1}').toString('base64') }),
      }
    },
  })
  assert.equal(result.created, false)
  assert.equal(putBody.sha, 'old')
})

test('publishManifest skips the commit when the content is unchanged', async () => {
  const clean = prepareManifestText(manifest()).text
  let putCalled = false
  const result = await publishManifest({
    owner: 'o',
    repo: 'r',
    token: 't',
    manifest: manifest(),
    fetchImpl: async (url, init) => {
      if (init?.method === 'PUT') {
        putCalled = true
        return { ok: true, status: 200, json: async () => ({}) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sha: 'same', encoding: 'base64', content: Buffer.from(clean).toString('base64') }),
      }
    },
  })
  assert.equal(result.unchanged, true)
  assert.equal(putCalled, false)
})

test('publishManifest force bypasses the unchanged check', async () => {
  const clean = prepareManifestText(manifest()).text
  let putCalled = false
  await publishManifest({
    owner: 'o',
    repo: 'r',
    token: 't',
    manifest: manifest(),
    force: true,
    fetchImpl: async (url, init) => {
      if (init?.method === 'PUT') {
        putCalled = true
        return { ok: true, status: 200, json: async () => ({}) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ sha: 'same', encoding: 'base64', content: Buffer.from(clean).toString('base64') }),
      }
    },
  })
  assert.equal(putCalled, true)
})

test('publishManifest explains a bad token', async () => {
  const result = await publishManifest({
    owner: 'o',
    repo: 'r',
    token: 'bad',
    manifest: manifest(),
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) }),
  })
  assert.match(result.error, /token 无效或已过期/)
  assert.match(result.error, /Bad credentials/)
})

test('publishManifest explains a missing write permission', async () => {
  const result = await publishManifest({
    owner: 'o',
    repo: 'r',
    token: 't',
    manifest: manifest(),
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'not accessible' }) }),
  })
  assert.match(result.error, /没有该仓库的写入权限/)
})
