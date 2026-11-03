// Encrypted credential store for dsh-credential-vault.
//
// Layout under `$DSH_HOME/credential-vault/`:
//   master.key  — 32 random bytes, created on first use, mode 0600
//   vault.json  — { version, entries: { [name]: { kind, secret, username?, url?, note?, createdAt, updatedAt } } }
//                 `secret` is base64(nonce ‖ AES-256-GCM ciphertext+tag), key = master.key
//   audit.log   — one JSON line per read, written by audit.js
//
// Plaintext exists only inside the process: the HTTP API never returns secret
// material to the panel (it returns `hasSecret` + a masked preview), and the
// `credential` tool returns the secret only to the session that asked for it.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, fchmodSync, closeSync } from 'node:fs'
import { join } from 'node:path'

export const VAULT_VERSION = 2
export const KINDS = ['password', 'token', 'api-key', 'ssh-key', 'database', 'other']
const MASTER_KEY_BYTES = 32

/**
 * Fold one credential key (a name, alias or service) into a comparable form:
 * lower-cased, with every run of non-alphanumeric characters collapsed to a
 * single `-` and the ends trimmed. Non-ASCII letters survive, so a Chinese name
 * stays usable; only punctuation and whitespace are folded.
 *
 * This is the single normalizer for slugs, aliases and search queries, so
 * `github token`, `github-token` and `GitHub_Token` all compare equal.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The canonical identifier derived from a credential's display name. Deliberately
 * NOT stored: the name is the single source of truth, and the slug is recomputed
 * on every read so it can never drift from it.
 * @param {string} name
 * @returns {string}
 */
export function slugOf(name) {
  return normalizeKey(name)
}

/**
 * Normalize a user-maintained alias list: keep only non-empty strings, trim
 * them, and drop entries that fold to the same key (first spelling wins).
 * @param {unknown} aliases
 * @returns {string[]}
 */
export function normalizeAliases(aliases) {
  if (!Array.isArray(aliases)) return []
  const seen = new Set()
  const result = []
  for (const raw of aliases) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value.length === 0) continue
    const key = normalizeKey(value)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

/** Master key file path. */
export function masterKeyPath(dir) {
  return join(dir, 'master.key')
}

export function vaultFilePath(dir) {
  return join(dir, 'vault.json')
}

/** Validate a credential name: non-empty, printable, no path separators. */
export function isValidName(name) {
  return (
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 128 &&
    !/[\r\n/\\\u0000-\u001f]/.test(name)
  )
}

/** Write a file with mode 0600 via an exclusive fd (chmod before close). */
function writePrivateFileSync(path, data) {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(fd, data)
    fchmodSync(fd, 0o600)
  } finally {
    closeSync(fd)
  }
}

/**
 * Load or create the master key. The key file is 0600.
 * @returns {{ key: Buffer, created: boolean }}
 */
export function loadOrCreateMasterKey(dir) {
  mkdirSync(dir, { recursive: true })
  const keyPath = masterKeyPath(dir)
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath)
    if (key.length !== MASTER_KEY_BYTES) {
      throw new Error(`master key at ${keyPath} is ${key.length} bytes, expected ${MASTER_KEY_BYTES}`)
    }
    return { key, created: false }
  }
  const key = randomBytes(MASTER_KEY_BYTES)
  writePrivateFileSync(keyPath, key)
  return { key, created: true }
}

/** Encrypt one UTF-8 secret under the master key. Returns base64(nonce ‖ ct‖tag). */
export function sealSecret(key, plaintext) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const sealed = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return Buffer.concat([nonce, sealed]).toString('base64')
}

/** Reverse of `sealSecret`; throws when the ciphertext was tampered with. */
export function openSecret(key, sealedBase64) {
  const raw = Buffer.from(String(sealedBase64), 'base64')
  if (raw.length < 12 + 16) throw new Error('sealed secret is truncated')
  const nonce = raw.subarray(0, 12)
  const body = raw.subarray(12, raw.length - 16)
  const tag = raw.subarray(raw.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/** Empty in-memory vault shape. */
export function emptyVault() {
  return { version: VAULT_VERSION, entries: {} }
}

/** Read and parse vault.json; a missing file is an empty vault. */
export function readVault(dir) {
  const file = vaultFilePath(dir)
  if (!existsSync(file)) return emptyVault()
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || parsed.entries === null) {
    throw new Error(`vault file at ${file} has no entries object`)
  }
  return { version: typeof parsed.version === 'number' ? parsed.version : VAULT_VERSION, entries: parsed.entries }
}

/** Write vault.json atomically (temp file + rename) with 0600 permissions. */
export function writeVault(dir, vault) {
  mkdirSync(dir, { recursive: true })
  const file = vaultFilePath(dir)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writePrivateFileSync(tmp, JSON.stringify(vault, null, 2) + '\n')
  renameSync(tmp, file)
}

/**
 * Masked preview safe to show in the panel: first 4 and last 2 characters for
 * long secrets, `***` otherwise. Never returns more than 8 characters.
 */
export function maskSecret(plaintext) {
  const text = String(plaintext ?? '')
  if (text.length <= 8) return '***'
  return `${text.slice(0, 4)}…${text.slice(-2)}`
}

/** Verify a plaintext guess against a stored sealed secret in constant time. */
export function verifySecret(key, sealedBase64, guess) {
  const current = openSecret(key, sealedBase64)
  const a = createHash('sha256').update(current).digest()
  const b = createHash('sha256').update(String(guess ?? '')).digest()
  return timingSafeEqual(a, b)
}
