import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  REDACTED,
  isSecretKey,
  redactForTransport,
  redactPaths,
  redactString,
  redactValue,
  scanForPaths,
  scanForSecrets,
} from '../lib/redact.js'

test('redacts the context7 key shape that actually leaked locally', () => {
  const text = 'ctx7sk-7f79eca7-1781-45d2-95c1-0886d4210557'
  assert.equal(redactString(text), REDACTED)
})

test('redacts common credential shapes', () => {
  assert.equal(redactString('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), REDACTED)
  assert.equal(redactString('sk-a2a-8VQCBeyEZfRYMhl6R5XFYFvBEDB673Kr'), REDACTED)
  assert.equal(redactString('AKIAIOSFODNN7EXAMPLE'), REDACTED)
  assert.equal(redactString('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ01234'), REDACTED)
})

test('leaves ordinary strings untouched', () => {
  assert.equal(redactString('dsh-manager'), 'dsh-manager')
  assert.equal(redactString('main'), 'main')
  assert.equal(redactString(''), '')
})

test('isSecretKey recognises credential names but not env indirections', () => {
  assert.equal(isSecretKey('apiKey'), true)
  assert.equal(isSecretKey('api_key'), true)
  assert.equal(isSecretKey('token'), true)
  assert.equal(isSecretKey('password'), true)
  assert.equal(isSecretKey('apiKeyEnv'), false)
  assert.equal(isSecretKey('NEWAPI_API_KEY'), false)
  assert.equal(isSecretKey('serverName'), false)
})

test('redactValue replaces keyed secrets wholesale', () => {
  const input = { serverName: 'x', apiKey: 'abc', nested: { token: 't' } }
  const out = redactValue(input)
  assert.equal(out.apiKey, REDACTED)
  assert.equal(out.nested.token, REDACTED)
  assert.equal(out.serverName, 'x')
  // The input must not be mutated.
  assert.equal(input.apiKey, 'abc')
})

test('redactValue keeps env-var indirections intact', () => {
  const out = redactValue({ apiKeyEnv: 'NEWAPI_API_KEY', apiKey: 'literal' })
  assert.equal(out.apiKeyEnv, 'NEWAPI_API_KEY')
  assert.equal(out.apiKey, REDACTED)
})

test('redactPaths replaces Windows and POSIX absolute paths', () => {
  assert.equal(redactPaths("command: 'C:\\Program Files\\nodejs\\node.exe'"), "command: '%LOCAL_ONLY%'")
  assert.equal(redactPaths('cwd: D:/Documents/ws'), 'cwd: %LOCAL_ONLY%')
  assert.equal(redactPaths('run /usr/local/bin/officecli'), 'run %LOCAL_ONLY%')
})

test('redactPaths preserves URLs', () => {
  assert.equal(redactPaths('baseURL: http://38.76.221.67:3000/v1'), 'baseURL: http://38.76.221.67:3000/v1')
  assert.equal(redactPaths('see https://example.com/a/b'), 'see https://example.com/a/b')
})

test('redactForTransport applies both passes', () => {
  const input = {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    args: ['--api-key', 'ctx7sk-7f79eca7-1781-45d2-95c1-0886d4210557'],
    baseURL: 'http://1.2.3.4:3000/v1',
  }
  const out = redactForTransport(input)
  assert.equal(out.command, '%LOCAL_ONLY%')
  assert.equal(out.args[1], REDACTED)
  assert.equal(out.baseURL, 'http://1.2.3.4:3000/v1')
})

test('scanForSecrets reports paths without leaking values', () => {
  const found = scanForSecrets({ a: { apiKey: 'sk-live-abcdefghijklmnop' }, b: 'ctx7sk-abcdefghijklmn' })
  assert.equal(found.length, 2)
  assert.equal(found[0].path, 'a.apiKey')
  assert.equal(found[0].kind, 'keyed')
  assert.equal(found[1].kind, 'literal')
  // The preview must never contain the full secret.
  for (const item of found) {
    assert.equal(item.preview.includes('abcdefghijklmnop'), false)
  }
})

test('scanForSecrets finds nothing in a clean document', () => {
  assert.deepEqual(scanForSecrets({ repo: 'o/r', ref: 'main' }), [])
})

test('scanForPaths counts strings containing absolute paths', () => {
  const found = scanForPaths({ a: 'C:\\x\\y.exe', b: 'http://ok', c: 'plain' })
  assert.equal(found.length, 1)
  assert.equal(found[0].path, 'a')
})

test('redactPaths shields URLs before the whole-string path branch', () => {
  // WHOLE_WIN_PATH allows spaces, so without the shield `C:\x https://y`
  // would be swallowed whole and the URL (and its secret) would vanish.
  const out = redactPaths('C:\\x https://example.com/sk-abc123')
  assert.match(out, /%LOCAL_ONLY%/)
  assert.match(out, /https:\/\/example\.com\//)
  // A plain path with spaces is still caught by the whole-string branch.
  assert.equal(redactPaths('C:\\Program Files\\nodejs\\node.exe'), '%LOCAL_ONLY%')
})

test('redactForTransport redacts a secret inside an URL that follows a path', () => {
  const key = 'sk-a2a-8VQCBeyEZfRYMhl6R5XFYFvBEDB673Kr'
  const out = redactForTransport(`C:\\x https://example.com/${key}`)
  assert.match(out, /%LOCAL_ONLY%/)
  assert.match(out, /https:\/\/example\.com\//)
  assert.doesNotMatch(out, /8VQCBeyEZfRYMhl6R5XFYFvBEDB673Kr/)
})
