/**
 * Offline preview: run the same collectors the plugin does, but with a stub
 * context whose `loader` is rebuilt from the profile's cordis.patch.yml.
 *
 * Useful to validate data shape (skills, packages, MCP rows, session edges)
 * without restarting DSH. The live tool registry is unavailable here, so tool
 * edges only cover MCP-server and CLI tiers.
 *
 * Usage: node scripts/preview.mjs [profileDir]
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { scanSkillRoots } from '../lib/scan-skills.js'
import { attachDeps, buildSkillDeps } from '../lib/skill-deps.js'
import { matchSkillTools } from '../lib/match-tools.js'
import { collectSkillToolEvidence } from '../lib/collect-sessions.js'
import { readSessionEvents } from '../lib/decode-session.js'
import { buildSnapshot } from '../lib/inventory.js'
import { CLI_NAMES } from '../lib/tool-owners.js'

const profileDir = process.argv[2] ?? join(homedir(), '.dsh', 'profiles', 'desktop')
const patchPath = join(profileDir, 'cordis.patch.yml')

/** Minimal patch reader: enough to recover inserted mcp-client rows. */
function readPatchRows(path) {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const blocks = text.split(/\n(?=\s*-\s+id:|\s*- insert:)/)
  const rows = []
  for (const block of blocks) {
    const id = /-\s+id:\s*(\S+)/.exec(block)?.[1]
    const name = /name:\s*['"]?([^'"\n]+)['"]?/.exec(block)?.[1]
    const serverName = /serverName:\s*['"]?([^'"\n]+)['"]?/.exec(block)?.[1]
    if (name === undefined) continue
    rows.push({
      id: id ?? name,
      name,
      enabled: !/disabled:\s*true/.test(block),
      fiberPhase: 'active',
      config: serverName === undefined ? undefined : { serverName, transport: /transport:\s*(\S+)/.exec(block)?.[1] },
    })
  }
  return rows
}

const rows = readPatchRows(patchPath)
const mcpServers = rows.filter((row) => row.name === '@deepseek-ai/dsh-mcp-client').map((row) => row.config.serverName)

const profile = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const bundles = profile?.dsh?.profile?.bundles ?? []
const dependencies = profile?.dependencies ?? {}
const packages = [...new Set([...Object.keys(dependencies), ...bundles])].map((pkgName) => {
  const installed = pkgName.startsWith('@deepseek-ai/') || existsSync(join(profileDir, 'node_modules', pkgName, 'package.json'))
  return {
    name: pkgName,
    spec: dependencies[pkgName],
    declaredBy: [dependencies[pkgName] ? 'dependencies' : 'bundles', bundles.includes(pkgName) ? 'bundles' : 'dependencies'].filter((v, i, a) => a.indexOf(v) === i),
    installed,
    loaded: rows.some((row) => row.name === pkgName),
  }
})

const { skills, diagnostics } = scanSkillRoots([
  { dir: join(process.cwd(), '.dsh', 'skills'), source: 'project-dsh', rank: 100 },
  { dir: join(homedir(), '.agents', 'skills'), source: 'user-agents', rank: 500 },
  { dir: join(homedir(), '.dsh', 'skills'), source: 'user-dsh', rank: 400 },
])

const skillEdges = []
for (const skill of skills) {
  for (const edge of matchSkillTools({ body: skill.body ?? '', toolNames: [], mcpServers, cliNames: CLI_NAMES })) {
    skillEdges.push({ skill: skill.name, ...edge })
  }
}

// Session evidence over the newest files, mirroring the host collector.
const sessionRoot = join(homedir(), '.dsh', 'sessions')
const sessionEdges = []
const merged = new Map()
const { readdirSync, statSync } = await import('node:fs')
for (const proj of readdirSync(sessionRoot, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue
  for (const sess of readdirSync(join(sessionRoot, proj.name), { withFileTypes: true })) {
    if (!sess.isDirectory()) continue
    const dir = join(sessionRoot, proj.name, sess.name)
    for (const file of readdirSync(dir)) {
      if (!file.includes('jsonl')) continue
      const full = join(dir, file)
      if (statSync(full).mtimeMs < Date.now() - 1000 * 60 * 60 * 24 * 30) continue
      try {
        const { events } = readSessionEvents(full)
        for (const row of collectSkillToolEvidence(events, { window: 8 })) {
          for (const [tool, count] of row.tools) {
            const key = `${row.skill}\u0000${tool}`
            merged.set(key, (merged.get(key) ?? 0) + count)
          }
        }
      } catch {
        // skip unreadable session
      }
    }
  }
}
for (const [key, count] of merged) {
  const [skill, tool] = key.split('\u0000')
  sessionEdges.push({ skill, tool, count })
}

const skillDeps = buildSkillDeps({ skills, roots: [join(process.cwd(), '.dsh', 'skills'), join(homedir(), '.agents', 'skills'), join(homedir(), '.dsh', 'skills')] })

const snapshot = buildSnapshot({
  now: Date.now(),
  profile: { dir: profileDir, bundles },
  packages,
  rows,
  skills: attachDeps(skills, skillDeps).map(({ body, ...rest }) => rest),
  tools: [],
  builtinTools: [],
  pluginTools: {},
  skillEdges,
  sessionEdges,
  warnings: [
    ...diagnostics.map((d) => ({ code: `skill-${d.kind}`, message: d.message ?? `${d.path}: ${d.reason}` })),
    ...skillDeps.missing.map((miss) => ({ code: 'skill-ref-missing', message: `技能引用缺失：${miss.from} → ${miss.to}` })),
  ],
})
snapshot.skillDeps = skillDeps.totals

console.log(JSON.stringify({
  counts: snapshot.counts,
  mcp: snapshot.mcp,
  packages: snapshot.packages.map((pkg) => `${pkg.orphan ? 'ORPHAN ' : ''}${pkg.name}@${pkg.version ?? '?'}`),
  skills: snapshot.skills.map((skill) => {
    const deps = skill.deps
    const suffix = deps === undefined ? '' : ` · ${deps.assets} assets · ${deps.refs} refs${deps.missing > 0 ? ` · ${deps.missing} MISSING` : ''}`
    return `${skill.disabled ? '[shadowed] ' : ''}${skill.name} (${skill.source})${suffix}`
  }),
  skillDeps: snapshot.skillDeps,
  edgesSample: snapshot.edges.slice(0, 40),
  warnings: snapshot.warnings,
}, null, 2))
