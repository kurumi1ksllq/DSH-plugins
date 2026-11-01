/**
 * dsh-git-status — host half.
 *
 * A read-only overview of the current git workspace:
 *   - branches (current / remote / gone / ahead-behind)
 *   - dirty state (changed & untracked counts)
 *   - recent commits and configured remotes
 *   - open PRs and issues through the `gh` CLI when it is installed and
 *     logged in; otherwise a reason string the panel renders as a hint
 *
 * The plugin never writes to the repository: every command it spawns is a
 * read-only git/gh subcommand, and no route accepts anything but GET.
 *
 * Surface: one HTTP route.
 *   `GET /git-status/snapshot`  — the whole snapshot (`?refresh=1` bypasses
 *                                 the 30s cache). `?sessionId=<id>` names the
 *                                 Session the panel is showing; that Session's
 *                                 header cwd is the workspace described.
 *                                 Without it the route falls back to the
 *                                 launch environment and the process cwd.
 */

import { isForbiddenOrigin } from './lib/http-guard.js'
import { getDiffResult, getSnapshot } from './lib/snapshot.js'

export const name = 'dsh-git-status'

/**
 * Cordis services required at apply time.
 * Only `webServer` is declared: Cordis injects a dependency ONLY when it is
 * listed here, so the Session readers below are looked up lazily at request
 * time with `ctx.get()` — an absent `sessions` / `sessionPersistence` then
 * degrades to the env fallback instead of parking the whole plugin.
 */
export const inject = ['webServer']

export const SNAPSHOT_ROUTE = '/git-status/snapshot'

/**
 * Read-only diff for one changed path (`?path=<repo-relative>`). Answers the
 * panel's "click a changed file to see what changed" affordance (issue #22)
 * without adding a write surface: GET only, path confined to the workspace.
 */
export const DIFF_ROUTE = '/git-status/diff'

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Cordis plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  if (typeof ctx.webServer?.register !== 'function') {
    ctx.logger?.warn?.('dsh-git-status: webServer service unavailable; snapshot route not registered')
    return
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: SNAPSHOT_ROUTE,
      handler: async (req, res) => {
        if (isForbiddenOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden-origin' })
          return
        }
        const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
        if (method !== 'GET') {
          sendJson(res, 405, { error: 'method-not-allowed' })
          return
        }
        let refresh = false
        let sessionId = ''
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          refresh = url.searchParams.get('refresh') === '1'
          sessionId = url.searchParams.get('sessionId') ?? ''
        } catch {
          refresh = false
        }
        try {
          const payload = await getSnapshot({
            force: refresh,
            sessionId,
            sessions: ctx.get('sessions'),
            sessionPersistence: ctx.get('sessionPersistence'),
          })
          sendJson(res, 200, payload)
        } catch (error) {
          sendJson(res, 500, {
            error: 'snapshot-failed',
            message: String(error?.message ?? error),
          })
        }
      },
    }),
    'dsh-git-status: snapshot route',
  )

  ctx.logger?.info?.('dsh-git-status: snapshot route registered')

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: DIFF_ROUTE,
      handler: async (req, res) => {
        if (isForbiddenOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden-origin' })
          return
        }
        const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
        if (method !== 'GET') {
          sendJson(res, 405, { error: 'method-not-allowed' })
          return
        }
        let sessionId = ''
        let path = ''
        let statusSha = ''
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          sessionId = url.searchParams.get('sessionId') ?? ''
          path = url.searchParams.get('path') ?? ''
          statusSha = url.searchParams.get('statusSha') ?? ''
        } catch {
          path = ''
        }
        if (path.length === 0) {
          sendJson(res, 400, { error: 'missing-path' })
          return
        }
        try {
          const result = await getDiffResult(
            {
              sessionId,
              statusSha,
              sessions: ctx.get('sessions'),
              sessionPersistence: ctx.get('sessionPersistence'),
            },
            path,
          )
          // A path is readable only when `git status` currently lists it AND it
          // resolves inside the worktree; everything else is "no diff", never a
          // file read. The reason is named so a stale panel can refresh instead
          // of silently showing nothing.
          if (result.status === 'ok') {
            sendJson(res, 200, result.payload)
          } else {
            sendJson(res, 404, { error: 'no-diff', path, reason: result.status })
          }
        } catch (error) {
          sendJson(res, 500, {
            error: 'diff-failed',
            message: String(error?.message ?? error),
          })
        }
      },
    }),
    'dsh-git-status: diff route',
  )

  ctx.logger?.info?.('dsh-git-status: diff route registered')
}
