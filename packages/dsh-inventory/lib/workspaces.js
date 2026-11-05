/**
 * dsh-inventory — per-workspace view.
 *
 * The global snapshot answers "what does this installation have". This module
 * answers "what does *this workspace* see": the MCP servers its `.dsh/mcp.json`
 * declares (listed next to the globally registered ones), and the skills
 * reachable from its project roots, grouped by source.
 *
 * Everything here is read-only and offline-testable: no cordis import, no
 * network, no writes.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { dshHome } from './dsh-home.js'
import { scanSkillRoots } from './scan-skills.js'
import { projectRootOf } from './assign.js'
import { normalizeDir, planMount } from './workspace-gate.js'

/**
 * The workspace DSH itself falls back to for a session without one.
 *
 * The workspace registry only reports live entries; the default identity and its
 * record live in DSH's own storage (`$DSH_HOME/storages/workspace.json`,
 * `global.defaultWorkspaceId` + `tables.workspaces[id]`). Reading that file keeps
 * the default workspace in the panel even when the registry service is missing or
 * does not list it.
 * @returns {{id: string, path?: string, title?: string} | undefined}
 */
export function readDefaultWorkspace({ dshHome: dshHomeOverride = dshHome() } = {}) {
  let doc
  try {
    doc = JSON.parse(readFileSync(join(dshHomeOverride, 'storages', 'workspace.json'), 'utf8'))
  } catch {
    return undefined
  }
  const id = doc?.global?.defaultWorkspaceId
  if (typeof id !== 'string' || id.length === 0) return undefined
  const record = doc?.tables?.workspaces?.[id]
  const path = typeof record?.path === 'string' && record.path.length > 0 ? record.path : undefined
  const title = typeof record?.title === 'string' && record.title.length > 0 ? record.title : undefined
  return { id, path, title }
}

/**
 * Skill roots that resolve the same for every workspace (user scope).
 * Mirrors `skillRootsFor` in index.js, minus the project-scoped entries.
 */
export function sharedSkillRoots() {
  const home = homedir()
  const dshHomeDir = dshHome()
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(home, '.agents')
  const roots = []
  const custom = (process.env.DSH_CUSTOM_SKILL_DIRS ?? '').split(delimiter).filter(Boolean)
  custom.forEach((dir, index) => roots.push({ dir, source: 'custom', rank: 300 + index }))
  roots.push({ dir: join(dshHomeDir, 'skills'), source: 'user-dsh', rank: 400 })
  roots.push({ dir: join(agentsHome, 'skills'), source: 'user-agents', rank: 500 })
  if (process.env.DSH_BUNDLED_SKILL_DIR) {
    roots.push({ dir: process.env.DSH_BUNDLED_SKILL_DIR, source: 'bundled', rank: 600 })
  }
  return roots
}

/** Project-scoped skill roots for one workspace directory.
 *
 * DSH resolves the project root as the nearest `.git` ancestor, so a workspace
 * nested inside a repository shares the repository's skill roots. The view must
 * show those same roots: an assigned link written there has to be visible here,
 * or a successful assignment looks like a no-op.
 */
export function projectSkillRoots(dir) {
  const root = projectRootOf(dir)
  return [
    { dir: join(root, '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
    { dir: join(root, '.agents', 'skills'), source: 'project-agents', rank: 200 },
  ]
}

/** True when this skill is a link this plugin created (so removal is safe). */
function isLinkedSkill(skill) {
  const target = /[\\/]SKILL\.md$/i.test(skill.path) ? dirname(skill.path) : skill.path
  try {
    return lstatSync(target).isSymbolicLink()
  } catch {
    return false
  }
}

function summarizeSkill(skill) {
  return {
    name: skill.name,
    description: typeof skill.description === 'string' ? skill.description : '',
    path: skill.path,
    modelInvocable: skill.modelInvocable !== false,
    shadowed: skill.disabled === true,
    linked: isLinkedSkill(skill),
    bodyBytes: typeof skill.bodyBytes === 'number' ? skill.bodyBytes : 0,
  }
}

function scanGroup(roots, scan) {
  const groups = []
  for (const root of roots) {
    let skills = []
    let diagnostics = []
    try {
      const result = scan([root])
      skills = Array.isArray(result?.skills) ? result.skills : []
      diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : []
    } catch {
      // An unreadable root is reported as an empty group, never a failed page.
    }
    groups.push({
      source: root.source,
      dir: root.dir,
      rank: root.rank,
      exists: existsSync(root.dir),
      skills: skills.map(summarizeSkill).sort((a, b) => a.name.localeCompare(b.name)),
      diagnostics: diagnostics.map((entry) => ({ kind: entry.kind, message: entry.message })),
    })
  }
  return groups
}

/**
 * Read the MCP declaration of one workspace directory.
 * @param {string} dir absolute workspace directory
 * @param {{serverNameSuffix?: string}} [options]
 * @returns {{status: 'ok'|'missing'|'invalid', file: string|null, servers: object[], error?: string}}
 */
export function readWorkspaceMcp(dir, { serverNameSuffix = '' } = {}) {
  let plan
  try {
    plan = planMount(dir, { serverNameSuffix })
  } catch (error) {
    return { status: 'invalid', file: null, servers: [], error: String(error?.message ?? error) }
  }
  if (plan.mount === true) {
    const servers = Object.entries(plan.servers).map(([name, config]) => ({
      name,
      mountedAs: config.serverName,
      transport: config.transport,
      detail: config.transport === 'stdio' ? config.command : config.url,
    }))
    return { status: 'ok', file: plan.file ?? null, servers }
  }
  // A valid declaration with zero entries reads as an empty "ok", not a parse
  // failure: the file exists and says "this workspace declares nothing" (#74).
  if (plan.empty === true) return { status: 'ok', file: plan.file ?? null, servers: [] }
  if (plan.file === undefined) return { status: 'missing', file: null, servers: [] }
  return { status: 'invalid', file: plan.file, servers: [], error: plan.reason }
}

/**
 * Build the per-workspace section of the snapshot.
 *
 * Shared (user-scope) skill roots are scanned once and reused by reference, so
 * a machine with N workspaces does not pay N times for `~/.dsh/skills`.
 *
 * @param {object} input
 * @param {object} [input.registry] the `workspaceRegistry` service
 * @param {string[]} [input.globalMcp] serverNames registered globally
 * @param {string} [input.serverNameSuffix] suffix the gate adds to mounted names
 * @param {{id?: string, path?: string, title?: string}} [input.defaultWorkspace] DSH's default workspace
 * @param {object[]} [input.warnings] collected diagnostics
 * @param {Function} [input.scan] skill scanner (injectable for tests)
 */
export function collectWorkspaces({
  registry,
  globalMcp = [],
  serverNameSuffix = '',
  defaultWorkspace,
  warnings = [],
  scan = scanSkillRoots,
} = {}) {
  const entries = []
  let registryAvailable = false
  if (registry !== undefined && registry !== null && typeof registry.list === 'function') {
    try {
      entries.push(...(registry.list() ?? []))
      registryAvailable = true
    } catch (error) {
      warnings.push({ code: 'workspaces-list-failed', message: String(error?.message ?? error) })
    }
  }
  if (!registryAvailable) {
    warnings.push({
      code: 'workspaces-unavailable',
      message: 'workspaceRegistry 服务不可用，按工作区的视图为空',
    })
  }

  const shared = scanGroup(sharedSkillRoots(), scan)
  const sharedCount = shared.reduce((sum, group) => sum + group.skills.length, 0)

  const defaultId = typeof defaultWorkspace?.id === 'string' && defaultWorkspace.id.length > 0 ? defaultWorkspace.id : undefined
  const rows = []
  for (const entry of entries) {
    const dir = typeof entry?.path === 'string' && entry.path.length > 0 ? entry.path : undefined
    if (dir === undefined) continue
    let title = ''
    try {
      title = typeof entry.title === 'string' ? entry.title : ''
    } catch {
      title = ''
    }
    rows.push({ id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : dir, title, path: dir })
  }
  // The default workspace belongs in the list even when the registry does not
  // report it (a fresh install keeps its record in the workspace storage only),
  // and it is always first: it is the workspace every new session falls back to.
  if (defaultId !== undefined && !rows.some((row) => row.id === defaultId)) {
    const dir = typeof defaultWorkspace?.path === 'string' && defaultWorkspace.path.length > 0 ? defaultWorkspace.path : undefined
    if (dir !== undefined) {
      rows.push({ id: defaultId, title: typeof defaultWorkspace.title === 'string' ? defaultWorkspace.title : '', path: dir })
    }
  }
  if (defaultId !== undefined) {
    rows.sort((left, right) => Number(right.id === defaultId) - Number(left.id === defaultId))
  }

  const workspaces = []
  for (const row of rows) {
    const dir = row.path
    const available = existsSync(dir)
    const mcp = readWorkspaceMcp(dir, { serverNameSuffix })
    const project = scanGroup(projectSkillRoots(dir), scan)
    const projectCount = project.reduce((sum, group) => sum + group.skills.length, 0)
    workspaces.push({
      id: row.id,
      title: row.title.length > 0 ? row.title : dir,
      path: normalizeDir(dir),
      available,
      default: defaultId !== undefined && row.id === defaultId,
      mcp,
      // Only the workspace's own project roots: shared roots are identical for
      // every workspace, so repeating them in all 14 cards is what made the
      // page unreadable. They are reported once as `sharedSkills`.
      skills: project,
      counts: { declared: mcp.servers.length, projectSkills: projectCount, sharedSkills: sharedCount },
    })
  }

  return {
    workspaces,
    globalMcp,
    defaultWorkspaceId: defaultId ?? null,
    sharedSkills: shared,
    sharedSkillCount: sharedCount,
    registryAvailable,
  }
}
