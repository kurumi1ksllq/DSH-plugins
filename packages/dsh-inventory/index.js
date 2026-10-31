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
 * Surface: three HTTP routes.
 *   `GET  /inventory/snapshot`  — the read-only snapshot.
 *   `POST /inventory/workspace` — assign or remove one MCP server / skill for a
 *                                 registered workspace. It touches nothing but
 *                                 `<workspace>/.dsh/`.
 *   `POST /inventory/global`    — enable or disable one GLOBAL capability: an MCP
 *                                 server row (through `pluginManager`, or the
 *                                 profile patch as a fallback) or a skill on a
 *                                 global skill root (its SKILL.md flag).
 */

import { accessSync, constants as FS, existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, rmdirSync, statSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readSessionEvents } from './lib/decode-session.js'
import { scanSkillRoots } from './lib/scan-skills.js'
import { attachDeps, buildSkillDeps } from './lib/skill-deps.js'
import { matchSkillTools } from './lib/match-tools.js'
import { collectSkillToolEvidence } from './lib/collect-sessions.js'
import { buildSnapshot } from './lib/inventory.js'
import { collectPackages } from './lib/profile-packages.js'
import { buildPluginToolIndex } from './lib/plugin-tool-index.js'
import { collectWorkspaces, readDefaultWorkspace, sharedSkillRoots } from './lib/workspaces.js'
import { assignMcp, assignSkill, mcpFileOf, projectRootOf, readDeclaration, removeMcp, removeSkill } from './lib/assign.js'
import { normalizeDir, pathKey } from './lib/workspace-gate.js'
import { setSkillEnabled } from './lib/skill-toggle.js'
import { writePatchEnabled } from './lib/global-patch.js'
import { moveIntoVault, moveOutOfVault, scanVault, vaultDir } from './lib/vault.js'
import { BUILTIN_TOOLS, CLI_NAMES, detectDeferred } from './lib/tool-owners.js'
import { syncApply, syncConfigure, syncPreview, syncPublish, syncStatus } from './lib/sync-service.js'

export const name = 'dsh-inventory'

/** Cordis services required at apply time; everything else is optional. */
export const inject = ['webServer']

export const SNAPSHOT_ROUTE = '/inventory/snapshot'
export const ASSIGN_ROUTE = '/inventory/workspace'
export const GLOBAL_ROUTE = '/inventory/global'
export const VAULT_ROUTE = '/inventory/vault'
export const SYNC_ROUTE = '/inventory/sync'
export const SYNC_CONFIG_ROUTE = '/inventory/sync/config'
export const SYNC_PREVIEW_ROUTE = '/inventory/sync/preview'
export const SYNC_APPLY_ROUTE = '/inventory/sync/apply'

const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/**
 * Skill roots that are machine-wide rather than per-project. A skill on one of
 * these is what "global skill" means in the panel, and the only ones whose own
 * SKILL.md the global switch is allowed to edit.
 */
const GLOBAL_SKILL_SOURCES = new Set(['custom', 'user-dsh', 'user-agents', 'bundled'])

/**
 * Prompt section that teaches the model how capabilities are registered and
 * enabled in this installation.
 *
 * Registration is inert on purpose: a globally registered MCP row is disabled,
 * a registered skill sits in a vault no skill root scans. A session therefore
 * sees only what its own workspace enables — and an agent asked to "install an
 * MCP/skill" has to follow this contract, or it will create a second, silently
 * global copy. The panel writes the same files; this section is what makes the
 * convention visible from inside a session.
 */
const WORKSPACE_MCP_SECTION = {
  name: 'dsh-inventory:workspace-capabilities',
  order: 150,
  text: [
    'Workspace-scoped capabilities (dsh-inventory): nothing here is mounted globally by default.',
    'An MCP server or skill is REGISTERED once and ENABLED per workspace; the enablement is read at agent creation,',
    'so a change applies to the next session, not the current one.',
    'MCP registry: a `@deepseek-ai/dsh-mcp-client` loader row with `disabled: true` in the profile patch',
    '(`~/.dsh/profiles/<profile>/cordis.patch.yml`) is a registration only — it mounts nowhere and costs no context.',
    'Enable it for one workspace by copying its `config` (serverName, transport, command/args/env or url/headers)',
    'into `<workspace>/.dsh/mcp.json` as {"servers": {"<name>": {...}}}; the dsh-inventory gate then mounts it for',
    'that workspace only, as `<name><gateSuffix>` (tools `mcp__<name><gateSuffix>__*`).',
    'Skill registry: registered skills live in `$DSH_HOME/inventory/skills/<name>/SKILL.md` (the vault),',
    'which no skill root scans. Enable one for a workspace with a directory link',
    '`<projectRoot>/.dsh/skills/<name>` -> that vault directory (projectRoot is the nearest `.git` ancestor);',
    'disable by removing the link. `disable-model-invocation: true` still hides a skill from the model catalog.',
    'The panel does all of this: sidebar Inventory -> 工作区 -> open a workspace, one switch per capability.',
    'Inspect state with `GET /inventory/snapshot` (vault, workspaces[].mcp, workspaces[].skills).',
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
  return [
    { dir: join(cwd, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
    { dir: join(cwd, '.agents', 'skills'), source: 'project-agents', rank: 200 },
    ...globalSkillRoots(),
  ]
}

/** Machine-wide skill roots: user homes, custom dirs, the bundled tree. */
function globalSkillRoots() {
  const home = homedir()
  const dshHome = process.env.DSH_HOME ?? join(home, '.dsh')
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(home, '.agents')
  const roots = []
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
  // Registered-but-inactive skills live in the vault, which is deliberately not
  // a skill root, so the scan above never sees them. A name that also exists on
  // a real root keeps the real-root row: that is the copy DSH would load.
  const knownNames = new Set(skillList.map((skill) => skill.name))
  const vaultedSkills = scanVault()
    .skills.filter((skill) => !knownNames.has(skill.name))
    .map((skill) => ({ ...skill, source: 'vault', vaulted: true }))
  const allSkills = [...skillList, ...vaultedSkills].sort((a, b) => a.name.localeCompare(b.name))

  // Skill → asset graph: what each skill's own body and its `refs/` tree point
  // at, and which of those targets no longer exist. Depth-1 discovery never
  // sees `refs/`, so this is the only way the panel can show it.
  const skillDeps = buildSkillDeps({
    skills: allSkills,
    roots: [...skillRootsFor(cwd).map((root) => root.dir), vaultDir()],
  })
  for (const miss of skillDeps.missing) {
    warnings.push({ code: 'skill-ref-missing', message: `技能引用缺失：${miss.from} → ${miss.to}` })
  }

  // Only an ENABLED mcp-client row mounts everywhere. A disabled row is a
  // registration (the panel's "仅注册" state) and must not read as mounted.
  const mcpServers = rows
    .filter((row) => row.name === MCP_CLIENT_MODULE && row.enabled !== false)
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
  for (const skill of allSkills) {
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
    skills: attachDeps(allSkills, skillDeps).map(({ body, ...rest }) => rest),
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
    // The default workspace is not a registry entry on every install: DSH keeps
    // its identity in its own storage, so read it from there and keep it listed.
    defaultWorkspace: readDefaultWorkspace(),
    warnings,
  })
  snapshot.workspaces = workspaceView.workspaces
  snapshot.globalMcp = workspaceView.globalMcp
  snapshot.defaultWorkspaceId = workspaceView.defaultWorkspaceId
  snapshot.sharedSkills = workspaceView.sharedSkills
  snapshot.sharedSkillCount = workspaceView.sharedSkillCount
  snapshot.workspaceRegistryAvailable = workspaceView.registryAvailable
  snapshot.gateServerNameSuffix = serverNameSuffix

  // ---- global enablement -------------------------------------------------
  // A global switch needs a write target: the plugin manager (persists into the
  // profile patch and reloads live) or that patch file itself (persists, applies
  // on the next start). A skill is switchable when it sits on a machine-wide root
  // and its own SKILL.md can be written — the flag lives in that file.
  const manager = pluginManager(ctx)
  const patchPath = profilePatchPath(ctx)
  const mcpSwitchable = manager !== undefined || (patchPath !== null && isWritableFile(patchPath))
  const skillSwitchable = globalSkillRoots().some((root) => isWritableFile(root.dir))
  snapshot.globalToggle = {
    mcp: mcpSwitchable,
    skill: skillSwitchable,
    via: manager !== undefined ? 'pluginManager' : mcpSwitchable ? 'patch' : null,
  }
  for (const entry of snapshot.mcp) {
    entry.toggleable = mcpSwitchable
    entry.disabledReason = mcpSwitchable ? null : 'no-writable-profile'
  }
  for (const skill of snapshot.skills) {
    const global = GLOBAL_SKILL_SOURCES.has(skill.source)
    const file = typeof skill.path === 'string' && skill.path.length > 0 ? skill.path : null
    skill.global = global
    // Every row carries the flag, so the client never has to guess.
    skill.vaulted = skill.vaulted === true
    // A vaulted skill is registered, not active: no global switch (the file it
    // would edit is already inert) and no per-project reason either.
    skill.toggleable = global && file !== null && isWritableFile(file)
    skill.disabledReason = skill.vaulted
      ? 'vaulted'
      : skill.toggleable
        ? null
        : file === null
          ? 'runtime'
          : global
            ? 'unreadable'
            : 'project-scope'
  }
  snapshot.vault = { dir: vaultDir(), count: vaultedSkills.length }

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

/**
 * Disk path of an installed skill, with the scope it came from.
 *
 * `vault` means no skill root scans it, so a project link is the only way to
 * enable it there. `global` means a machine-wide root already serves it to
 * every workspace: linking it would duplicate the skill (rank 100 shadows rank
 * 400) and a globally shadowed skill would stay shadowed, because the link
 * points at the same SKILL.md.
 */
function installedSkillPath(name) {
  const vaulted = scanVault().skills.find((skill) => skill.name === name)
  if (vaulted !== undefined) return { path: vaulted.path, scope: 'vault' }
  const { skills } = scanSkillRoots(sharedSkillRoots())
  const global = skills.find((skill) => skill.name === name)
  return global === undefined ? undefined : { path: global.path, scope: 'global' }
}

// ---- global enablement ----------------------------------------------------

/** The profile patch file a global switch persists into, when there is one. */
function profilePatchPath(ctx) {
  const profileContext = ctx.get('profileContext')
  if (profileContext !== undefined && typeof profileContext?.patchPath === 'string' && profileContext.patchPath.length > 0) {
    return profileContext.patchPath
  }
  const dir = resolveProfileDir(ctx)
  return typeof dir === 'string' && dir.length > 0 ? join(dir, 'cordis.patch.yml') : null
}

/** Writable file, or a writable directory when the file itself is not there yet. */
function isWritableFile(file) {
  try {
    accessSync(existsSync(file) ? file : dirname(file), FS.W_OK)
    return true
  } catch {
    return false
  }
}

/** The host's plugin manager, when this installation exposes one. */
function pluginManager(ctx) {
  const manager = ctx.get('pluginManager')
  return manager !== undefined && manager !== null && typeof manager.setPluginEnabled === 'function' ? manager : undefined
}

/** The live loader entry of one globally configured MCP server. */
function findMcpEntry(ctx, name) {
  const loader = ctx.get('loader')
  if (loader === undefined || typeof loader.entries !== 'function') return undefined
  for (const entry of loader.entries()) {
    const options = entry.options ?? {}
    if (options.name !== MCP_CLIENT_MODULE) continue
    if (options.config?.serverName === name) return entry
  }
  return undefined
}

/** The id a profile patch addresses: `include:` is a tree prefix, not part of the id. */
function patchIdOf(entry) {
  const id = typeof entry.options?.id === 'string' ? entry.options.id : entry.id
  return typeof id === 'string' ? id.replace(/^include:/, '') : String(id)
}

/**
 * Enable or disable one global MCP server.
 *
 * The loader row is the authority for "is it running now". It only agrees with
 * the request when the plugin manager can apply the change live; the patch
 * fallback is a pending write (it lands on the next start), so it never
 * short-circuits on the loader's current state — otherwise a re-enable after a
 * fallback disable would be dropped and the row would come back disabled.
 * @returns {Promise<{status: number, payload: object}>}
 */
async function toggleGlobalMcp(ctx, name, enabled) {
  const entry = findMcpEntry(ctx, name)
  if (entry === undefined) {
    return { status: 404, payload: { ok: false, error: `没有全局 MCP 服务器 ${name}` } }
  }

  const manager = pluginManager(ctx)
  if (manager !== undefined) {
    if ((entry.disabled !== true) === enabled) {
      return { status: 200, payload: { ok: true, kind: 'mcp', name, enabled, changed: false, live: true } }
    }
    try {
      await manager.setPluginEnabled(entry.id, enabled)
    } catch (error) {
      return { status: 400, payload: { ok: false, error: `pluginManager 拒绝：${error?.message ?? error}` } }
    }
    invalidateSnapshot()
    const after = findMcpEntry(ctx, name)
    return {
      status: 200,
      payload: {
        ok: true,
        kind: 'mcp',
        name,
        enabled,
        changed: true,
        live: after !== undefined && (after.disabled !== true) === enabled,
        via: 'pluginManager',
      },
    }
  }

  const patchPath = profilePatchPath(ctx)
  if (patchPath === null) {
    return { status: 400, payload: { ok: false, error: '没有可写的 profile patch 文件，无法持久化全局开关' } }
  }
  let result
  try {
    result = writePatchEnabled(patchPath, { id: patchIdOf(entry), enabled })
  } catch (error) {
    return { status: 500, payload: { ok: false, error: `写入失败：${error?.message ?? error}` } }
  }
  invalidateSnapshot()
  return {
    status: 200,
    payload: { ok: true, kind: 'mcp', name, enabled, changed: result.changed, live: false, via: 'patch', path: patchPath },
  }
}

/** Names the runtime skill registry reports; these have no disk file to edit. */
async function runtimeSkillNames(ctx) {
  const registry = ctx.get('skills')
  if (registry === undefined || typeof registry.list !== 'function') return []
  try {
    const list = await registry.list({ cwd: process.cwd() })
    return (list ?? []).map((summary) => summary?.name).filter((item) => typeof item === 'string')
  } catch {
    return []
  }
}

/**
 * Enable or disable one global skill by rewriting its own frontmatter flag.
 *
 * Only machine-wide roots are switchable. A skill that exists but is
 * project-scoped, or is registered at runtime without a file, is a 400 with the
 * reason — not a 404, because the caller did name a real skill.
 * @returns {Promise<{status: number, payload: object}>}
 */
async function toggleGlobalSkill(ctx, name, enabled) {
  const { skills } = scanSkillRoots(globalSkillRoots())
  const skill = skills.find((item) => item.name === name)

  if (skill === undefined) {
    const local = scanSkillRoots(skillRootsFor(process.cwd())).skills.find((item) => item.name === name)
    if (local !== undefined) {
      return {
        status: 400,
        payload: { ok: false, error: `技能 ${name} 是项目级技能（${local.source}），只能在工作区详情页处理` },
      }
    }
    if ((await runtimeSkillNames(ctx)).includes(name)) {
      return { status: 400, payload: { ok: false, error: `技能 ${name} 是运行时注册的，没有可写的 SKILL.md` } }
    }
    return { status: 404, payload: { ok: false, error: `没有全局技能 ${name}` } }
  }

  if (typeof skill.path !== 'string' || skill.path.length === 0) {
    return { status: 400, payload: { ok: false, error: `技能 ${name} 是运行时注册的，没有可写的 SKILL.md` } }
  }
  try {
    const result = setSkillEnabled({ path: skill.path, enabled })
    invalidateSnapshot()
    return { status: 200, payload: { ok: true, kind: 'skill', name, enabled, changed: result.changed, live: true, path: result.path } }
  } catch (error) {
    return { status: 400, payload: { ok: false, error: `技能开关失败：${error?.message ?? error}` } }
  }
}

/**
 * Enable or disable one global capability.
 * @returns {Promise<{status: number, payload: object}>}
 */
async function toggleGlobal(ctx, req) {
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
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (kind !== 'mcp' && kind !== 'skill') {
    return { status: 400, payload: { ok: false, error: 'kind 必须是 mcp 或 skill' } }
  }
  if (typeof body.enabled !== 'boolean') {
    return { status: 400, payload: { ok: false, error: 'enabled 必须是布尔值' } }
  }
  if (name === '') return { status: 400, payload: { ok: false, error: 'name 不能为空' } }
  return kind === 'mcp' ? toggleGlobalMcp(ctx, name, body.enabled) : toggleGlobalSkill(ctx, name, body.enabled)
}

// ---- vault (registered but inactive skills) -------------------------------

/**
 * Re-point a workspace's skill link after its target moved.
 *
 * A link written before the move still names the old directory; left alone it
 * dangles and the skill silently disappears from that workspace. Only links this
 * plugin would have written are touched — a real directory is never replaced.
 * @returns {boolean} whether a link was repaired
 */
function relinkWorkspaceSkill(workspaceDir, { name, from, to }) {
  const root = join(projectRootOf(workspaceDir), '.dsh', 'skills')
  for (const target of [join(root, name), join(root, `${name}.md`)]) {
    let stat
    try {
      stat = lstatSync(target)
    } catch {
      continue
    }
    if (!stat.isSymbolicLink()) continue
    let link
    try {
      link = readlinkSync(target)
    } catch {
      continue
    }
    if (pathKey(link) !== pathKey(from)) continue
    try {
      unlinkSync(target)
    } catch {
      try {
        rmdirSync(target)
      } catch {
        continue
      }
    }
    try {
      symlinkSync(to, target, /\.md$/i.test(target) ? 'file' : process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      // Best effort: the workspace view reports a dangling link as unassigned.
    }
    return true
  }
  return false
}

/** Repair every registered workspace that linked one of the moved skills. */
function relinkWorkspaces(ctx, moved) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || registry === null || typeof registry.list !== 'function') return
  let entries = []
  try {
    entries = registry.list() ?? []
  } catch {
    return
  }
  for (const entry of entries) {
    const dir = typeof entry?.path === 'string' && entry.path.length > 0 ? entry.path : null
    if (dir === null || !existsSync(dir)) continue
    for (const item of moved) relinkWorkspaceSkill(dir, item)
  }
}

/**
 * Move skills between the vault and the live user skill root.
 * @returns {Promise<{status: number, payload: object}>}
 */
async function changeVault(ctx, req) {
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
  const action = body.action
  if (action !== 'in' && action !== 'out' && action !== 'in-all') {
    return { status: 400, payload: { ok: false, error: 'action 必须是 in、out 或 in-all' } }
  }

  const moved = []
  const skipped = []
  if (action === 'in-all') {
    for (const skill of scanSkillRoots(sharedSkillRoots()).skills) {
      if (skill.source === 'bundled') {
        skipped.push({ name: skill.name, reason: 'bundled' })
        continue
      }
      const result = moveIntoVault(skill)
      if (!result.ok) {
        skipped.push({ name: skill.name, reason: result.error })
        continue
      }
      moved.push(result)
    }
  } else {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name === '') return { status: 400, payload: { ok: false, error: 'name 不能为空' } }
    if (action === 'in') {
      const skill = scanSkillRoots(sharedSkillRoots()).skills.find((item) => item.name === name)
      if (skill === undefined) return { status: 404, payload: { ok: false, error: `没有全局技能 ${name}` } }
      if (skill.source === 'bundled') {
        return { status: 400, payload: { ok: false, error: `随包技能 ${name} 不能移动（只读）` } }
      }
      const result = moveIntoVault(skill)
      if (!result.ok) {
        return { status: result.code === 'exists' ? 400 : 500, payload: { ok: false, error: result.error } }
      }
      moved.push(result)
    } else {
      const result = moveOutOfVault(name)
      if (!result.ok) {
        const status = result.code === 'missing' ? 404 : result.code === 'exists' ? 400 : 500
        return { status, payload: { ok: false, error: result.error } }
      }
      moved.push(result)
    }
  }

  if (moved.length > 0) relinkWorkspaces(ctx, moved)
  invalidateSnapshot()
  return { status: 200, payload: { ok: true, moved: moved.map((item) => item.name), skipped } }
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
      const installed = installedSkillPath(name)
      if (installed === undefined) {
        return {
          status: 404,
          payload: { ok: false, error: `没有可链接的已安装技能 ${name}（运行时注册的技能没有磁盘目录）` },
        }
      }
      // A skill on a machine-wide root already reaches every workspace. Linking
      // it here is not "enable for this workspace": it duplicates the skill and
      // cannot override a global `disable-model-invocation` flag. Refuse instead
      // of writing a link that lies.
      if (installed.scope === 'global') {
        return {
          status: 400,
          payload: {
            ok: false,
            error: `技能 ${name} 在全局根上，所有工作区已经可用；按工作区开关只对仓库技能有意义`,
          },
        }
      }
      result = assignSkill({ workspaceDir: dir, name, sourcePath: installed.path })
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

// ---- /inventory/sync/* --------------------------------------------------
//
// The sync half of this plugin. Every handler reads the cached snapshot rather
// than rebuilding one: publishing a manifest from a stale snapshot is no worse
// than from a fresh one (the user reviews the diff either way), while a full
// rebuild costs seconds and can race a write in flight.

/** Where a pulled plugin repository lives on this machine. */
function pluginRepoRoot(ctx) {
  const explicit = process.env.DSH_PLUGIN_REPO
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const home = homedir()
  return home === null ? null : join(home, '.dsh', 'plugin-repo')
}

/** Everything `applyItems` needs to actually install a selection. */
function installContext(ctx) {
  return {
    profileDir: resolveProfileDir(ctx),
    repoRoot: pluginRepoRoot(ctx),
    vaultDir: vaultDir(),
  }
}

async function handleSync(ctx, req) {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
  if (method !== 'GET') return { status: 405, payload: { ok: false, error: 'method-not-allowed' } }
  const snapshot = await getSnapshot(ctx, { refresh: true })
  const status = await syncStatus({ snapshot })
  return { status: 200, payload: status }
}

async function handleSyncConfig(ctx, req) {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
  if (method === 'GET') {
    const { readState, publicState } = await import('./lib/sync-state.js')
    return { status: 200, payload: { ok: true, state: publicState(readState()) } }
  }
  if (method !== 'POST') return { status: 405, payload: { ok: false, error: 'method-not-allowed' } }
  const body = await readBody(req)
  let patch
  try {
    patch = JSON.parse(body.length === 0 ? '{}' : body)
  } catch {
    return { status: 400, payload: { ok: false, error: '请求体不是合法 JSON' } }
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { status: 400, payload: { ok: false, error: '请求体必须是对象' } }
  }
  return { status: 200, payload: { ok: true, state: syncConfigure(patch) } }
}

async function handleSyncPreview(ctx) {
  const snapshot = await getSnapshot(ctx, { refresh: true })
  return { status: 200, payload: { ok: true, ...syncPreview({ snapshot }) } }
}

async function handleSyncApply(ctx, req) {
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
  if (method !== 'POST') return { status: 405, payload: { ok: false, error: 'method-not-allowed' } }
  const body = await readBody(req)
  let parsed
  try {
    parsed = JSON.parse(body.length === 0 ? '{}' : body)
  } catch {
    return { status: 400, payload: { ok: false, error: '请求体不是合法 JSON' } }
  }
  // `publish` and `apply` share this route: the body says which.
  if (parsed?.action === 'publish') {
    const snapshot = await getSnapshot(ctx, { refresh: true })
    const result = await syncPublish({ snapshot, options: { force: parsed.force === true } })
    return { status: result.ok === true ? 200 : 400, payload: result }
  }
  const snapshot = await getSnapshot(ctx, { refresh: true })
  const result = await syncApply({
    snapshot,
    selection: parsed?.selection,
    options: installContext(ctx),
  })
  if (result.applied > 0) invalidateSnapshot()
  return { status: result.ok === true ? 200 : 400, payload: result }
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

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: GLOBAL_ROUTE,
      handler: async (req, res) => {
        try {
          const { status, payload } = await toggleGlobal(ctx, req)
          sendJson(res, status, payload)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: `开关失败：${error?.message ?? error}` })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: VAULT_ROUTE,
      handler: async (req, res) => {
        try {
          const { status, payload } = await changeVault(ctx, req)
          sendJson(res, status, payload)
        } catch (error) {
          sendJson(res, 500, { ok: false, error: `仓库操作失败：${error?.message ?? error}` })
        }
      },
    }),
  )

  const syncRoutes = [
    { path: SYNC_ROUTE, handler: handleSync, label: '同步状态' },
    { path: SYNC_CONFIG_ROUTE, handler: handleSyncConfig, label: '同步配置' },
    { path: SYNC_PREVIEW_ROUTE, handler: handleSyncPreview, label: '清单预览' },
    { path: SYNC_APPLY_ROUTE, handler: handleSyncApply, label: '同步执行' },
  ]
  for (const route of syncRoutes) {
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: route.path,
        handler: async (req, res) => {
          try {
            const { status, payload } = await route.handler(ctx, req)
            sendJson(res, status, payload)
          } catch (error) {
            sendJson(res, 500, { ok: false, error: `${route.label}失败：${error?.message ?? error}` })
          }
        },
      }),
    )
  }
}
