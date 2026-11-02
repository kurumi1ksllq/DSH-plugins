/**
 * #12 — secret coverage gaps in lib/redact.js.
 *
 * Every assertion here is public behaviour: which keys count as credentials,
 * what a redacted string looks like, and what survives untouched. The negative
 * tests matter as much as the positive ones — a redactor that eats `baseURL` or
 * `DEBUG=true` trains the user to switch it off.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  REDACTED,
  isSecretKey,
  redactForTransport,
  redactString,
  redactValue,
  scanForSecrets,
} from '../lib/redact.js'

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx1y2Z3\nabcdEFGH1234\n-----END RSA PRIVATE KEY-----'
const basic = (user, password) => Buffer.from(`${user}:${password}`).toString('base64')

// ---- key names -------------------------------------------------------------

test('#12 compound credential spellings are recognised as secret keys', () => {
  const keys = ['clientSecretValue', 'refreshTokenValue', 'secretKeyValue', 'privateKeyPem',
    'privateKeyValue', 'accessKey', 'access_key', 'awsSecretAccessKey', 'signingKey', 'signing_key']
  for (const key of keys) assert.equal(isSecretKey(key), true, key)
})

test('#12 well-known credential names are recognised as secret keys', () => {
  const keys = ['authToken', 'apiToken', 'ghToken', 'github_token', 'oauth_token',
    'session_token', 'dbPassword', 'db_password', 'passphrase', 'mnemonic', 'cookie',
    'bearer', 'jwt', 'x-api-key']
  for (const key of keys) assert.equal(isSecretKey(key), true, key)
})

test('#12 indirection keys are references to a secret, never the secret', () => {
  const keys = ['privateKeyPath', 'privateKeyFile', 'privateKeyName', 'privateKeyEnv',
    'clientSecretEnv', 'refreshTokenFile', 'secretKeyPath', 'accessKeyEnv']
  for (const key of keys) assert.equal(isSecretKey(key), false, key)
})

test('#12 key recognition does not spill onto ordinary config fields', () => {
  // `baseURL` and `author` both end in "auth" once a trailing word is stripped;
  // letting the bare name match them would redact every endpoint in a document.
  const keys = ['serverName', 'baseURL', 'author', 'path', 'session', 'keys',
    'model', 'cwd', 'headers', 'url', 'tokenFile']
  for (const key of keys) assert.equal(isSecretKey(key), false, key)
})

test('#12 redactValue freezes the new spellings but keeps references readable', () => {
  const input = {
    clientSecretValue: 'shh',
    refreshTokenValue: 'shh',
    privateKeyPem: PEM,
    privateKeyPath: '.ssh/id_rsa',
    ghToken: 't',
    dbPassword: 'p',
    passphrase: 'pp',
  }
  const out = redactValue(input)
  assert.equal(out.clientSecretValue, REDACTED)
  assert.equal(out.refreshTokenValue, REDACTED)
  assert.equal(out.privateKeyPem, REDACTED)
  assert.equal(out.ghToken, REDACTED)
  assert.equal(out.dbPassword, REDACTED)
  assert.equal(out.passphrase, REDACTED)
  assert.equal(out.privateKeyPath, '.ssh/id_rsa')
  // Never mutated: the publish path reads the original document.
  assert.equal(input.clientSecretValue, 'shh')
  assert.equal(input.privateKeyPem, PEM)
})

// ---- credential string shapes ---------------------------------------------

test('#12 a multi-line PEM private key is redacted whole', () => {
  const out = redactString(PEM)
  assert.equal(out, REDACTED)
  // The body is the secret; a redacted header alone leaves a usable key.
  assert.doesNotMatch(out, /MIIEowIBAAKCAQEAx1y2Z3/)
  assert.doesNotMatch(out, /abcdEFGH1234/)
})

test('#12 a PEM key embedded in a document takes only itself with it', () => {
  const out = redactForTransport({ note: `key material:\n${PEM}\nend of note` })
  assert.match(out.note, /^key material:\n/)
  assert.match(out.note, /\nend of note$/)
  assert.doesNotMatch(out.note, /MIIEowIBAAKCAQEAx1y2Z3/)
})

test('#12 two PEM keys in one document are both redacted, in place', () => {
  const two = `${PEM}\n---\n${PEM.replace('RSA', 'EC')}`
  assert.equal(redactString(two), `${REDACTED}\n---\n${REDACTED}`)
})

test('#12 an Authorization header carrying a Bearer JWT is redacted', () => {
  assert.equal(redactString(`Authorization: Bearer ${JWT}`), REDACTED)
  // The same header as it appears inside a JSON string.
  assert.equal(redactString(`"Authorization": "Bearer ${JWT}"`), '"Authorization": "<REDACTED>"')
})

test('#12 a lower-case bearer and a bare JWT are redacted', () => {
  assert.equal(redactString(`authorization: bearer ${JWT}`), REDACTED)
  assert.equal(redactString(JWT), REDACTED)
})

test('#12 HTTP Basic credentials are redacted but a realm word is not', () => {
  assert.equal(redactString(`Authorization: Basic ${basic('admin', 'hunter2')}`), REDACTED)
  assert.equal(redactString(`Basic ${basic('svc', 'correct horse')}`), REDACTED)
  // Too little material to be `user:password` — a realm name, not a secret.
  const realm = `Basic ${basic('Basic', 'realm')}`
  assert.equal(redactString(realm), realm)
})

test('#12 other documented token prefixes are redacted', () => {
  assert.equal(redactString('glpat-abcdefghijklmnopqrst'), REDACTED)
  assert.equal(redactString('xoxb-1234567890-abcdefghij'), REDACTED)
})

test('#12 ordinary strings and credential *names* stay readable', () => {
  const texts = ['dsh-manager', 'main', 'context7', 'Authorized by admin; keywords: a,b',
    'build:release is the tag', 'PRIVATE_KEY', 'signing_key', 'mnemonic']
  for (const text of texts) assert.equal(redactString(text), text, text)
})

// ---- env blocks ------------------------------------------------------------

test('#12 an env block keeps benign values readable', () => {
  const benign = {
    DEBUG: 'true',
    PORT: '8080',
    RELATIVE: './bin/x',
    CMD: 'node',
    MODE: 'production',
    ENDPOINT: 'https://example.com/v1',
  }
  assert.deepEqual(redactValue({ env: benign }).env, benign)
})

test('#12 short and unusual env secrets no longer slip through', () => {
  const out = redactValue({
    env: {
      PASSWORD: 's3cr3tP@ss!',
      DSN: 'user:p%40ss@db',
      DIGEST: '0123456789abcdef',
    },
  })
  assert.equal(out.env.PASSWORD, REDACTED)
  assert.equal(out.env.DSN, REDACTED)
  assert.equal(out.env.DIGEST, REDACTED)
})

test('#12 a short secret nested deep inside an env block is redacted', () => {
  const out = redactValue({ env: { outer: { inner: { TOKEN: 'abcd', PW: 'p@ss!' } } } })
  assert.equal(out.env.outer.inner.TOKEN, REDACTED)
  assert.equal(out.env.outer.inner.PW, REDACTED)
})

test('#12 env blocks spelled envVars / environment_variables are scanned too', () => {
  for (const blockName of ['envVars', 'environment_variables', 'env_values', 'environment']) {
    const out = redactValue({ [blockName]: { GH: 'ghp_abcdefghijklmnopqrstuv12345' } })
    assert.equal(out[blockName].GH, REDACTED, blockName)
  }
})

test('#12 a Path- or Env-keyed value is never frozen, even inside an env block', () => {
  const out = redactValue({
    env: { PRIVATE_KEY_PATH: '.ssh/id_rsa', CA_FILE: 'ca.pem', BIN_DIR: 'node/bin' },
    apiKeyEnv: 'NEWAPI_API_KEY',
  })
  assert.equal(out.env.PRIVATE_KEY_PATH, '.ssh/id_rsa')
  assert.equal(out.env.CA_FILE, 'ca.pem')
  assert.equal(out.env.BIN_DIR, 'node/bin')
  assert.equal(out.apiKeyEnv, 'NEWAPI_API_KEY')
})

// ---- report stays consistent with what is removed --------------------------

test('#12 scanForSecrets reports every key and shape redaction removes', () => {
  const doc = {
    clientSecretValue: 'shh',
    headers: { Authorization: `Bearer ${JWT}` },
    hook: PEM,
    env: { SHORT: 's3cr3tP@ss!', DEBUG: 'true' },
    baseURL: 'https://example.com/v1',
    apiKeyEnv: 'NEWAPI_API_KEY',
  }
  const redacted = redactForTransport(doc)
  const found = scanForSecrets(doc)
  for (const { path } of found) {
    // A reported path must really have been changed: a report over a document
    // redaction leaves alone (or the reverse) is a lie shown before publishing.
    const value = path.split('.').reduce((node, part) => node?.[part], redacted)
    assert.notEqual(value, path.split('.').reduce((node, part) => node?.[part], doc), path)
  }
  // The clean fields are not reported and are not touched.
  assert.equal(found.some((item) => item.path === 'baseURL'), false)
  assert.equal(redacted.baseURL, 'https://example.com/v1')
  assert.equal(redacted.apiKeyEnv, 'NEWAPI_API_KEY')
  assert.equal(scanForSecrets({ env: { DEBUG: 'true', PORT: '8080', RELATIVE: './bin/x', CMD: 'node' } }).length, 0)
})

test('#12 a preview never contains the whole secret', () => {
  for (const item of scanForSecrets({ clientSecretValue: 'abcdef123456789', jwt: JWT })) {
    assert.equal(item.preview.includes('123456789'), false)
    assert.equal(item.preview.includes(JWT), false)
  }
})

// ---- the publish path ------------------------------------------------------

test('#12 a full document is redacted from top to bottom without mutating it', () => {
  const doc = {
    mcp: [{ serverName: 'context7', privateKeyPem: PEM, privateKeyPath: '.ssh/id_rsa' }],
    branch: 'main',
    headers: { Authorization: `Bearer ${JWT}`, Accept: 'application/json' },
    env: { DEBUG: 'true', SHORT: 's3cr3tP@ss!' },
  }
  const out = redactForTransport(doc)
  assert.equal(out.mcp[0].privateKeyPem, REDACTED)
  // A relative reference is left alone entirely — it names no host fact.
  assert.equal(out.mcp[0].privateKeyPath, '.ssh/id_rsa')
  assert.equal(out.headers.Authorization, REDACTED)
  assert.equal(out.headers.Accept, 'application/json')
  assert.equal(out.branch, 'main')
  assert.equal(out.env.DEBUG, 'true')
  assert.equal(out.env.SHORT, REDACTED)
  assert.doesNotMatch(JSON.stringify(out), /MIIEowIBAAKCAQEAx1y2Z3|SflKxwRJSMeKKF2QT4|s3cr3tP@ss/)
  // The original document still holds everything: publish reads it and the
  // report is produced from it.
  assert.equal(doc.mcp[0].privateKeyPem, PEM)
  assert.equal(doc.env.SHORT, 's3cr3tP@ss!')
  assert.equal(doc.mcp[0].serverName, 'context7')
})
