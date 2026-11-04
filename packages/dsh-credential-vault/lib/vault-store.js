// Vault store facade: one object binding a directory to a loaded master key.
// Both the HTTP API and the `credential` tool use this; only `reveal` returns
// plaintext, and only the tool path calls it.

import { randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, openSync, renameSync, writeFileSync, fchmodSync, closeSync } from 'node:fs'
import {
  KINDS,
  VAULT_VERSION,
  isDangerousKey,
  isValidName,
  loadOrCreateMasterKey,
  maskSecret,
  masterKeyPath,
  normalizeAliases,
  normalizeKey,
  openSecret,
  readVault,
  sealSecret,
  validateMeta,
  slugOf,
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
    // Defence-in-depth only: `readVault` returns prototype-free entries and
    // KEEPS dangerous keys (issue #52 — they are user data), so an own key can
    // be a real entry. This guard exists for a future change that makes
    // `entries` a plain object again.
    if (!Object.hasOwn(vault.entries, name)) return null
    const found = vault.entries[name]
    return found === undefined ? null : { name, ...found }
  }

  /**
   * Refuse to READ a credential whose name is an `Object.prototype` key.
   *
   * Such an entry can only exist because 0.3.0 allowed creating it. It is kept on
   * disk (issue #52 — deleting it silently would destroy user data), but handing
   * its secret to a caller is exactly the "phantom credential" hazard the name
   * guard exists to prevent, so reading fails loudly and names the way out.
   */
  function assertSafeRead(name) {
    if (!isDangerousKey(name)) return
    throw new Error(
      `credential "${name}" has an unsafe name (an Object.prototype property); ` +
        'rename or delete it in the panel before using it',
    )
  }

  /**
   * Reject a write whose name folds to the same slug as a DIFFERENT existing
   * credential. `github token` and `github-token` would otherwise both exist and
   * silently shadow each other in alias/slug lookups, so the store refuses the
   * second one and names the occupant to the caller.
   */
  function assertNoSlugCollision(vault, name) {
    const slug = slugOf(name)
    for (const existing of Object.keys(vault.entries)) {
      if (existing === name) continue
      if (slugOf(existing) === slug) {
        throw new Error(
          `credential name "${name}" collides with the existing credential "${existing}" ` +
            `(both normalize to "${slug}"); rename one of them`,
        )
      }
    }
  }

  return {
    dir,

    /**
     * List entries with a masked preview, without ever returning secret material.
     *
     * One damaged entry (a rotated-away key, a half-written rotate) must not take
     * the whole panel down: its preview degrades to null and it is flagged
     * `corrupt`, while every healthy entry keeps its preview.
     */
    list() {
      const vault = readVault(dir)
      return Object.entries(vault.entries)
        .map(([name, value]) => {
          const hasSecret = typeof value.secret === 'string' && value.secret.length > 0
          let preview = null
          let corrupt = false
          if (hasSecret) {
            try {
              preview = maskSecret(openSecret(key, value.secret))
            } catch {
              corrupt = true
            }
          }
          const unsafeName = isDangerousKey(name)
          return {
            name,
            slug: slugOf(name),
            id: value.id ?? null,
            unsafeName,
            kind: value.kind ?? 'other',
            service: value.service ?? null,
            aliases: normalizeAliases(value.aliases),
            hasSecret,
            preview,
            corrupt,
            username: value.username ?? null,
            url: value.url ?? null,
            note: value.note ?? null,
            createdAt: value.createdAt ?? null,
            updatedAt: value.updatedAt ?? null,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    /**
     * List entries using METADATA ONLY — never decrypts a single value.
     *
     * Callers that do not display a preview (the prompt index, name resolution)
     * must use this: `list()` decrypts every entry to build its preview, so one
     * damaged entry used to break prompt assembly and every lookup in the store.
     */
    listMeta() {
      const vault = readVault(dir)
      return Object.entries(vault.entries)
        .map(([name, value]) => ({
          name,
          slug: slugOf(name),
          id: value.id ?? null,
          unsafeName: isDangerousKey(name),
          kind: value.kind ?? 'other',
          service: value.service ?? null,
          aliases: normalizeAliases(value.aliases),
          hasSecret: typeof value.secret === 'string' && value.secret.length > 0,
          username: value.username ?? null,
          url: value.url ?? null,
          note: value.note ?? null,
          createdAt: value.createdAt ?? null,
          updatedAt: value.updatedAt ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    /**
     * Existence check WITHOUT the unsafe-name read guard: the tool layer needs to
     * tell "a legacy entry with a dangerous name" apart from "a typo", because the
     * former must reach the store's read guard (and its audit trail) while the
     * latter is rejected up front.
     */
    has(name) {
      const vault = readVault(dir)
      return Object.hasOwn(vault.entries, name)
    },

    /** One masked entry or null. */
    get(name) {
      assertSafeRead(name)
      const found = entry(name)
      if (found === null) return null
      const { secret, ...rest } = found
      return {
        ...rest,
        slug: slugOf(name),
        kind: rest.kind ?? 'other',
        service: rest.service ?? null,
        aliases: normalizeAliases(rest.aliases),
        hasSecret: typeof secret === 'string' && secret.length > 0,
        preview: secret ? maskSecret(openSecret(key, secret)) : null,
      }
    },

    /** Create or overwrite one credential. */
    set(name, { kind = 'other', secret, username = null, url = null, note = null, service = null, aliases = [] } = {}) {
      if (!isValidName(name)) throw new Error('invalid credential name')
      if (!KINDS.includes(kind)) throw new Error('invalid kind, expected one of ' + KINDS.join(', '))
      if (typeof secret !== 'string' || secret.length === 0) throw new Error('secret must be a non-empty string')
      const rawMeta = validateMeta({ service, username, url, note, aliases })
      // `set` creates the whole entry, so "not provided" simply means null here.
      const meta = {
        service: rawMeta.service ?? null,
        aliases: rawMeta.aliases ?? [],
        username: rawMeta.username ?? null,
        url: rawMeta.url ?? null,
        note: rawMeta.note ?? null,
      }
      const vault = readVault(dir)
      assertNoSlugCollision(vault, name)
      vault.version = VAULT_VERSION
      const now = new Date().toISOString()
      const previous = vault.entries[name]
      vault.entries[name] = {
        id: previous?.id ?? randomUUID(),
        kind,
        secret: sealSecret(key, secret),
        username: meta.username,
        url: meta.url,
        note: meta.note,
        service: meta.service,
        aliases: meta.aliases,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      }
      writeVault(dir, vault)
      return { name, updated: previous !== undefined }
    },

    /**
     * Update the metadata of an EXISTING credential without touching its secret.
     *
     * Editing a stored credential usually means changing where it is used, not
     * rotating it. The panel's editor submits an empty secret for exactly that
     * case, so this is the path that keeps the sealed value intact. Returns
     * false when the name is unknown — the caller decides what that means; it
     * must never silently create a secret-less entry.
     */
    update(name, { kind, username, url, note, service, aliases } = {}) {
      if (!isValidName(name)) throw new Error('invalid credential name')
      const vault = readVault(dir)
      const previous = vault.entries[name]
      if (previous === undefined) return false
      const nextKind = kind === undefined ? (previous.kind ?? 'other') : kind
      if (!KINDS.includes(nextKind)) throw new Error('invalid kind, expected one of ' + KINDS.join(', '))

      // Validate only the fields the caller actually supplied; a partial update
      // must not blank the untouched ones.
      const meta = validateMeta({
        service: service === undefined ? undefined : service,
        username: username === undefined ? undefined : username,
        url: url === undefined ? undefined : url,
        note: note === undefined ? undefined : note,
        aliases: aliases === undefined ? undefined : aliases,
      })

      vault.version = VAULT_VERSION
      vault.entries[name] = {
        ...previous,
        kind: nextKind,
        username: username === undefined ? (previous.username ?? null) : meta.username,
        url: url === undefined ? (previous.url ?? null) : meta.url,
        note: note === undefined ? (previous.note ?? null) : meta.note,
        service: service === undefined ? (previous.service ?? null) : meta.service,
        aliases: aliases === undefined ? normalizeAliases(previous.aliases) : meta.aliases,
        updatedAt: new Date().toISOString(),
      }
      writeVault(dir, vault)
      return true
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
     * Batch export: the ONLY bulk path that produces plaintext. Returns full
     * entries (all metadata + secrets) for the export file; a damaged entry is
     * skipped and counted rather than failing the whole export (spec §4.0).
     */
    exportEntries() {
      const vault = readVault(dir)
      const entries = []
      let corrupt = 0
      for (const [name, value] of Object.entries(vault.entries)) {
        let secret
        try {
          secret = openSecret(key, value.secret)
        } catch {
          corrupt += 1
          continue
        }
        entries.push({
          id: value.id ?? null,
          name,
          kind: value.kind ?? 'other',
          service: value.service ?? null,
          aliases: normalizeAliases(value.aliases),
          username: value.username ?? null,
          url: value.url ?? null,
          note: value.note ?? null,
          createdAt: value.createdAt ?? null,
          updatedAt: value.updatedAt ?? null,
          secret,
        })
      }
      return { entries, corrupt }
    },

    /**
     * Atomically apply a merged import batch: seal every entry with THIS vault's
     * key, back up the current file once, then a single writeVault.
     */
    applyImport(writes) {
      const vault = readVault(dir)
      const now = new Date().toISOString()
      for (const entry of writes) {
        vault.entries[entry.name] = {
          id: entry.id,
          kind: entry.kind ?? 'other',
          secret: sealSecret(key, entry.secret),
          username: entry.username ?? null,
          url: entry.url ?? null,
          note: entry.note ?? null,
          service: entry.service ?? null,
          aliases: normalizeAliases(entry.aliases),
          createdAt: entry.createdAt ?? now,
          updatedAt: entry.updatedAt ?? now,
        }
      }
      vault.version = VAULT_VERSION
      writeVault(dir, vault)
    },

    /**
     * The only path that produces plaintext for a SINGLE credential. The
     * `credential` tool calls this; the HTTP API must not.
     */
    reveal(name) {
      assertSafeRead(name)
      const found = entry(name)
      if (found === null) return null
      return {
        name,
        id: found.id ?? null,
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
