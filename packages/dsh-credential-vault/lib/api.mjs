// HTTP API behind the sidebar panel. One prefix route:
//   GET  /credential-vault/api/list           -> { ok, entries } (masked)
//   GET  /credential-vault/api/entry?name=x   -> one masked entry
//   GET  /credential-vault/api/audit          -> recent audit records
//   POST /credential-vault/api/set            -> { name, kind, secret, username?, url?, note? }
//   POST /credential-vault/api/delete         -> { name }
//   POST /credential-vault/api/rotate         -> rotate the master key
//
// NO route returns secret material: `set` takes it, nothing sends it back.
// Every POST checks the request origin (routes registered with
// `ctx.webServer.register` bypass the /api authorization layer).

import { MAX_BODY_BYTES, isForbiddenOrigin, readJsonBody, sendJson } from './http.mjs'
import { readAudit, trimAudit } from './audit.js'
import { KINDS, validateMeta } from './store.js'

/** Fixed text for an unexpected store failure; never the raw error message. */
const STORE_FAILED_MESSAGE = 'the credential store rejected the request'

/** GET /entry?name=… — one masked entry, never the secret itself. */
export function entryPayload(store, queryName) {
  const name = typeof queryName === 'string' ? queryName.trim() : ''
  if (name.length === 0) throw new ApiError(400, 'invalid-name', 'name is required')
  let found
  try {
    found = store.get(name)
  } catch (error) {
    // An unsafe-name entry is kept on disk but refused by the store (issue #52).
    // The panel needs to OPEN this entry to rename or delete it, so the error
    // must be a structured response — a 500 here would make the entry invisible
    // and un-deletable, locking the promised escape hatch.
    if (/unsafe name/.test(error.message)) {
      throw new ApiError(409, 'unsafe-name', error.message)
    }
    throw error
  }
  if (found === null) throw new ApiError(404, 'not-found', `no credential named ${JSON.stringify(name)}`)
  return { ok: true, entry: found }
}

export const API_BASE = '/credential-vault/api'
export { MAX_BODY_BYTES }

class ApiError extends Error {
  constructor(status, code, message) {
    super(message ?? code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Build the request handler for the plugin's prefix route.
 * @param {{ store: object, maxBodyBytes?: number }} service
 */
export function createApiHandler(service) {
  const { store } = service
  const maxBodyBytes = Number.isFinite(service.maxBodyBytes) ? service.maxBodyBytes : MAX_BODY_BYTES

  const routes = {
    [`${API_BASE}/list`]: { methods: ['GET'], run: () => ({ ok: true, entries: store.list() }) },
    [`${API_BASE}/audit`]: { methods: ['GET'], run: () => ({ ok: true, records: readAudit(store.dir, 100) }) },
    [`${API_BASE}/entry`]: {
      methods: ['GET'],
      run: ({ req }) => entryPayload(store, new URL(req?.url ?? '/', 'http://127.0.0.1').searchParams.get('name')),
    },
    [`${API_BASE}/set`]: {
      methods: ['POST'],
      run: ({ body }) => {
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if (name.length === 0) throw new ApiError(400, 'invalid-name', 'name is required')
        const secret = typeof body?.secret === 'string' ? body.secret : ''
        if (secret.length > 64 * 1024) throw new ApiError(413, 'secret-too-large', 'secret exceeds 64 KiB')
        const kind = typeof body?.kind === 'string' && KINDS.includes(body.kind) ? body.kind : 'other'
        // Same rules the store applies: `service` and `aliases` reach the system
        // prompt verbatim, so a newline or an oversized value must be refused here
        // too — with a 400 the panel can explain, not a store-level 500.
        // Only forward metadata the request actually mentioned: a keep-secret edit
        // sends `{name, kind, secret:''}` and must not blank the stored fields
        // (issue #57). An explicitly empty value still clears, because the key IS
        // present and validateMeta turns '' into null.
        const has = (key) => Object.hasOwn(body ?? {}, key)
        let meta
        try {
          meta = validateMeta({
            service: has('service') ? body.service : undefined,
            aliases: has('aliases') ? body.aliases : undefined,
            username: has('username') ? body.username : undefined,
            url: has('url') ? body.url : undefined,
            note: has('note') ? body.note : undefined,
          })
        } catch (error) {
          throw new ApiError(400, 'invalid-metadata', error.message)
        }
        // The panel sends "other" for an unknown kind; anything the enum does not
        // know must be refused rather than silently downgraded.
        if (typeof body?.kind === 'string' && body.kind.length > 0 && !KINDS.includes(body.kind)) {
          throw new ApiError(400, 'invalid-kind', `kind must be one of ${KINDS.join(', ')}`)
        }
        try {
          // An empty secret means "keep the stored one" — but only for an entry
          // that already exists. Creating a credential out of nothing is refused,
          // and so is "editing" a name nobody created.
          if (secret.length === 0) {
            const updated = store.update(name, { kind, ...meta })
            if (!updated) throw new ApiError(400, 'invalid-secret', 'secret is required')
            return { ok: true, name, updated: true, keptSecret: true }
          }
          return { ok: true, ...store.set(name, { kind, secret, ...meta }) }
        } catch (error) {
          if (error instanceof ApiError) throw error
          // Never forward `error.message`: it is free-form and a future throw
          // could interpolate secret material straight onto the wire.
          throw new ApiError(400, 'store-failed', STORE_FAILED_MESSAGE)
        }
      },
    },
    [`${API_BASE}/delete`]: {
      methods: ['POST'],
      run: ({ body }) => {
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if (name.length === 0) throw new ApiError(400, 'invalid-name', 'name is required')
        return { ok: true, deleted: store.delete(name) }
      },
    },
    [`${API_BASE}/rotate`]: {
      methods: ['POST'],
      run: () => ({ ok: true, resealed: store.rotateKey() }),
    },
  }

  return async function handler(req, res) {
    let pathname = '/'
    try {
      pathname = new URL(req?.url ?? '/', 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/'
      const method = String(req?.method ?? 'GET').toUpperCase()
      const route = routes[pathname]

      if (!route) {
        sendJson(res, 404, { ok: false, error: 'not-found' })
        return
      }
      if (!route.methods.includes(method)) {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' }, { allow: route.methods.join(', ') })
        return
      }
      if (method !== 'GET' && isForbiddenOrigin(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden-origin' })
        return
      }

      let body = {}
      if (method === 'POST') {
        try {
          body = await readJsonBody(req, maxBodyBytes)
        } catch (error) {
          if (error?.code === 'payload-too-large') {
            sendJson(res, 413, { ok: false, error: 'payload-too-large' })
            return
          }
          sendJson(res, 400, { ok: false, error: 'invalid-json' })
          return
        }
      }

      const payload = await route.run({ body, req })
      trimAudit(store.dir)
      sendJson(res, 200, payload)
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { ok: false, error: error.code, message: error.message })
        return
      }
      // The catch-all must not echo `error.message` either: this branch fires on
      // errors nobody anticipated, which is exactly when the text may carry
      // arbitrary data (including a secret). The detail goes to the log only.
      console.error('[credential-vault] unhandled route failure', pathname, error)
      sendJson(res, 500, { ok: false, error: 'internal-error', path: pathname })
    }
  }
}
