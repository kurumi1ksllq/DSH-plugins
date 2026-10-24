/**
 * Local skill discovery.
 *
 * `ctx.skills.list()` only reports the winning candidates, so a skill that is
 * installed but carries `disable-model-invocation: true` (this machine's
 * office-* stubs) never appears there. The inventory therefore scans the same
 * roots on disk: depth 1 only, `<root>/<name>/SKILL.md` or `<root>/<name>.md`,
 * mirroring `@deepseek-ai/dsh-skill-filesystem`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Default roots with the ranks the filesystem provider documents. */
export const DEFAULT_SKILL_ROOTS = [
  { source: 'project-dsh', rank: 100, dir: '.dsh/skills' },
  { source: 'project-agents', rank: 200, dir: '.agents/skills' },
  { source: 'user-dsh', rank: 400, dir: 'skills' },
  { source: 'user-agents', rank: 500, dir: 'skills' },
  { source: 'bundled', rank: 600, dir: '.system/skills' },
]

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Parse YAML frontmatter with the tiny subset skills actually use: `key: value`
 * pairs, quoted strings, inline booleans. Nested maps are accepted but not
 * interpreted — no shipped skill depends on them.
 * @param {string} source - markdown text.
 * @returns {Record<string, unknown> & {body?: string}}
 */
export function parseFrontmatter(source) {
  // Windows editors write CRLF; the `\n---` delimiter probe below relies on LF.
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!text.startsWith('---')) return { body: source }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { body: source }
  const raw = text.slice(3, end)
  const body = text.slice(end + 4).replace(/^\r?\n/, '')
  const data = {}
  let lastKey = null
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (!match) {
      // Continuation line of a folded value: append to the last scalar.
      if (lastKey !== null && typeof data[lastKey] === 'string') data[lastKey] += ' ' + line.trim()
      continue
    }
    const [, key, rest] = match
    lastKey = key
    data[key] = parseScalar(rest)
  }
  return { ...data, body }
}

function parseScalar(raw) {
  const value = raw.trim()
  if (value.length === 0) return ''
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  if (/^(true|yes|on)$/i.test(value)) return true
  if (/^(false|no|off)$/i.test(value)) return false
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}

/**
 * Scan skill roots, resolving duplicate names by rank (lower wins).
 * @param {Array<{dir: string, source: string, rank: number}>} roots
 * @param {{readText?: (file: string) => string}} [options] - injectable reader (tests).
 * @returns {{skills: object[], diagnostics: object[]}}
 */
export function scanSkillRoots(roots, { readText = (file) => readFileSync(file, 'utf8') } = {}) {
  const byName = new Map()
  const diagnostics = []
  const ordered = roots
    .filter((root) => root !== null && typeof root === 'object' && typeof root.rank === 'number')
    .sort((a, b) => a.rank - b.rank)

  for (const root of ordered) {
    if (!root || typeof root.dir !== 'string' || !existsSync(root.dir)) continue
    let entries
    try {
      entries = readdirSync(root.dir, { withFileTypes: true })
    } catch (error) {
      diagnostics.push({ kind: 'unreadable-root', dir: root.dir, message: String(error && error.message) })
      continue
    }
    for (const entry of entries) {
      const full = join(root.dir, entry.name)
      // Follow symlinks/junctions: skills are often linked in from a vault.
      let kind = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : null
      if (kind === null) {
        try {
          const followed = statSync(full)
          kind = followed.isDirectory() ? 'dir' : followed.isFile() ? 'file' : null
        } catch {
          continue
        }
      }
      let skillPath = null
      if (kind === 'dir') {
        const candidate = join(full, 'SKILL.md')
        if (existsSync(candidate)) skillPath = candidate
      } else if (kind === 'file' && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'SKILL.md') {
        skillPath = full
      }
      if (skillPath === null) continue

      let stat
      try {
        stat = statSync(skillPath)
      } catch {
        continue
      }
      if (!stat.isFile()) continue

      let text
      try {
        text = readText(skillPath)
      } catch (error) {
        // One unreadable file must not fail the whole snapshot.
        diagnostics.push({ kind: 'unreadable-file', path: skillPath, message: String(error?.message ?? error) })
        continue
      }
      const parsed = parseFrontmatter(text)
      const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
      const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
      if (!SKILL_NAME.test(name)) {
        diagnostics.push({ kind: 'invalid-frontmatter', path: skillPath, reason: 'invalid or missing name' })
        continue
      }
      if (description.length === 0) {
        diagnostics.push({ kind: 'invalid-frontmatter', path: skillPath, reason: 'missing description' })
        continue
      }

      const modelInvocable = parsed['disable-model-invocation'] !== true
      const userInvocable = parsed['user-invocable'] !== false
      const candidate = {
        name,
        description,
        whenToUse: typeof parsed.whenToUse === 'string' ? parsed.whenToUse : undefined,
        path: skillPath,
        source: root.source,
        rank: root.rank,
        modelInvocable,
        userInvocable,
        disabled: !modelInvocable,
        bodyBytes: parsed.body ? parsed.body.length : 0,
        body: parsed.body ?? '',
      }

      const existing = byName.get(name)
      if (existing === undefined) {
        byName.set(name, candidate)
        continue
      }
      diagnostics.push({
        kind: 'duplicate',
        name,
        path: skillPath,
        winner: existing.path,
        message: `${name} from ${root.source} is shadowed by rank ${existing.rank}`,
      })
    }
  }

  const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  // Bodies stay attached for the edge matcher; the HTTP layer strips them.
  return { skills, diagnostics }
}
