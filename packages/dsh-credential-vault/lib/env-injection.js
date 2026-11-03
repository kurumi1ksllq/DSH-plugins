// Zero-plaintext credential USE for dsh-credential-vault.
//
// The problem this solves: any value that reaches the model lands in the session
// log, in the tool-call arguments it copies it into, in job labels, and often in
// a `.git/config`. Encryption at rest does not help once the plaintext is in the
// transcript.
//
// So `use` never returns a value. It records a short-lived grant for one session
// and hands back the NAME of an environment variable. `dsh-shell-env` rebuilds
// its `DSH_*` snapshot per shell execution without entering the request prefix,
// so the value exists only inside the child process:
//
//   model writes   git clone "https://x-access-token:$DSH_CRED_GITHUB_TOKEN@…"
//   session log    contains $DSH_CRED_GITHUB_TOKEN, never the secret
//
// Honest boundary: this stops accidental leaks (paste, URL, file, log). It does
// not stop deliberate exfiltration by an agent running as the same OS user —
// that needs an external KMS or a separate low-privilege user.

import { normalizeKey } from './store.js'

/** How long a `use` grant stays valid, in milliseconds. */
export const DEFAULT_GRANT_TTL_MS = 10 * 60 * 1000

/**
 * The environment variable that carries one credential. Uppercased slug with
 * dashes turned into underscores, because `dsh-shell-env` requires an all-caps
 * `DSH_*` key with underscores.
 * @param {string} name
 * @returns {string}
 */
export function envVarFor(name) {
  const slug = normalizeKey(name).toUpperCase().replace(/-/g, '_')
  return `DSH_CRED_${slug}`
}

/**
 * The declaration set for `shellEnv.register()`: one entry per credential.
 * Only names and descriptions — the resolver supplies values per execution.
 * @param {Array<object>} entries
 * @returns {Record<string, {description: string}>}
 */
export function declarationsFor(entries) {
  const variables = {}
  for (const entry of entries) {
    const key = envVarFor(entry.name)
    if (Object.hasOwn(variables, key)) continue
    variables[key] = { description: `Value of the "${entry.name}" credential from the credential vault.` }
  }
  return variables
}

/** The session id a tool execution or shell execution belongs to, or null. */
export function sessionIdOf(execution) {
  return execution?.agent?.session?.header?.id ?? null
}

/**
 * In-memory grant table: which session may read which credential right now.
 * Never persisted, so a restart silently drops every grant.
 * @param {{ttlMs?: number, now?: () => number}} [options]
 */
export function createGrantTable(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_GRANT_TTL_MS
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  /** @type {Map<string, Map<string, {secret: string, expiresAt: number}>>} */
  const bySession = new Map()

  function prune(sessionId) {
    const grants = bySession.get(sessionId)
    if (grants === undefined) return grants
    for (const [name, grant] of grants) {
      if (grant.expiresAt <= now()) grants.delete(name)
    }
    if (grants.size === 0) bySession.delete(sessionId)
    return grants
  }

  return {
    ttlMs,

    /** Record that one session may use one credential until it expires. */
    issue(sessionId, name, secret) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('credential: "use" requires a session id')
      }
      const grants = bySession.get(sessionId) ?? new Map()
      const expiresAt = now() + ttlMs
      grants.set(name, { secret, expiresAt })
      bySession.set(sessionId, grants)
      return { envVar: envVarFor(name), expiresAt: new Date(expiresAt).toISOString() }
    },

    /** Every unexpired secret the session may use, keyed by credential name. */
    valuesFor(sessionId) {
      const grants = prune(sessionId)
      if (grants === undefined) return new Map()
      return new Map([...grants].map(([name, grant]) => [name, grant.secret]))
    },

    /** Drop one session's grants (used when a session ends). */
    clear(sessionId) {
      bySession.delete(sessionId)
    },
  }
}

/**
 * Bind the vault to the shell environment registry.
 *
 * `register` is `(contributor) => disposer`, i.e. `ctx.shellEnv.register`. The
 * declaration set follows the vault: `sync()` re-registers when the set of
 * credential names changes, because `shellEnv` requires every returned key to be
 * declared up front.
 *
 * @param {{
 *   store: {list: () => Array<object>},
 *   grants: ReturnType<typeof createGrantTable>,
 *   register: (contributor: object) => (() => void) | undefined,
 * }} options
 */
export function createEnvBridge({ store, grants, register }) {
  let disposer = null
  let declaredSignature = null
  let ready = false

  function resolveWith(variables) {
    return (execution) => {
      const sessionId = sessionIdOf(execution)
      if (sessionId === null) return {}
      const granted = grants.valuesFor(sessionId)
      if (granted.size === 0) return {}
      const values = {}
      for (const [name, secret] of granted) {
        const key = envVarFor(name)
        if (Object.hasOwn(variables, key)) values[key] = secret
      }
      return values
    }
  }

  return {
    get ready() {
      return ready
    },

    /** Re-register when the credential name set changed; idempotent otherwise. */
    sync() {
      if (typeof register !== 'function') return false
      const entries = store.list()
      const variables = declarationsFor(entries)
      const signature = Object.keys(variables).sort().join(',')
      if (signature === declaredSignature && ready) return true
      if (typeof disposer === 'function') disposer()
      disposer = register({
        name: 'credential-vault',
        variables,
        resolve: resolveWith(variables),
      }) ?? null
      declaredSignature = signature
      ready = true
      return true
    },

    /** The currently declared variable names. */
    declared() {
      return declaredSignature === null ? [] : declaredSignature.split(',').filter(Boolean)
    },

    dispose() {
      if (typeof disposer === 'function') disposer()
      disposer = null
      declaredSignature = null
      ready = false
    },
  }
}
