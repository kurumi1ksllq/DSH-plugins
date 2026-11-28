// #289 F1:畸形 iv/tag 必须折叠成与解密失败同一个错误(单一错误、无 oracle)。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sealEnvelope, openEnvelope } from '../lib/envelope.mjs'

const PASS = 'correct horse battery'
const PAYLOAD = { entries: [{ name: 'github token', secret: 'ghp_topsecret' }] }

/** 同一个不可区分的错误:文案一致,且不是 TypeError 之类的原始错误。 */
function unifiedFailure(error) {
  return error.name === 'EnvelopeError' && error.code === 'bad-passphrase-or-tampered' && error.message === 'decryption failed'
}

test('#289 畸形 iv、畸形 tag、错密码返回同一种错误形态', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  const cases = {
    'wrong passphrase': () => openEnvelope('wrong passphrase 12', envelope),
    'iv too short': () => openEnvelope(PASS, { ...envelope, cipher: { ...envelope.cipher, iv: 'abc' } }),
    'iv not base64-decodable to a buffer': () => openEnvelope(PASS, { ...envelope, cipher: { ...envelope.cipher, iv: '!!!' } }),
    'iv missing': () => openEnvelope(PASS, { ...envelope, cipher: { ...envelope.cipher, iv: undefined } }),
    'tag too short': () => openEnvelope(PASS, { ...envelope, cipher: { ...envelope.cipher, tag: 'zzzz' } }),
    'tag missing': () => openEnvelope(PASS, { ...envelope, cipher: { ...envelope.cipher, tag: undefined } }),
  }
  for (const [label, run] of Object.entries(cases)) {
    assert.throws(run, unifiedFailure, label)
  }
})

test('#289 畸形 iv/tag 不再抛原始 TypeError', () => {
  const envelope = sealEnvelope(PASS, PAYLOAD)
  for (const cipher of [{ ...envelope.cipher, tag: 'zzzz' }, { ...envelope.cipher, iv: 'abc' }]) {
    try {
      openEnvelope(PASS, { ...envelope, cipher })
      assert.fail('expected a failure')
    } catch (error) {
      assert.notEqual(error.name, 'TypeError')
      assert.notEqual(error.code, 'ERR_CRYPTO_INVALID_AUTH_TAG')
    }
  }
})

test('#289 正常往返不受影响', () => {
  assert.deepEqual(openEnvelope(PASS, sealEnvelope(PASS, PAYLOAD)), PAYLOAD)
})
