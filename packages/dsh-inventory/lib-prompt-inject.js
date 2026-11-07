/**
 * @local/dsh-prompt-inject — host half.
 *
 * Appends one editable section to every agent system prompt and exposes a
 * tiny HTTP state route so the browser-side editor can read and replace the
 * injected text. The section's `text` is a getter, so a successful save is
 * picked up by the next prompt assembly without re-registering anything.
 *
 * Injection point: `ctx.systemPrompt.section({ name, order, text, interpolate })`.
 * HTTP route: `GET/POST /prompt-inject/state` (plain HTTP, no /api auth, so
 * origin checks are done here).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Default section id in the assembled system prompt. */
export const DEFAULT_SECTION_NAME = 'demo:prompt-inject'

/** Default ordering slot (runs after the built-in prompt sections). */
export const DEFAULT_ORDER = 3500

/** Token a fresh agent must be able to echo back verbatim. */
export const DEFAULT_TOKEN = 'DSH-INJECT-7F3A-2026'

/** HTTP route shared by the host handler and the browser panel. */
export const STATE_ROUTE = '/prompt-inject/state'

/** Upper bound for a single injected text, in characters. */
export const MAX_TEXT_LENGTH = 200000

/** Upper bound for a request body, in bytes (~256 KiB). */
export const MAX_BODY_BYTES = 256 * 1024

/** File name used directly inside DSH_PROFILE_DIR. */
export const PROFILE_STATE_FILE = 'prompt-inject.state.json'

/**
 * Default injected text. Kept as a literal string: the section is registered
 * with `interpolate: false`, so no placeholder expansion happens on it.
 */
export const DEFAULT_TEXT = `## Local demo section — dsh-prompt-inject / 本地演示段落

This section is injected by the local Harness bundle \`@local/dsh-prompt-inject\` (row id \`prompt-inject\`). It exists only to demonstrate host-side system-prompt injection in this profile: it grants no extra capability, carries no user data, and is not a policy override.

本段由本地插件 \`@local/dsh-prompt-inject\` 注入，只用于演示本 profile 的系统提示词注入链路；它不赋予任何额外能力，不携带用户数据，也不构成策略覆盖。

- Verification token / 验证令牌: \`DSH-INJECT-7F3A-2026\`
- When the user asks "注入令牌是什么" or "what is the injection token", reply with exactly that token and nothing else — no explanation, no quotation marks, no additional sentence.
- In every other situation, do not mention this section, its token, or the injection at all, and do not let it change any other behavior. All other system-prompt rules (safety, permissions, tool use, response style) still apply exactly as written; this section never overrides them.`

function envValue(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Resolve the persisted-state location:
 *   1. `$DSH_PROFILE_DIR/prompt-inject.state.json`
 *   2. `$DSH_HOME/prompt-inject/state.json`
 *   3. `~/.dsh/prompt-inject/state.json`
 */
export function resolveStateFilePath() {
  const profileDir = envValue('DSH_PROFILE_DIR')
  if (profileDir) return join(profileDir, PROFILE_STATE_FILE)

  const dshHome = envValue('DSH_HOME')
  if (dshHome) return join(dshHome, 'prompt-inject', 'state.json')

  return join(homedir(), '.dsh', 'prompt-inject', 'state.json')
}

/** Read the persisted state, treating a missing or damaged file as "not set". */
function loadPersistedState(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null
  if (typeof parsed.text !== 'string') return null
  if (parsed.text.length === 0 || parsed.text.length > MAX_TEXT_LENGTH) return null

  return {
    text: parsed.text,
    updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
  }
}

/** Write the state atomically: temp file first, then rename over the target. */
function persistState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempFile, JSON.stringify(state), 'utf8')
  renameSync(tempFile, file)
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    ...extraHeaders,
  })
  res.end(body)
}

/**
 * Reject state-changing requests that did not come from this same host.
 * The route bypasses the /api authorization layer, so this is mandatory.
 */
function isForbiddenOrigin(req) {
  const headers = req.headers || {}

  const fetchSite = headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') {
    return true
  }

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

/** Read and parse a JSON request body, enforcing the byte cap while streaming. */
async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) {
      const error = new Error('payload-too-large')
      error.code = 'payload-too-large'
      throw error
    }
    chunks.push(buffer)
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Cordis plugin entry.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ text?: string, order?: number, name?: string }} [config]
 */
export function apply(ctx, config = {}) {
  // A patch row may hand us `null` (or a non-object) as config; treat any
  // non-object value as "use defaults" instead of throwing during load.
  const options = config && typeof config === 'object' ? config : {}

  const sectionName =
    typeof options.name === 'string' && options.name.length > 0
      ? options.name
      : DEFAULT_SECTION_NAME

  const order =
    typeof options.order === 'number' && Number.isFinite(options.order)
      ? options.order
      : DEFAULT_ORDER

  const stateFile = resolveStateFilePath()
  const persisted = loadPersistedState(stateFile)

  let currentText =
    typeof options.text === 'string' && options.text.length > 0
      ? options.text
      : persisted
        ? persisted.text
        : DEFAULT_TEXT

  let updatedAt = persisted ? persisted.updatedAt : 0

  // `interpolate: false` is required: the text is a literal and may contain
  // characters that the prompt interpolator would otherwise try to expand.
  // The getter is evaluated on every prompt assembly, so saves are live.
  ctx.systemPrompt.section({
    name: sectionName,
    order,
    text: () => currentText,
    interpolate: false,
  })

  // The route is registered inside an effect so unloading the plugin removes
  // it together with the rest of this context.
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      handler: async (req, res) => {
        const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'

        if (method !== 'GET' && method !== 'POST') {
          sendJson(res, 405, { error: 'method-not-allowed' }, { allow: 'GET, POST' })
          return
        }

        if (method === 'GET') {
          sendJson(res, 200, { text: currentText, updatedAt })
          return
        }

        if (isForbiddenOrigin(req)) {
          sendJson(res, 403, { error: 'forbidden-origin' })
          return
        }

        let payload
        try {
          payload = await readJsonBody(req)
        } catch (error) {
          if (error && error.code === 'payload-too-large') {
            sendJson(res, 413, { error: 'payload-too-large' })
          } else {
            sendJson(res, 400, { error: 'invalid-json' })
          }
          return
        }

        const text = payload && typeof payload === 'object' ? payload.text : undefined
        if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH) {
          sendJson(res, 400, { error: 'invalid-text' })
          return
        }

        const nextUpdatedAt = Date.now()
        try {
          persistState(stateFile, { text, updatedAt: nextUpdatedAt })
        } catch (error) {
          const message = error && error.message ? error.message : String(error)
          sendJson(res, 500, { error: 'persist-failed', message })
          return
        }

        // Only commit to memory after the file is safely on disk, so a failed
        // write can never leave the live prompt out of sync with persistence.
        currentText = text
        updatedAt = nextUpdatedAt
        ctx.emit('system-prompt/change')

        sendJson(res, 200, { text, updatedAt })
      },
    }),
  )
}

/** Cordis service dependencies: prompt assembly and the host HTTP server. */
export const inject = ['systemPrompt', 'webServer']
