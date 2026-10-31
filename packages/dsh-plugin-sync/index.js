/**
 * dsh-plugin-sync — reconcile the plugins installed in this DSH profile with
 * the manifest published by a target git repository, at every boot.
 *
 * Why a plugin and not a shell script: the comparison needs the profile's own
 * `package.json` and `node_modules` layout, which only exist once DSH has
 * decided which profile it is booting. A plugin gets that for free through
 * `ctx.baseUrl`, runs inside the boot sequence, and can report through the same
 * web server the rest of the panel uses.
 *
 * Rules this plugin holds itself to:
 *   - Never blocks boot. Every failure degrades to a warning.
 *   - Read-only unless `apply: true`. Report mode is the default.
 *   - Never removes anything. A locally added plugin is not a mistake.
 *   - Never updates itself: a running bundle cannot swap its own files, so
 *     `dsh-plugin-sync` sits in the default `exclude` list.
 */
import { mergeConfig } from './lib/config.js'
import { summarize } from './lib/compare.js'
import { readInstalled, resolveProfileDir } from './lib/installed.js'
import { reconcile } from './lib/reconcile.js'

export const name = 'dsh-plugin-sync'
export const inject = ['webServer']

/** HTTP route the panel reads. */
export const STATE_ROUTE = '/plugin-sync/state'

/** Route that forces a re-check, bypassing the boot-time cache. */
export const CHECK_ROUTE = '/plugin-sync/check'

export { MANIFEST_NAME, DEFAULTS, mergeConfig } from './lib/config.js'
export { parseManifest, diff, summarize } from './lib/compare.js'
export { fetchManifest } from './lib/fetch.js'
export { readInstalled, resolveProfileDir } from './lib/installed.js'
export { reconcile }

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

export function apply(ctx, rawConfig) {
  const config = mergeConfig(rawConfig)
  const logger = ctx.logger ?? {}

  // No repository configured is the documented off switch: the plugin loads,
  // costs nothing, and never touches the network.
  if (config.repo === '') {
    logger.info?.('plugin-sync: no repo configured, idle')
    return
  }

  const state = { latest: null, running: false }

  const run = async () => {
    if (state.running) return state.latest
    state.running = true
    try {
      const next = await reconcile(config, { ctx, profileDir: resolveProfileDir(ctx) })
      state.latest = next
      const line = summarize(next)
      if (next.ok && next.pending.length > 0) logger.warn?.(line)
      else logger.info?.(line)
      return next
    } catch (error) {
      logger.warn?.(`plugin-sync: reconcile failed: ${error?.message ?? error}`)
      return state.latest
    } finally {
      state.running = false
    }
  }

  // Boot-time check, deferred so the rest of the tree settles first. Never
  // awaited by boot: a slow remote must not delay the harness coming up.
  if (config.skipBoot !== true) {
    ctx.effect(() => {
      const timer = setTimeout(() => void run(), 0)
      // Unref so a pending check never keeps the process alive on shutdown.
      if (typeof timer?.unref === 'function') timer.unref()
      return () => clearTimeout(timer)
    })
  }

  if (typeof ctx.webServer?.register !== 'function') return

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      handler: (req, res) => {
        if (state.latest === null) {
          sendJson(res, 200, { ok: true, idle: true, repo: config.repo, ref: config.ref, apply: config.apply })
          return
        }
        sendJson(res, 200, { ...state.latest, apply: config.apply })
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: CHECK_ROUTE,
      handler: async (req, res) => {
        try {
          const next = await run()
          sendJson(res, 200, next ?? { ok: false, reason: 'no-result' })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }),
  )
}
