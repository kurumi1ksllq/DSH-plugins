// HTTP API behind the sidebar panel. One prefix route, five actions:
//   GET  /websearch-failover/api/state       → ordered providers + balances
//   POST /websearch-failover/api/order       → { order: [id, ...] }
//   POST /websearch-failover/api/refresh     → { ids?: [id, ...] } (omit = all)
//   POST /websearch-failover/api/enable      → { id, enabled }
//   POST /websearch-failover/api/stats/reset → { id? } (omit = all)
import { MAX_BODY_BYTES, isForbiddenOrigin, readJsonBody, sendJson, truncate } from './http.mjs'

export const API_BASE = '/websearch-failover/api'
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
 * @param {{
 *   snapshot: () => object,
 *   reorder: (ids: string[]) => object,
 *   refresh: (ids?: string[]) => object | Promise<object>,
 *   setEnabled: (id: string, enabled: boolean) => object,
 *   resetStats: (id?: string) => object,
 *   maxBodyBytes?: number,
 * }} service
 */
export function createApiHandler(service) {
  const { snapshot, reorder, refresh, setEnabled, resetStats: resetStatsFn } = service
  const maxBodyBytes = Number.isFinite(service.maxBodyBytes) ? service.maxBodyBytes : MAX_BODY_BYTES

  const routes = {
    [`${API_BASE}/state`]: { methods: ['GET'], run: () => snapshot() },
    [`${API_BASE}/order`]: {
      methods: ['POST'],
      run: ({ body }) => {
        if (!Array.isArray(body?.order)) throw new ApiError(400, 'invalid-order', 'order must be an array of provider ids')
        return reorder(body.order)
      },
    },
    [`${API_BASE}/refresh`]: {
      methods: ['POST'],
      run: ({ body }) => {
        if (body?.ids !== undefined && !Array.isArray(body.ids)) throw new ApiError(400, 'invalid-ids', 'ids must be an array')
        return refresh(Array.isArray(body?.ids) ? body.ids : undefined)
      },
    },
    [`${API_BASE}/enable`]: {
      methods: ['POST'],
      run: ({ body }) => {
        if (typeof body?.id !== 'string' || body.id.trim().length === 0) throw new ApiError(400, 'invalid-enable', 'id is required')
        if (typeof body?.enabled !== 'boolean') throw new ApiError(400, 'invalid-enable', 'enabled must be a boolean')
        return setEnabled(body.id.trim(), body.enabled)
      },
    },
    [`${API_BASE}/stats/reset`]: {
      methods: ['POST'],
      run: ({ body }) => {
        // T4.web resetStats: { id } zeroes one provider, {} zeroes the panel.
        if (body?.id !== undefined && (typeof body.id !== 'string' || body.id.trim().length === 0)) {
          throw new ApiError(400, 'invalid-reset', 'id must be a non-empty string when present')
        }
        if (typeof resetStatsFn !== 'function') throw new ApiError(500, 'unsupported', 'resetStats is not wired in this deployment')
        return resetStatsFn(typeof body?.id === 'string' ? body.id.trim() : undefined)
      },
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

      const payload = await route.run({ body })
      sendJson(res, 200, payload)
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { ok: false, error: error.code, message: error.message })
        return
      }
      sendJson(res, 500, {
        ok: false,
        error: 'internal-error',
        message: truncate(error?.message ?? String(error), 300),
        path: pathname,
      })
    }
  }
}
