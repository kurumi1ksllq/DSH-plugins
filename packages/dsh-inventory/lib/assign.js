/**
 * dsh-inventory — workspace assignment, the plugin's only write path.
 *
 * "Assigning" a capability to a workspace means making that workspace declare it
 * for itself, because a per-workspace allowlist is not something DSH has:
 *   MCP   -> <workspace>/.dsh/mcp.json          read by `dsh-inventory/gate`
 *   skill -> <projectRoot>/.dsh/skills/<name>   a directory link to the install
 *
 * The skill target is the nearest `.git` ancestor (DSH's own project-root rule),
 * so the link lands where `@deepseek-ai/dsh-skill-filesystem` actually looks.
 * A link rather than a copy: the skill keeps tracking its single installation.
 *
 * No cordis, no network — plain node:fs, so this module is testable offline.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Declaration file the gate reads, relative to a workspace root. */
export const MCP_RELATIVE = join('.dsh', 'mcp.json')
/** Project skill root the filesystem skill provider scans. */
export const SKILLS_RELATIVE = join('.dsh', 'skills')

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function lstatOrUndefined(path) {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/**
 * Nearest directory holding `.git`, else `dir` itself.
 * Mirrors `findProjectRoot` in @deepseek-ai/dsh-skill-filesystem.
 */
export function projectRootOf(dir, { exists = existsSync } = {}) {
  let current = dir
  for (;;) {
    if (exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return dir
    current = parent
  }
}

/** Project skill root that a session whose cwd is inside `dir` would scan. */
export function skillRootOf(dir) {
  return join(projectRootOf(dir), SKILLS_RELATIVE)
}

/** Declaration file path for a workspace. */
export function mcpFileOf(dir) {
  return join(dir, MCP_RELATIVE)
}

/**
 * Read the declaration file without interpreting it.
 * @returns {{ok: true, doc: object, servers: object} | {ok: false, error: string, missing?: true}}
 */
export function readDeclaration(file, { readFile = (path) => readFileSync(path, 'utf8') } = {}) {
  let text
  try {
    text = readFile(file)
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, missing: true, error: `${file} 不存在` }
    return { ok: false, error: `读不到 ${file}：${error?.message ?? error}` }
  }
  let doc
  try {
    doc = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `${file} 不是合法 JSON：${error.message}` }
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: `${file} 的根节点必须是对象` }
  }
  const servers = doc.servers
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
    return { ok: false, error: `${file} 缺少 "servers" 对象` }
  }
  return { ok: true, doc, servers }
}

function writeDeclaration(file, doc) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}

/**
 * Declare one MCP server for a workspace.
 * @returns {{ok: true, path: string} | {ok: false, error: string}}
 */
export function assignMcp({ workspaceDir, name, server }) {
  const file = mcpFileOf(workspaceDir)
  const current = readDeclaration(file)
  let doc = { servers: {} }
  if (current.ok) {
    doc = current.doc
  } else if (!current.missing) {
    // Never overwrite a declaration we cannot read: that is the user's file.
    return { ok: false, error: current.error }
  }
  if (doc.servers[name] !== undefined) {
    return { ok: false, error: `MCP ${name} 已经声明在该工作区` }
  }
  doc.servers[name] = server
  writeDeclaration(file, doc)
  return { ok: true, path: file }
}

/**
 * Drop one MCP server from a workspace declaration; an emptied file is removed
 * so the workspace reads as "no declaration" instead of "declares nothing".
 * @returns {{ok: true, path: string} | {ok: false, error: string}}
 */
export function removeMcp({ workspaceDir, name }) {
  const file = mcpFileOf(workspaceDir)
  const current = readDeclaration(file)
  if (!current.ok) return { ok: false, error: current.error }
  if (current.servers[name] === undefined) {
    return { ok: false, error: `该工作区没有声明 MCP ${name}` }
  }
  delete current.servers[name]
  const rest = Object.keys(current.doc).filter((key) => key !== 'servers')
  if (Object.keys(current.servers).length === 0 && rest.length === 0) {
    unlinkSync(file)
    return { ok: true, path: file }
  }
  writeDeclaration(file, current.doc)
  return { ok: true, path: file }
}

/**
 * Link one installed skill into a workspace's project skill root.
 * @param {{workspaceDir: string, name: string, sourcePath: string}} input
 *   `sourcePath` is the installed `<dir>/SKILL.md` or the single `<name>.md`.
 * @returns {{ok: true, path: string} | {ok: false, error: string}}
 */
export function assignSkill({ workspaceDir, name, sourcePath }) {
  if (!SKILL_NAME.test(name)) return { ok: false, error: `技能名 ${name} 不合法` }
  const root = skillRootOf(workspaceDir)
  const single = !/[\\/]SKILL\.md$/i.test(sourcePath)
  const target = join(root, single ? `${name}.md` : name)
  const existing = lstatOrUndefined(target)
  if (existing !== undefined) {
    return { ok: false, error: `该工作区已经有技能 ${name}（${target}）` }
  }
  const link = single ? sourcePath : dirname(sourcePath)
  mkdirSync(root, { recursive: true })
  try {
    // A junction needs no elevation on Windows; a symlink does. Same result here.
    symlinkSync(link, target, single ? 'file' : process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    return { ok: false, error: `无法建立链接 ${target}：${error?.message ?? error}` }
  }
  return { ok: true, path: target }
}

/**
 * Remove a skill link created by `assignSkill`.
 *
 * Only links are removed: a real directory is somebody's installation (the
 * skills manager copies skills in) and deleting it here would lose content.
 * @returns {{ok: true, path: string} | {ok: false, error: string}}
 */
export function removeSkill({ workspaceDir, name }) {
  if (!SKILL_NAME.test(name)) return { ok: false, error: `技能名 ${name} 不合法` }
  const root = skillRootOf(workspaceDir)
  for (const target of [join(root, name), join(root, `${name}.md`)]) {
    const stat = lstatOrUndefined(target)
    if (stat === undefined) continue
    if (!stat.isSymbolicLink()) {
      return { ok: false, error: `${target} 不是本页建立的链接（可能是直接安装的目录），请用它自己的管理方式卸载` }
    }
    try {
      unlinkSync(target)
    } catch {
      // Windows keeps junctions until the directory entry itself is removed.
      rmdirSync(target)
    }
    return { ok: true, path: target }
  }
  return { ok: false, error: `该工作区没有技能 ${name}` }
}
