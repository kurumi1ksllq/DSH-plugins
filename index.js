/**
 * dsh-inventory — host half.
 *
 * A read-only snapshot of what this DSH installation actually has:
 *   - plugin packages declared by the profile, plus live loader rows
 *   - MCP servers from `@deepseek-ai/dsh-mcp-client` rows, with live tool counts
 *   - every skill on disk (including shadowed stubs) and runtime-registered ones
 *   - the full tool registry, with inferred ownership
 *   - skill -> tool edges: static text matching plus session-log evidence
 *
 * Surface: two plain HTTP routes.
 *   `GET  /inventory/snapshot`  — the read-only snapshot.
 *   `POST /inventory/workspace` — assign or remove one MCP server / skill for a
 *                                 registered workspace. The only write path; it
 *                                 touches nothing but `<workspace>/.dsh/`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readSessionEvents } from './lib/decode-session.js'
import { scanSkillRoots } from './lib/scan-skills.js'
import { attachDeps, buildSkillDeps } from './lib/skill-deps.js'
import { matchSkillTools } from './lib/match-tools.js'
import { collectSkillToolEvidence } from './lib/collect-sessions.js'
import { buildSnapshot } from './lib/inventory.js'
import { collectPackages } from './lib/profile-packages.js'
import { buildPluginToolIndex } from './lib/plugin-tool-index.js'
import { collectWorkspaces, sharedSkillRoots } from './lib/workspaces.js'
import { assignMcp, assignSkill, mcpFileOf, readDeclaration, removeMcp, removeSkill } from './lib/assign.js'
import { normalizeDir, pathKey } from './lib/workspace-gate.js'
import { BUILTIN_TOOLS, CLI_NAMES, detectDeferred } from './lib/tool-owners.js'

export const name = 'dsh-inventory'

/** Cordis services required at apply time; everything else is optional. */
export const inject = ['webServer']

export const SNAPSHOT_ROUTE = '/inventory/snapshot'
export const ASSIGN_ROUTE = '/inventory/workspace'

/**
 * Prompt section that makes the workspace-scoped MCP capability discoverable.
 *
 * The gate decides what to mount, but a model in an unrelated workspace sees
 * only its own tool list: it cannot tell that a declaration file exists, that
 * other workspaces have MCP servers, or that writing one would change the next
 * session. Without this section the capability is invisible from the inside.
 */
const WORKSPACE_MCP_SECTION = {
  name: 'dsh-inventory:workspace-mcp',
  order: 150,
  text: [
    'Workspace-scoped MCP: a workspace can declare MCP servers in `<workspace>/.dsh/mcp.json` as',
    '{"servers": {"<name>": {"transport": "stdio", "command": "...", "args": ["..."]}}},',
    'or with {"transport": "streamable-http", "url": "..."} for a remote server.',
    'A session whose cwd is inside that workspace mounts those servers when its agent is created,',
    'exposing tools named `mcp__<name>__<tool>`; every other workspace spawns nothing.',
    'The file is read once at agent creation, so a new or edited declaration applies to the next',
    'session, not the current one. Inspect the current state with `GET /inventory/snapshot`',
    '(workspaces[].mcp) or the sidebar Inventory -> By workspace page.',
  ].join(' '),
}

/** Contribute the section when the profile composes a system prompt. */
function registerPromptSection(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.effect(() =>
    ctx.inject(['systemPrompt'], (inner) => {
      inner.systemPrompt.section({ ...WORKSPACE_MCP_SECTION })
    }),
  )
}

const CACHE_MS = 15_000
const SESSION_FILE_LIMIT = 12
const SESSION_WINDOW = 8

const FIBER_PHASE = ['pending', 'loading', 'active', 'failed', null, 'unloading']

/** @type {{at: number, payload: object|null}} */
const cache = { at: 0, payload: null }

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function pathFromBaseUrl(baseUrl) {
  if (baseUrl === undefined || baseUrl === null) return undefined
  const raw = String(baseUrl)
  try {
    const url = baseUrl instanceof URL ? baseUrl : new URL(raw)
    if (url.protocol === 'file:') return fileURLToPath(url)
  } catch {
    // not a URL — fall through to a plain path probe
  }
  return existsSync(raw) ? raw : undefined
}

function resolveProfileDir(ctx) {
  const candidates = [
    pathFromBaseUrl(ctx?.baseUrl),
    process.env.DSH_PROFILE_DIR,
    join(homedir(), '.dsh', 'profiles', 'desktop'),
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0 && existsSync(join(candidate, 'package.json'))) {
      return candidate
    }
  }
  return candidates.find((candidate) => typeof candidate === 'string') ?? null
}

function skillRootsFor(cwd) {
  const home = homedir()
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(home, '.agents')
  const roots = [
    { dir: join(cwd, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
    { dir: join(cwd, '.agents', 'skills'), source: 'project-agents', rank: 200 },
  ]
  const custom = (process.env.DSH_CUSTOM_SKILL_DIRS ?? '').split(delimiter).filter(Boolean)
  custom.forEach((dir, index) => roots.push({ dir, source: 'custom', rank: 300 + index }))
  roots.push({ dir: join(dshHome, 'skills'), source: 'user-dsh', rank: 400 })
  roots.push({ dir: join(agentsHome, 'skills'), source: 'user-agents', rank: 500 })
  if (process.env.DSH_BUNDLED_SKILL_DIR) {
    roots.push({ dir: process.env.DSH_BUNDLED_SKILL_DIR, source: 'bundled', rank: 600 })
  }
  return roots
}

function collectRows(ctx) {
  const loader = ctx.get('loader')
  if (loader === undefined) return []
  const rows = []
  for (const entry of loader.entries()) {
    const options = entry.options ?? {}
    if (options.group) continue
    const phase = entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state] ?? null
    rows.push({
      id: entry.id ?? options.id ?? options.name,
      name: options.name,
      enabled: !entry.disabled,
      fiberPhase: phase,
      config: options.config,
    })
  }
  return rows
}

/**
 * Collect the tool surface across BOTH registry planes.
 *
 * `tools.schemas()` with no scope reports the GLOBAL layer only. Core tools
 * (read/write/edit/pwsh/skill/todo_write) are registered on the per-agent layer
 * by the agent preset composition, so a global-only read silently misses them.
 * We therefore union the global view with every live agent's view.
 * @returns {{tools: object[], planes: Array<{plane: string, added: number}>, agentCount: number}}
 */
function collectTools(ctx, warnings) {
  const registry = ctx.get('tools')
  if (registry === undefined || typeof registry.schemas !== 'function') {
    return { tools: [], planes: [], agentCount: 0 }
  }

  const byName = new Map()
  const planes = []
  const add = (schemas, plane) => {
    if (!Array.isArray(schemas)) return
    let added = 0
    for (const schema of schemas) {
      if (!schema || typeof schema.name !== 'string' || byName.has(schema.name)) continue
      byName.set(schema.name, {
        name: schema.name,
        descLen: typeof schema.description === 'string' ? schema.description.length : 0,
        deferred: schema.deferLoading === true,
        plane,
      })
      added += 1
    }
    if (added > 0) planes.push({ plane, added })
  }

  try {
    add(registry.schemas(), 'global')
  } catch (error) {
    warnings.push({ code: 'tools-global-failed', message: String(error?.message ?? error) })
  }

  const agents = ctx.get('agents')
  let liveAgents = []
  if (agents !== undefined && typeof agents.list === 'function') {
    try {
      liveAgents = agents.list() ?? []
    } catch (error) {
      warnings.push({ code: 'agents-list-failed', message: String(error?.message ?? error) })
    }
  }
  for (const agent of liveAgents) {
    for (const scope of [agent, agent?.ctx]) {
      if (scope === undefined || scope === null) continue
      try {
        add(registry.schemas(scope), 'agent')
      } catch {
        // A disposed agent racing the snapshot must not fail the response.
      }
    }
  }
  if (liveAgents.length === 0) {
    warnings.push({
      code: 'tools-global-only',
      message: '没有活跃 agent，工具清单只含全局平面；核心工具（read/write/edit/pwsh 等）属于 agent 平面，开会话后才会出现',
    })
  }

  return { tools: [...byName.values()], planes, agentCount: liveAgents.length }
}

function listSessionFiles(root, limit) {
  const files = []
  let projects = []
  try {
    projects = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    return files
  }
  for (const project of projects) {
    const projectDir = join(root, project.name)
    let sessions = []
    try {
      sessions = readdirSync(projectDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    } catch {
      continue
    }
    for (const session of sessions) {
      const sessionDir = join(projectDir, session.name)
      let entries = []
      try {
        entries = readdirSync(sessionDir)
      } catch {
        continue
      }
      for (const file of entries) {
        if (!file.startsWith('session.') || !file.includes('jsonl')) continue
        const full = join(sessionDir, file)
        try {
          files.push({ path: full, mtime: statSync(full).mtimeMs })
        } catch {
          // ignore
        }
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

function collectSessionEdges(warnings) {
  const root = join(homedir(), '.dsh', 'sessions')
  const files = listSessionFiles(root, SESSION_FILE_LIMIT)
  const merged = new Map()
  let decoded = 0
  for (const file of files) {
    let events
    try {
      const result = readSessionEvents(file.path)
      events = result.events
      decoded += 1
    } catch (error) {
      continue
    }
    const rows = collectSkillToolEvidence(events, { window: SESSION_WINDOW })
    for (const row of rows) {
      for (const [tool, count] of row.tools) {
        const key = `${row.skill}\u0000${tool}`
        merged.set(key, (merged.get(key) ?? 0) + count)
      }
    }
  }
  const failed = files.length - decoded
  if (files.length > 0 && decoded === 0) {
    warnings.push({ code: 'sessions-unreadable', message: '最近会话日志全部解析失败，会话实证已跳过' })
  } else if (failed > 0) {
    warnings.push({
      code: 'sessions-partial',
      message: `${failed}/${files.length} 个会话文件解析失败，会话实证可能不完整`,
    })
  }
  return [...merged.entries()].map(([key, count]) => {
    const [skill, tool] = key.split('\u0000')
    return { skill, tool, count }
  })
}

async function collectSkills(ctx, cwd, warnings) {
  const { skills, diagnostics } = scanSkillRoots(skillRootsFor(cwd))
  for (const diagnostic of diagnostics) {
    if (diagnostic.kind === 'duplicate') {
      warnings.push({ code: 'skill-duplicate', message: diagnostic.message })
    } else if (diagnostic.kind === 'invalid-frontmatter') {
      warnings.push({ code: 'skill-invalid', message: `${diagnostic.path}: ${diagnostic.reason}` })
    }
  }

  const seen = new Set(skills.map((skill) => skill.name))
  const registry = ctx.get('skills')
  if (registry !== undefined && typeof registry.list === 'function') {
    try {
      const list = await registry.list({ cwd })
      for (const summary of list) {
        if (seen.has(summary.name)) continue
        let body = ''
        try {
          const full = typeof registry.get === 'function' ? await registry.get(summary.name, { cwd }) : undefined
          body = typeof full?.body === 'string' ? full.body : ''
        } catch {
          body = ''
        }
        skills.push({
          name: summary.name,
          description: summary.description ?? '',
          path: summary.path,
          source: 'runtime',
          rank: 0,
          modelInvocable: summary.invocation?.modelInvocable !== false,
          userInvocable: summary.invocation?.userInvocable !== false,
          disabled: summary.invocation?.modelInvocable === false,
          bodyBytes: body.length,
          body,
        })
        seen.add(summary.name)
      }
    } catch (error) {
      warnings.push({ code: 'skills-registry-failed', message: String(error?.message ?? error) })
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function loadSnapshot(ctx) {
  const warnings = []
  const cwd = process.cwd()
  const profileDir = resolveProfileDir(ctx)

  const rows = collectRows(ctx)
  const packages = collectPackages(profileDir, rows)
  const collected = collectTools(ctx, warnings)
  const toolSearchRow = rows.find((row) => row.name === 'dsh-tool-search')
  const deferred = detectDeferred({
    toolNames: collected.tools.map((tool) => tool.name),
    toolSearch: toolSearchRow?.config ?? null,
  })
  const tools = collected.tools.map((tool) => ({ ...tool, deferred: tool.deferred || deferred.has(tool.name) }))
  const skillList = await collectSkills(ctx, cwd, warnings)

  // Skill → asset graph: what each skill's own body and its `refs/` tree point
  // at, and which of those targets no longer exist. Depth-1 discovery never
  // sees `refs/`, so this is the only way the panel can show it.
  const skillDeps = buildSkillDeps({
    skills: skillList,
    roots: skillRootsFor(cwd).map((root) => root.dir),
  })
  for (const miss of skillDeps.missing) {
    warnings.push({ code: 'skill-ref-missing', message: `技能引用缺失：${miss.from} → ${miss.to}` })
  }

  const mcpServers = rows
    .filter((row) => row.name === '@deepseek-ai/dsh-mcp-client')
    .map((row) => row.config?.serverName)
    .filter((server) => typeof server === 'string')

  const toolNames = tools.map((tool) => tool.name)
  const pluginTools = buildPluginToolIndex({
    profileDir,
    packages,
    toolNames,
    builtinTools: BUILTIN_TOOLS,
    selfPackage: 'dsh-inventory',
  })
  const cliNames = CLI_NAMES.filter((cli) => !mcpServers.includes(cli))

  const skillEdges = []
  for (const skill of skillList) {
    const body = typeof skill.body === 'string' ? skill.body : ''
    for (const edge of matchSkillTools({ body, toolNames, mcpServers, cliNames })) {
      skillEdges.push({ skill: skill.name, ...edge })
    }
  }

  const sessionEdges = collectSessionEdges(warnings)
  const builtinTools = BUILTIN_TOOLS.filter((tool) => toolNames.includes(tool))

  const snapshot = buildSnapshot({
    now: Date.now(),
    profile: profileDir === null ? null : { dir: profileDir, bundles: packages.filter((pkg) => pkg.declaredBy.includes('bundles')).map((pkg) => pkg.name) },
    packages,
    rows,
    skills: attachDeps(skillList, skillDeps).map(({ body, ...rest }) => rest),
    tools,
    builtinTools,
    pluginTools,
    skillEdges,
    sessionEdges,
    warnings,
  })
  // Which registry planes contributed, and how many live agents were read.
  snapshot.toolPlanes = collected.planes
  snapshot.agentPlaneAgents = collected.agentCount
  // Totals only: the per-skill detail already rides on each skill row.
  snapshot.skillDeps = skillDeps.totals

  // Per-workspace view: the MCP each workspace declares, and the skills its
  // project roots contribute. The gate row's suffix is read from the loader so
  // the page can show the name the tools will actually carry.
  const gateRow = rows.find((row) => row.name === 'dsh-inventory/gate' || row.name === 'dsh-mcp-workspace-gate')
  const serverNameSuffix = typeof gateRow?.config?.serverNameSuffix === 'string' ? gateRow.config.serverNameSuffix : ''
  const workspaceView = collectWorkspaces({
    registry: ctx.get('workspaceRegistry'),
    globalMcp: mcpServers,
    serverNameSuffix,
    warnings,
  })
  snapshot.workspaces = workspaceView.workspaces
  snapshot.globalMcp = workspaceView.globalMcp
  snapshot.sharedSkills = workspaceView.sharedSkills
  snapshot.sharedSkillCount = workspaceView.sharedSkillCount
  snapshot.workspaceRegistryAvailable = workspaceView.registryAvailable
  snapshot.gateServerNameSuffix = serverNameSuffix

  const payload = JSON.stringify(snapshot)
  if (payload.length > 6 * 1024 * 1024) {
    snapshot.warnings.push({ code: 'payload-large', message: `快照 ${(payload.length / 1024 / 1024).toFixed(1)} MB，客户端可能渲染缓慢` })
  }
  return snapshot
}

async function getSnapshot(ctx, { refresh = false } = {}) {
  const now = Date.now()
  if (!refresh && cache.payload !== null && now - cache.at < CACHE_MS) return cache.payload
  const payload = await loadSnapshot(ctx)
  cache.at = now
  cache.payload = payload
  return payload
}

/** A write makes the cached snapshot a lie; drop it instead of serving stale state. */
function invalidateSnapshot() {
  cache.at = 0
  cache.payload = null
}

// ---- POST /inventory/workspace ------------------------------------------

const MAX_BODY_BYTES = 64 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`请求体超过 ${MAX_BODY_BYTES} 字节`))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Registered workspaces — the only directories this route is allowed to write in. */
function registeredWorkspaces(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || registry === null || typeof registry.list !== 'function') return []
  try {
    return (registry.list() ?? []).filter((entry) => typeof entry?.path === 'string' && entry.path.length > 0)
  } catch {
    return []
  }
}

function findWorkspace(ctx, requested) {
  if (typeof requested !== 'string' || requested.trim() === '') return undefined
  let key
  try {
    key = pathKey(requested)
  } catch {
    return undefined
  }
  for (const entry of registeredWorkspaces(ctx)) {
    try {
      if (pathKey(entry.path) === key) return entry
    } catch {
      // An unparsable registered path cannot match a request.
    }
  }
  return undefined
}

/** Project a live mcp-client row config back onto a declaration entry. */
function declarationFromConfig(config) {
  if (config === null || typeof config !== 'object') return undefined
  if (config.transport === 'streamable-http') {
    if (typeof config.url !== 'string' || config.url === '') return undefined
    return {
      transport: 'streamable-http',
      url: config.url,
      ...(config.headers !== undefined ? { headers: config.headers } : {}),
    }
  }
  if (typeof config.command !== 'string' || config.command === '') return undefined
  return {
    transport: 'stdio',
    command: config.command,
    ...(Array.isArray(config.args) && config.args.length > 0 ? { args: config.args.map(String) } : {}),
    ...(config.env !== undefined ? { env: config.env } : {}),
    ...(typeof config.cwd === 'string' && config.cwd !== '' ? { cwd: config.cwd } : {}),
  }
}

/**
 * The declaration for an installed MCP server, wherever it currently lives:
 * a global mcp-client row first, then another workspace's declaration (that is
 * how a server mounted only in one workspace can be copied into a second one).
 */
function installedMcp(ctx, name) {
  const loader = ctx.get('loader')
  if (loader !== undefined && typeof loader.entries === 'function') {
    for (const entry of loader.entries()) {
      const options = entry.options ?? {}
      if (options.name !== '@deepseek-ai/dsh-mcp-client') continue
      const config = options.config ?? {}
      if (config.serverName !== name) continue
      const declaration = declarationFromConfig(config)
      if (declaration !== undefined) return declaration
    }
  }
  for (const entry of registeredWorkspaces(ctx)) {
    const parsed = readDeclaration(mcpFileOf(entry.path))
    if (!parsed.ok) continue
    const server = parsed.servers[name]
    if (server !== undefined && server !== null && typeof server === 'object') return server
  }
  return undefined
}

/** Disk path of an installed skill, or undefined for a runtime-only registration. */
function installedSkillPath(name) {
  const { skills } = scanSkillRoots(sharedSkillRoots())
  return skills.find((skill) => skill.name === name)?.path
}

/**
 * Assign or remove one capability for one workspace.
 * @returns {Promise<{status: number, payload: object}>}
 */
async function assignForWorkspace(ctx, req) {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
  if (method !== 'POST') return { status: 405, payload: { ok: false, error: 'method-not-allowed' } }

  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (error) {
    return { status: 400, payload: { ok: false, error: `请求体无法解析：${error?.message ?? error}` } }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, payload: { ok: false, error: '请求体必须是对象' } }
  }
  const kind = body.kind
  const action = body.action
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (kind !== 'mcp' && kind !== 'skill') {
    return { status: 400, payload: { ok: false, error: 'kind 必须是 mcp 或 skill' } }
  }
  if (action !== 'add' && action !== 'remove') {
    return { status: 400, payload: { ok: false, error: 'action 必须是 add 或 remove' } }
  }
  if (name === '') return { status: 400, payload: { ok: false, error: 'name 不能为空' } }

  const workspace = findWorkspace(ctx, body.workspace)
  if (workspace === undefined) {
    return { status: 404, payload: { ok: false, error: `工作区未登记：${String(body.workspace)}` } }
  }
  const dir = workspace.path
  if (!existsSync(dir)) {
    return { status: 400, payload: { ok: false, error: `工作区目录不可用：${dir}` } }
  }

  let result
  try {
    if (kind === 'mcp') {
      if (action === 'remove') {
        result = removeMcp({ workspaceDir: dir, name })
      } else {
        const server = installedMcp(ctx, name)
        if (server === undefined) {
          return { status: 404, payload: { ok: false, error: `没有已安装的 MCP 服务器 ${name}` } }
        }
        result = assignMcp({ workspaceDir: dir, name, server })
      }
    } else if (action === 'remove') {
      result = removeSkill({ workspaceDir: dir, name })
    } else {
      const sourcePath = installedSkillPath(name)
      if (sourcePath === undefined) {
        return {
          status: 404,
          payload: { ok: false, error: `没有可链接的已安装技能 ${name}（运行时注册的技能没有磁盘目录）` },
        }
      }
      result = assignSkill({ workspaceDir: dir, name, sourcePath })
    }
  } catch (error) {
    return { status: 500, payload: { ok: false, error: `写入失败：${error?.message ?? error}` } }
  }

  if (!result.ok) return { status: 400, payload: { ok: false, error: result.error } }
  invalidateSnapshot()
  return {
    status: 200,
    payload: { ok: true, workspace: normalizeDir(dir), kind, action, name, path: result.path },
  }
}

/**
 * Cordis plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // Registered before the webServer guard: the prompt section must reach the
  // model even in a profile without a web server (headless/ACP).
  registerPromptSection(ctx)

  if (typeof ctx.webServer?.register !== 'function') {
    ctx.logger?.warn?.('dsh-inventory: webServer service unavailable; snapshot route not registered')
    return
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: SNAPSHOT_ROUTE,
      handler: async (req, res) => {
        const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
        if (method !== 'GET') {
          sendJson(res, 405, { error: 'method-not-allowed' })
          return
        }
        let refresh = false
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          refresh = url.searchParams.get('refresh') === '1'
        } catch {
          refresh = false
        }
        try {
          const payload = await getSnapshot(ctx, { refresh })
          sendJson(res, 200, payload)
        } catch (error) {
          sendJson(res, 500, {
            error: 'snapshot-failed',
            message: String(error?.message ?? error),
          })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ASSIGN_ROUTE,
      handler: async (req, res) => {
        try {
          const { status, payload } = await assignForWorkspace(ctx, req)
          sendJson(res, status, payload)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: `分配失败：${error?.message ?? error}` })
        }
      },
    }),
  )
}
