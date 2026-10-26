/**
 * dsh-inventory/gate — second plugin entry of the same package.
 *
 * Mounts MCP servers only for sessions whose working directory declares them
 * in `<workspace>/.dsh/mcp.json`. It is a separate loader row because the
 * inventory half is a read-only HTTP surface, while this half attaches to every
 * agent lifecycle; keeping them apart means a gate failure can never take the
 * inventory page down (and vice versa).
 *
 * Every failure degrades to "not mounted": a broken declaration or an MCP
 * server that will not start must never block a session.
 */

import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { planMount } from './lib/workspace-gate.js'

const LOG = '[dsh-inventory/gate]'
const DEFAULT_LOG_FILE = path.join(tmpdir(), 'mcp-workspace-gate.log')

export const name = 'dsh-inventory-gate'

/** Services are resolved lazily; nothing here is required for activation. */
export const inject = []

const DEFAULTS = {
  enabled: true,
  declarationFile: '.dsh/mcp.json',
  searchParents: true,
  serverNameSuffix: '',
  allowServerNames: [],
  mountTimeoutMs: 15_000,
  logFile: DEFAULT_LOG_FILE,
  mcpClientEntry: '',
}

let mcpClientModule

/** Build the audit sink. An empty `logFile` disables the file entirely. */
function makeFileLog(file) {
  if (typeof file !== 'string' || file === '') return () => {}
  return (line) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${line}\n`, 'utf8')
    } catch {
      // Diagnostics must never break the gate.
    }
  }
}

/**
 * Resolve the shipped mcp-client plugin.
 *
 * A bare specifier only resolves when the Harness runtime resolver covers this
 * module's importer; the packaged file URL is the fallback that actually works
 * on a Desktop install. Every failed attempt is recorded so one run explains
 * itself.
 */
async function loadMcpClient(emit, config) {
  if (mcpClientModule !== undefined) return mcpClientModule

  const specifiers = []
  if (typeof config.mcpClientEntry === 'string' && config.mcpClientEntry !== '') {
    specifiers.push(pathToFileURL(config.mcpClientEntry).href)
  }
  specifiers.push('@deepseek-ai/dsh-mcp-client')
  if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
    specifiers.push(
      pathToFileURL(
        path.join(
          process.resourcesPath,
          'app.asar',
          'dsh',
          'node_modules',
          '@deepseek-ai',
          'dsh-mcp-client',
          'lib',
          'index.js',
        ),
      ).href,
    )
  }

  const attempts = []
  for (const specifier of specifiers) {
    try {
      const mod = await import(specifier)
      if (mod !== null && typeof mod.apply === 'function') {
        mcpClientModule = mod
        emit('info', `${LOG} mcp-client resolved via ${specifier}`)
        return mod
      }
      attempts.push(`${specifier}: no apply export`)
    } catch (error) {
      attempts.push(`${specifier}: ${error?.code ?? ''} ${error?.message ?? String(error)}`)
    }
  }

  mcpClientModule = null
  emit('warn', `${LOG} mcp-client unavailable; attempts: ${attempts.join(' | ')}`)
  return null
}

/**
 * Best-effort current working directory of an agent.
 *
 * `agent.ctx.workingDirectory` is a cordis service, and cordis throws on reading
 * a service the plugin did not declare in `inject` — the property access itself
 * throws, so it must sit inside the try. The session header cwd is the fallback
 * and is always present for a live agent.
 */
function readCwd(agent) {
  const headerCwd = agent?.session?.header?.cwd
  let service
  try {
    service = agent?.ctx?.workingDirectory
  } catch {
    service = undefined
  }
  if (service !== undefined && service !== null && typeof service.get === 'function') {
    try {
      const current = service.get()
      if (typeof current === 'string' && current !== '') return current
    } catch {
      // Fall through to the session header.
    }
  }
  return typeof headerCwd === 'string' ? headerCwd : ''
}

function withTimeout(promise, ms, onTimeout) {
  if (!(ms > 0)) return promise
  let timer
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.()
      resolve(undefined)
    }, ms)
    timer.unref?.()
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const logger = ctx.logger ?? console
  const fileLog = makeFileLog(config.logFile)

  const emit = (level, message) => {
    fileLog(message)
    try {
      logger[level]?.(message)
    } catch {
      // A logger that throws must not change gate behavior.
    }
  }

  emit('info', `${LOG} activated pid=${process.pid} config=${JSON.stringify(config)}`)

  /** agentId -> Fiber[] mounted for that agent. */
  const mounted = new Map()

  ctx.effect(() => {
    const off = ctx.on('agent/created', async ({ agent }) => {
      const agentId = agent?.id ?? '<unknown>'
      try {
        const cwd = readCwd(agent)
        emit('info', `${LOG} created agent=${agentId} cwd=${cwd || '<none>'}`)
        const plan = planMount(cwd, {
          enabled: config.enabled,
          declarationFile: config.declarationFile,
          searchParents: config.searchParents,
          allowServerNames: config.allowServerNames,
          serverNameSuffix: config.serverNameSuffix,
        })
        if (!plan.mount) {
          emit('info', `${LOG} skip agent=${agentId} cwd=${cwd} reason=${plan.reason}`)
          return
        }

        const mod = await loadMcpClient(emit, config)
        if (mod === null || mod === undefined) {
          emit('warn', `${LOG} skip agent=${agentId} root=${plan.root} reason=mcp-client-unavailable`)
          return
        }

        const fibers = []
        for (const [declaredName, serverConfig] of Object.entries(plan.servers)) {
          try {
            const fiber = await withTimeout(
              Promise.resolve(agent.ctx.plugin(mod, serverConfig)),
              config.mountTimeoutMs,
              () => emit('warn', `${LOG} mount slow agent=${agentId} server=${serverConfig.serverName}; session continues`),
            )
            if (fiber !== undefined) fibers.push(fiber)
            emit(
              'info',
              `${LOG} mount agent=${agentId} cwd=${cwd} server=${serverConfig.serverName} declared=${declaredName} root=${plan.root}`,
            )
          } catch (error) {
            emit('warn', `${LOG} mount failed agent=${agentId} server=${serverConfig.serverName}: ${String(error)}`)
          }
        }
        if (fibers.length > 0) mounted.set(agentId, fibers)
      } catch (error) {
        emit('warn', `${LOG} gate error agent=${agentId}: ${String(error)}`)
      }
    })

    return () => {
      try {
        off?.()
      } catch {
        // Listener already gone.
      }
      for (const fibers of mounted.values()) {
        for (const fiber of fibers) {
          try {
            fiber?.dispose?.()
          } catch {
            // Agent may already be disposed.
          }
        }
      }
      mounted.clear()
    }
  }, 'dsh-inventory-gate.agents')
}
