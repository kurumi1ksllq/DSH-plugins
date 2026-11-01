// Vault store facade: one object binding a directory to a loaded master key.
// Both the HTTP API and the `credential` tool use this; only `reveal` returns
// plaintext, and only the tool path calls it.

import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, openSync, renameSync, writeFileSync, fchmodSync, closeSync } from 'node:fs'
import {
  KINDS,
  isValidName,
  loadOrCreateMasterKey,
  maskSecret,
  masterKeyPath,
  openSecret,
  readVault,
  sealSecret,
  vaultFilePath,
  writeVault,
} from './store.js'

const MASTER_KEY_BYTES = 32

/** Write a file with mode 0600 via an exclusive fd. */
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
 * Create a store over `dir`. The master key is loaded once; `rotateKey`
 * replaces it in place.
 */
export function createVaultStore(dir) {
  mkdirSync(dir, { recursive: true })
  let key = loadOrCreateMasterKey(dir).key

  function entry(name) {
    const vault = readVault(dir)
    const found = vault.entries[name]
    return found === undefined ? null : { name, ...found }
  }

  return {
    dir,

    /** List entries without returning secret material. */
    list() {
      const vault = readVault(dir)
      return Object.entries(vault.entries)
        .map(([name, value]) => ({
          name,
          kind: value.kind ?? 'other',
          hasSecret: typeof value.secret === 'string' && value.secret.length > 0,
          preview: value.secret ? maskSecret(openSecret(key, value.secret)) : null,
          username: value.username ?? null,
          url: value.url ?? null,
          note: value.note ?? null,
          createdAt: value.createdAt ?? null,
          updatedAt: value.updatedAt ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    /** One masked entry or null. */
    get(name) {
      const found = entry(name)
      if (found === null) return null
      const { secret, ...rest } = found
      return {
        ...rest,
        hasSecret: typeof secret === 'string' && secret.length > 0,
        preview: secret ? maskSecret(openSecret(key, secret)) : null,
      }
    },

    /** Create or overwrite one credential. */
    set(name, { kind = 'other', secret, username = null, url = null, note = null } = {}) {
      if (!isValidName(name)) throw new Error(`invalid credential name: ${JSON.stringify(name)}`)
      if (!KINDS.includes(kind)) throw new Error(`invalid kind "${kind}", expected one of ${KINDS.join(', ')}`)
      if (typeof secret !== 'string' || secret.length === 0) throw new Error('secret must be a non-empty string')
      const vault = readVault(dir)
      const now = new Date().toISOString()
      const previous = vault.entries[name]
      vault.entries[name] = {
        kind,
        secret: sealSecret(key, secret),
        username: username || null,
        url: url || null,
        note: note || null,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      }
      writeVault(dir, vault)
      return { name, updated: previous !== undefined }
    },

    /** Delete one credential; returns whether it existed. */
    delete(name) {
      const vault = readVault(dir)
      if (vault.entries[name] === undefined) return false
      delete vault.entries[name]
      writeVault(dir, vault)
      return true
    },

    /**
     * The only path that produces plaintext. The `credential` tool calls this;
     * the HTTP API must not.
     */
    reveal(name) {
      const found = entry(name)
      if (found === null) return null
      return {
        name,
        kind: found.kind ?? 'other',
        username: found.username ?? null,
        url: found.url ?? null,
        note: found.note ?? null,
        secret: openSecret(key, found.secret),
      }
    },

    /** Rotate the master key: re-seal every entry, replace master.key. */
    rotateKey() {
      const vault = readVault(dir)
      const fresh = randomBytes(MASTER_KEY_BYTES)
      // Re-seal with the NEW key (decrypting with the old one) before anything
      // is swapped, so a crash between the two writes leaves a consistent
      // world: either the old key + old vault, or the new key + new vault.
      for (const [name, value] of Object.entries(vault.entries)) {
        if (typeof value.secret === 'string') vault.entries[name].secret = sealSecret(fresh, openSecret(key, value.secret))
      }
      copyFileSync(masterKeyPath(dir), `${masterKeyPath(dir)}.bak`)
      writePrivateFileSync(`${masterKeyPath(dir)}.new`, fresh)
      renameSync(`${masterKeyPath(dir)}.new`, masterKeyPath(dir))
      writeVault(dir, vault)
      key = fresh
      return Object.keys(vault.entries).length
    },
  }
}
