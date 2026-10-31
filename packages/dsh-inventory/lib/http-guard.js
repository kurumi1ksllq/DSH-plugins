/**
 * Reject state-changing requests that did not come from this same host.
 *
 * Routes registered with `ctx.webServer.register` bypass the /api
 * authorization layer, so every non-GET handler must call this first.
 *
 * Judgment (same as dsh-prompt-inject / dsh-websearch-failover):
 *   - `sec-fetch-site: cross-site` → forbidden
 *   - `Origin` present but empty or not a valid URL → forbidden
 *   - `Origin` host differing from `Host` → forbidden
 *   - no `Origin` (curl, same-origin fetch) → allowed
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean} true when the request must be refused.
 */
export function isForbiddenOrigin(req) {
  const headers = req.headers || {}

  const fetchSite = headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') return true

  const origin = headers.origin
  if (origin === undefined) return false
  if (typeof origin !== 'string' || origin.length === 0) return true

  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return true
  }

  const host = headers.host
  return typeof host !== 'string' || host.length === 0 || originHost !== host
}
