/**
 * Tool ownership inference for non-first-party plugins.
 *
 * `ctx.tools` records no registrant, so the only offline signal is the plugin's
 * own shipped code: a registered tool name appears as a quoted literal in the
 * package that registers it. We scan each installed third-party package once
 * and cache the result.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT_EXT = /\.(?:js|mjs|cjs)$/
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__', 'coverage', 'dist.map'])
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 12 * 1024 * 1024
const MAX_DEPTH = 4

function collectScripts(root, depth, files) {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectScripts(full, depth + 1, files)
      continue
    }
    if (!entry.isFile() || !SCRIPT_EXT.test(entry.name)) continue
    try {
      const stat = statSync(full)
      if (stat.size > 0 && stat.size <= MAX_FILE_BYTES) files.push(full)
    } catch {
      // ignore
    }
  }
}

/**
 * @param {{profileDir: string|null, packages: Array<{name: string, installed?: boolean}>,
 *          toolNames: string[], builtinTools?: string[], selfPackage?: string|null}} input
 * @returns {Record<string, string>} tool name -> owning package name
 */
export function buildPluginToolIndex({ profileDir, packages, toolNames, builtinTools = [], selfPackage = null }) {
  const index = {}
  if (typeof profileDir !== 'string' || profileDir.length === 0) return index
  const builtin = new Set(builtinTools)
  const pending = toolNames.filter((name) => typeof name === 'string' && !builtin.has(name) && !name.startsWith('mcp__'))
  if (pending.length === 0) return index

  const targets = packages.filter(
    (pkg) =>
      pkg &&
      typeof pkg.name === 'string' &&
      pkg.name !== selfPackage &&
      !pkg.name.startsWith('@deepseek-ai/') &&
      pkg.installed !== false,
  )

  // A declaration site (`name: 'x'`, `registerTool('x')`) is real evidence; a
  // bare quoted mention is only a guess (bridge name lists, docs examples).
  const strong = (text, name) =>
    new RegExp(`name\\s*:\\s*['"]${name}['"]`).test(text) || new RegExp(`registerTool\\s*\\(\\s*['"]${name}['"]`).test(text)
  const weak = (text, name) => text.includes(`'${name}'`) || text.includes(`"${name}"`)

  const loaded = []
  for (const pkg of targets) {
    const root = join(profileDir, 'node_modules', pkg.name)
    const files = []
    collectScripts(root, 0, files)
    if (files.length === 0) continue
    let text = ''
    for (const file of files) {
      if (text.length > MAX_TOTAL_BYTES) break
      try {
        text += readFileSync(file, 'utf8')
      } catch {
        // ignore unreadable file
      }
    }
    loaded.push({ name: pkg.name, text })
  }

  for (const { name, text } of loaded) {
    const stillPending = pending.filter((tool) => index[tool] === undefined)
    if (stillPending.length === 0) break
    for (const tool of stillPending) if (strong(text, tool)) index[tool] = name
  }
  for (const { name, text } of loaded) {
    const stillPending = pending.filter((tool) => index[tool] === undefined)
    if (stillPending.length === 0) break
    for (const tool of stillPending) if (weak(text, tool)) index[tool] = name
  }
  return index
}
