// dsh-credential-vault — host half.
//
// Stores credentials (server passwords, GitHub tokens, API keys, …) AES-256-GCM
// encrypted under `$DSH_HOME/credential-vault/` and exposes:
//   - one `credential` tool the model calls with `action: list|get|reveal`,
//     where only `reveal` returns the secret and every reveal is audited;
//   - a system-prompt section telling the model this tool exists and that it
//     must ask before using a credential it has not been told to use;
//   - the HTTP API behind the sidebar manager (masked entries only).

import { homedir } from 'node:os'
import { join } from 'node:path'

import { appendFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createVaultStore } from './lib/vault-store.js' // STARTUP-MARKER
import { appendAudit, readAudit } from './lib/audit.js'
import { API_BASE, createApiHandler } from './lib/api.mjs'
import { isValidName } from './lib/store.js'

export const name = 'dsh-credential-vault'

/** HTTP route prefix claimed by this plugin (see lib/api.mjs). */
export { API_BASE }

export const TOOL_NAME = 'credential'

/** Cordis service dependencies. */
export const inject = ['tools', 'webServer']

/** Directory holding master.key / vault.json / audit.log. */
export function defaultVaultDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'credential-vault')
}

/** The system-prompt section: teaches the model the tool contract. */
const HINT_SECTION = {
  name: 'dsh-credential-vault:hint',
  order: 160,
  text:
    'Credential vault (dsh-credential-vault): stored credentials (server passwords, tokens, API keys) are available ' +
    `through the \`${TOOL_NAME}\` tool. \`action:"list"\` shows what exists (names, kinds, notes only); ` +
    `\`action:"get"\` returns masked metadata; \`action:"reveal", name:"…"\` returns the secret itself, and every ` +
    'reveal is written to an audit log the user can read in the panel. Ask the user before revealing a credential ' +
    'the user has not explicitly directed you to use, and never print a revealed secret into a file, log or message ' +
    'the user did not ask for.',
}

/**
 * Cordis plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{vaultDir?: string}} [config]
 */
export function apply(ctx, config = {}) {

  const options = config && typeof config === 'object' ? config : {}
  const dir = typeof options.vaultDir === 'string' && options.vaultDir.length > 0
    ? options.vaultDir
    : defaultVaultDir()
  const store = createVaultStore(dir)

  ctx.systemPrompt.section({ ...HINT_SECTION })

  const outputSpec = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
  ctx.effect(() => {
    try {
      return ctx.tools.register(defineTool({
      name: TOOL_NAME,
      description:
        'Read credentials from the encrypted vault: list what is stored, get masked metadata, or reveal the secret ' +
        'itself. Every reveal is audited. Use the exact credential name from `action:"list"`.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: '"list", "get" or "reveal".',
        },
        name: {
          type: 'string',
          description: 'Credential name. Required for "get" and "reveal".',
        },
      },
      execute(args) {
        const action = typeof args?.action === 'string' ? args.action : ''
        if (action === 'list') {
          const entries = store.list().map(({ preview, ...rest }) => rest)
          return {
            action,
            count: entries.length,
            entries,
            note: 'Names only. Use action "reveal" with one of these names when you need the secret itself.',
          }
        }
        if (action === 'get' || action === 'reveal') {
          const credName = typeof args?.name === 'string' ? args.name.trim() : ''
          if (!isValidName(credName)) {
            appendAudit(dir, { name: credName || null, outcome: 'rejected', source: 'tool', reason: 'invalid name' })
            throw new Error('credential: "name" is required and must be a plain name (see action "list")')
          }
          if (action === 'get') {
            const found = store.get(credName)
            appendAudit(dir, { name: credName, outcome: found === null ? 'missing' : 'ok', source: 'tool' })
            if (found === null) throw new Error(`credential: no credential named "${credName}"`)
            const { preview, ...rest } = found
            return { action, ...rest, note: 'Metadata only; the secret stays sealed.' }
          }
          const revealed = store.reveal(credName)
          appendAudit(dir, { name: credName, outcome: revealed === null ? 'missing' : 'ok', source: 'tool' })
          if (revealed === null) throw new Error(`credential: no credential named "${credName}"`)
          return { action, ...revealed }
        }
        throw new Error('credential: action must be "list", "get" or "reveal"')
      },
      presentCall: (args) => {
        const action = typeof args?.action === 'string' ? args.action : 'credential'
        const label = action === 'list' ? 'List credentials' : action === 'reveal' ? 'Reveal credential' : 'Read credential'
        return { title: label, kind: 'read', detail: typeof args?.name === 'string' ? args.name : undefined }
      },
      output: outputSpec,
      }))
    } catch (error) {
      // Another fiber of this plugin (the loader can create several during a
      // hot reconcile) may have registered the same tool name first; that
      // sibling owns the registration and this context must not fail for it.
      if (/already registered/.test(error?.message ?? '')) {
              return
      }
      throw error
    }
  })

  // kind 'exact' per route: the web app's listener serves exact routes; the
  // prefix kind registered from a hot-reloaded subtree never became reachable.
  const apiHandler = createApiHandler({ store })
  for (const [routePath, method] of [
    [`${API_BASE}/list`, 'GET'],
    [`${API_BASE}/entry`, 'GET'],
    [`${API_BASE}/audit`, 'GET'],
    [`${API_BASE}/set`, 'POST'],
    [`${API_BASE}/delete`, 'POST'],
    [`${API_BASE}/rotate`, 'POST'],
  ]) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: routePath, handler: apiHandler }))
  }

  // Keep the audit reader reachable for tests and future callers.
  void readAudit
}
