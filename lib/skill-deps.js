/**
 * Skill → asset dependency graph.
 *
 * A skill is not only its SKILL.md: a router skill keeps its second level in
 * `refs/`, and those files reference each other. The inventory used to see
 * only `<root>/<name>/SKILL.md`, so everything under `refs/` was invisible —
 * you could not tell what depends on what, nor which reference points at a
 * file that no longer exists.
 *
 * This module reads every skill body plus every `.md` under its `refs/` tree,
 * extracts the local paths they mention, resolves them against the skill
 * directory and the skills roots, and reports which ones are missing.
 *
 * Extraction is deliberately conservative: a wrong edge is worse than a
 * missing one. Only explicit path shapes count — a drive-letter absolute path,
 * a known asset prefix (`refs/`, `references/`, `scripts/`, …), a `../`
 * relative path, or a markdown link target. Command snippets, URLs, XML paths
 * (`/body/p[1]`) and bare filenames are ignored.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'

const ASSET_PREFIXES = ['refs/', 'reference/', 'references/', 'scripts/', 'assets/', 'templates/']
const EXT = /\.(?:md|py|sh|json|txt|yaml|yml|ps1|mjs|cjs|js)$/i

/** Reject anything that cannot be a local asset path. */
function clean(raw) {
  let text = String(raw).trim().replace(/^[<("'`]+/, '')
  // Full-width punctuation and CJK sentence marks end a path; drive letters use
  // ASCII colons only, so splitting on the full-width forms is safe.
  text = text.split(/[）)，、；：。]|<\/|\)/)[0].trim()
  text = text.replace(/[>)"'`.,;]+$/, '')
  if (text.length === 0 || text.length > 300) return null
  if (/[\s<>{}[\]*$|"'`]/.test(text)) return null
  if (text.startsWith('/')) return null
  // A bare directory mention (`reference/`) is a heading, not an asset.
  if (/[\\/]$/.test(text) && !EXT.test(text)) return null
  if (/^[a-z]+:\/\//i.test(text) || (text.includes(':/') && !/^[A-Za-z]:[\\/]/.test(text))) return null
  if (!/[\\/]/.test(text) && !EXT.test(text)) return null
  if (!EXT.test(text) && !ASSET_PREFIXES.some((prefix) => text.replace(/\\/g, '/').startsWith(prefix))) return null
  return text
}

/** Every path-looking token in a markdown body. */
export function extractRefs(body) {
  const out = new Set()
  const push = (raw) => {
    const text = clean(raw)
    if (text !== null) out.add(text)
  }
  for (const match of body.matchAll(/`([^`\n]+)`/g)) push(match[1])
  for (const match of body.matchAll(/\]\(([^)\n]+)\)/g)) push(match[1])
  for (const match of body.matchAll(/([A-Za-z]:\\[^\s`'"()<>|]+)/g)) push(match[1])
  for (const match of body.matchAll(/(?:^|[\s(])((?:\.\.\/)+[^\s`'"()<>|]+)/gm)) push(match[1])
  for (const match of body.matchAll(/(?:^|[\s(])((?:refs|reference|references|scripts|assets|templates)[\\/][^\s`'"()<>|]+)/gm)) push(match[1])
  for (const match of body.matchAll(/(?:^|[\s(])(skills[\\/][a-z0-9-]+[\\/]SKILL\.md)/gm)) push(match[1])
  return [...out]
}

/** Resolve one token to an absolute path, or null when it is not a local asset. */
export function resolveRef(token, { fileDir, skillDir, skillsRoot }) {
  const cleaned = token.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(cleaned)) return normalize(cleaned)
  if (cleaned.startsWith('skills/')) return normalize(join(skillsRoot, cleaned.slice('skills/'.length)))
  if (cleaned.startsWith('../')) return normalize(join(fileDir, cleaned))
  if (ASSET_PREFIXES.some((prefix) => cleaned.startsWith(prefix))) {
    // Reference files often name their own folder again (`reference/styles`
    // written inside `reference/`). Drop one redundant prefix before joining.
    const prefix = ASSET_PREFIXES.find((item) => cleaned.startsWith(item))
    const dirTail = fileDir.replace(/\\/g, '/').split('/').pop()
    const bare = prefix.slice(0, -1)
    if (dirTail === bare) return normalize(join(fileDir, cleaned.slice(prefix.length)))
    return normalize(join(fileDir, cleaned))
  }
  if (!/[\\/]/.test(cleaned) && EXT.test(cleaned)) {
    // A bare filename in a table cell: only count it when the file is really
    // there, so prose like `style.md` never turns into a false missing edge.
    const bases = [fileDir, join(skillDir, 'refs'), join(skillDir, 'references'), skillDir]
    for (const base of bases) {
      const candidate = normalize(join(base, cleaned))
      if (existsSync(candidate)) return candidate
    }
    return null
  }
  return null
}

const lower = (value) => value.toLowerCase().split(sep).join('/')

/** True when `file` lives inside `root` (case-insensitive, Windows-safe). */
export function inside(root, file) {
  const r = lower(normalize(root)).replace(/\/+$/, '')
  const f = lower(normalize(file))
  return f === r || f.startsWith(r + '/')
}

function walkMarkdown(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkMarkdown(full, out)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full)
  }
  return out
}

const rel = (root, file) => relative(root, file).replace(/\\/g, '/')

/**
 * Build the dependency graph.
 * @param {{skills: Array<{name: string, path: string}>, roots: string[], readText?: (file: string) => string}} input
 */
export function buildSkillDeps({ skills, roots, readText = (file) => readFileSync(file, 'utf8') }) {
  const skillRoots = roots.filter((root) => typeof root === 'string' && root.length > 0)
  const bySkill = {}
  const edges = []
  const missing = []
  const nodes = new Map()

  for (const skill of skills) {
    if (typeof skill?.path !== 'string') continue
    const skillDir = dirname(skill.path)
    const root = skillRoots.find((candidateRoot) => inside(candidateRoot, skill.path)) ?? skillDir
    const files = [{ file: skill.path, kind: 'skill' }]
    for (const file of walkMarkdown(join(skillDir, 'refs'))) files.push({ file, kind: 'ref' })

    const skillEdges = []
    for (const { file, kind } of files) {
      let body = ''
      try {
        body = readText(file)
      } catch {
        continue
      }
      const from = rel(root, file)
      if (!nodes.has(from)) nodes.set(from, { id: from, kind, path: file, exists: true })
      const fileDir = dirname(file)
      for (const token of extractRefs(body)) {
        const target = resolveRef(token, { fileDir, skillDir, skillsRoot: root })
        if (target === null || !inside(root, target)) continue
        const exists = existsSync(target)
        const to = rel(root, target)
        if (to === from) continue
        if (!nodes.has(to)) nodes.set(to, { id: to, kind: 'ref', path: target, exists })
        if (edges.some((edge) => edge.from === from && edge.to === to)) continue
        const edge = { from, to, exists }
        edges.push(edge)
        skillEdges.push(edge)
        if (!exists) missing.push({ skill: skill.name, ...edge })
      }
    }

    bySkill[skill.name] = {
      assets: files.length,
      refs: skillEdges.length,
      missing: skillEdges.filter((edge) => !edge.exists).length,
      files: files.map((item) => rel(root, item.file)),
      edges: skillEdges,
    }
  }

  return {
    bySkill,
    edges,
    missing,
    nodes: [...nodes.values()],
    totals: {
      skills: Object.keys(bySkill).length,
      assets: nodes.size,
      edges: edges.length,
      missing: missing.length,
    },
  }
}

/** Compact per-skill view attached to each skill row in the snapshot. */
export function attachDeps(skills, graph) {
  return skills.map((skill) => {
    const entry = graph.bySkill[skill.name]
    if (entry === undefined) return skill
    return {
      ...skill,
      deps: { assets: entry.assets, refs: entry.refs, missing: entry.missing, edges: entry.edges },
    }
  })
}
