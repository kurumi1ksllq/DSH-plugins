import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apiUrl, fetchManifestText, parseRepoUrl, rawUrl, repoSlug } from '../lib/sync-remote.js'

test('parses the bare owner/repo form people actually type', () => {
  assert.deepEqual(parseRepoUrl('kurumi1ksllq/dsh-manager'), {
    owner: 'kurumi1ksllq',
    repo: 'dsh-manager',
    ref: null,
    path: null,
  })
})

test('parses an https URL and strips .git', () => {
  const parsed = parseRepoUrl('https://github.com/kurumi1ksllq/dsh-manager.git')
  assert.equal(parsed.owner, 'kurumi1ksllq')
  assert.equal(parsed.repo, 'dsh-manager')
})

test('parses a git+https URL', () => {
  const parsed = parseRepoUrl('git+https://github.com/o/r')
  assert.equal(parsed.owner, 'o')
  assert.equal(parsed.repo, 'r')
})

test('parses an scp-style ssh URL', () => {
  const parsed = parseRepoUrl('git@github.com:o/r.git')
  assert.equal(parsed.owner, 'o')
  assert.equal(parsed.repo, 'r')
})

test('parses a /tree/<ref>/<path> suffix', () => {
  const parsed = parseRepoUrl('https://github.com/o/r/tree/main/sub/dsh-manifest.json')
  assert.equal(parsed.ref, 'main')
  assert.equal(parsed.path, 'sub/dsh-manifest.json')
})

test('parses a /blob/<ref>/<path> suffix', () => {
  const parsed = parseRepoUrl('https://github.com/o/r/blob/dev/cfg/m.json')
  assert.equal(parsed.ref, 'dev')
  assert.equal(parsed.path, 'cfg/m.json')
})

test('rejects empty and non-GitHub inputs', () => {
  assert.match(parseRepoUrl('').error, /为空/)
  assert.match(parseRepoUrl('https://gitlab.com/o/r').error, /只支持 github.com/)
  assert.match(parseRepoUrl('not a url').error, /无法解析/)
  assert.match(parseRepoUrl('https://github.com/onlyone').error, /owner\/repo/)
})

test('repoSlug renders owner/repo and blanks on error', () => {
  assert.equal(repoSlug({ owner: 'o', repo: 'r' }), 'o/r')
  assert.equal(repoSlug({ error: 'x' }), '')
  assert.equal(repoSlug(null), '')
})

test('rawUrl prefers the parsed ref and path over the defaults', () => {
  assert.equal(
    rawUrl({ owner: 'o', repo: 'r', ref: null, path: null }, { ref: 'main' }),
    'https://raw.githubusercontent.com/o/r/main/dsh-manifest.json',
  )
  assert.equal(
    rawUrl({ owner: 'o', repo: 'r', ref: 'dev', path: 'cfg/m.json' }, { ref: 'main' }),
    'https://raw.githubusercontent.com/o/r/dev/cfg/m.json',
  )
})

test('apiUrl encodes the ref', () => {
  assert.equal(
    apiUrl({ owner: 'o', repo: 'r' }, { ref: 'feat/x' }),
    'https://api.github.com/repos/o/r/contents/dsh-manifest.json?ref=feat%2Fx',
  )
})

test('fetchManifestText returns raw content when the first attempt succeeds', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    {
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"a":1}' }),
    },
  )
  assert.equal(result.via, 'raw')
  assert.equal(result.text, '{"a":1}')
})

test('fetchManifestText falls back to the API when raw 404s', async () => {
  let calls = 0
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    {
      fetchImpl: async (url) => {
        calls += 1
        if (calls === 1) return { ok: false, status: 404, text: async () => '' }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            encoding: 'base64',
            content: Buffer.from('{"a":2}', 'utf8').toString('base64'),
          }),
        }
      },
    },
  )
  assert.equal(result.via, 'api')
  assert.equal(result.text, '{"a":2}')
})

test('fetchManifestText reports why every attempt failed', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    {
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => '', json: async () => ({}) }),
      gitBin: 'definitely-not-git',
      timeoutMs: 5000,
    },
  )
  assert.match(result.error, /无法读取清单/)
  assert.match(result.error, /HTTP 403/)
})
