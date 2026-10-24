/**
 * Snapshot assembly: merge the four inventory surfaces into one JSON payload.
 *
 * Pure function — no Cordis, no filesystem, no clock beyond `input.now`. The
 * host plugin collects the raw inputs and hands them here, which keeps the
 * merge logic testable offline.
 */

const SECRET_KEY = /(api[-_]?key|secret|token|passw|bearer|credential|authorization|private[-_]?key)/i
const SECRET_FLAG = /^--?[A-Za-z0-9-]*(key|token|secret|passw|credential)[A-Za-z0-9-]*$/i
const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'
const REDACTED = '<redacted>'

/** Redact one argument value: header form, env form, inline flag, opaque token. */
function redactValue(value) {
  const header = /^([A-Za-z0-9-]+):\s+(.+)$/.exec(value)
  if (header !== null && SECRET_KEY.test(header[1])) return `${header[1]}: ${REDACTED}`

  const env = /^([A-Za-z0-9_]+)=(.+)$/.exec(value)
  if (env !== null && SECRET_KEY.test(env[1])) return `${env[1]}=${REDACTED}`

  const flag = /^(--?[A-Za-z0-9-]+)=(.+)$/.exec(value)
  if (flag !== null && SECRET_KEY.test(flag[1])) return `${flag[1]}=${REDACTED}`

  // A long path stays readable (it is not a secret); a long opaque token is masked.
  if (value.length > 40 && !/[/\\]/.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value)) {
    return `${value.slice(0, 6)}…${REDACTED}`
  }
  return value
}

/** Redact `--flag value` pairs embedded in a command line. */
function redactCommand(command) {
  if (typeof command !== 'string') return command
  return command.replace(
    /(--?[A-Za-z0-9-]*(?:key|token|secret|passw|credential)[A-Za-z0-9-]*)(?:=|\s+)(\S+)/gi,
    (_match, flag) => `${flag} ${REDACTED}`,
  )
}

/** Redact secret-looking argument pairs and long opaque tokens. */
function redactArgs(args) {
  if (!Array.isArray(args)) return undefined
  const out = []
  let hideNext = false
  for (const raw of args) {
    const value = String(raw)
    if (hideNext) {
      out.push(REDACTED)
      hideNext = false
      continue
    }
    out.push(redactValue(value))
    if (SECRET_FLAG.test(value)) hideNext = true
  }
  return out
}

/** Project a loader row config onto display-safe fields. */
export function summarizeConfig(config) {
  if (config === null || typeof config !== 'object') return undefined
  const summary = {}
  const keep = ['serverName', 'transport', 'cwd', 'toolCallTimeoutMs', 'failOnStartupError', 'enabled']
  for (const key of keep) if (config[key] !== undefined) summary[key] = config[key]
  if (typeof config.command === 'string') summary.command = redactCommand(config.command)
  if (Array.isArray(config.args)) summary.args = redactArgs(config.args)
  if (typeof config.url === 'string') {
    summary.url = config.url.replace(/([?&](?:key|token|apikey|api_key|secret)=)[^&]*/gi, `$1${REDACTED}`)
  }
  const dropped = ['env', 'headers'].filter((key) => config[key] !== undefined)
  if (dropped.length > 0) summary.redacted = dropped
  return Object.keys(summary).length > 0 ? summary : undefined
}

function ownerOf(name, { builtin, pluginTools }) {
  if (typeof name !== 'string' || name.length === 0) return { kind: 'unknown', ref: null }
  if (name.startsWith('mcp__')) return { kind: 'mcp', ref: name.slice(5).split('__')[0] }
  if (builtin.has(name)) return { kind: 'builtin', ref: 'deepseek-harness' }
  if (pluginTools[name]) return { kind: 'plugin', ref: pluginTools[name] }
  return { kind: 'unknown', ref: null }
}

/**
 * Build the snapshot served at `GET /inventory/snapshot`.
 * @param {object} input - raw inputs.
 * @returns {object} snapshot payload.
 */
export function buildSnapshot(input) {
  const generatedAt = input.now ?? Date.now()
  const warnings = [...(input.warnings ?? [])]
  const builtin = new Set(input.builtinTools ?? [])
  const pluginTools = input.pluginTools ?? {}

  const packages = (input.packages ?? []).map((pkg) => ({
    ...pkg,
    orphan: pkg.installed === false,
  }))
  for (const pkg of packages) {
    if (pkg.orphan) {
      warnings.push({
        code: 'orphan-package',
        message: `${pkg.name} 已在 profile 中声明，但 node_modules 里没有可解析的安装`,
      })
    }
  }

  const tools = (input.tools ?? []).map((tool) => ({
    ...tool,
    owner: ownerOf(tool.name, { builtin, pluginTools }),
  }))

  const rows = (input.rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled !== false,
    fiberPhase: row.fiberPhase ?? null,
    group: row.group === true,
    ...(row.config === undefined ? {} : { config: summarizeConfig(row.config) }),
  }))

  const mcp = (input.rows ?? [])
    .filter((row) => row.name === MCP_CLIENT_MODULE)
    .map((row) => {
      const config = row.config && typeof row.config === 'object' ? row.config : {}
      const server = typeof config.serverName === 'string' ? config.serverName : row.id
      const prefix = `mcp__${server}__`
      const toolNames = tools.filter((tool) => tool.name.startsWith(prefix)).map((tool) => tool.name)
      const status = toolNames.length > 0 ? 'connected' : row.fiberPhase === 'failed' ? 'failed' : 'no-tools'
      if (status === 'no-tools') {
        warnings.push({ code: 'mcp-no-tools', message: `MCP 服务器 ${server} 已配置，但当前没有可用工具` })
      }
      if (status === 'failed') {
        warnings.push({ code: 'mcp-failed', message: `MCP 服务器 ${server} 的连接条目启动失败` })
      }
      return {
        entryId: row.id,
        server,
        transport: config.transport,
        command: typeof config.command === 'string' ? config.command : undefined,
        url: typeof config.url === 'string' ? summarizeConfig({ url: config.url }).url : undefined,
        enabled: row.enabled !== false,
        fiberPhase: row.fiberPhase ?? null,
        status,
        toolCount: toolNames.length,
        toolNames,
      }
    })

  // ---- edges -------------------------------------------------------------
  const edgeMap = new Map()
  const keyOf = (skill, id) => `${skill}\u0000${id}`
  const ensureEdge = (skill, id, kind, confidence, sample) => {
    const key = keyOf(skill, id)
    let edge = edgeMap.get(key)
    if (edge === undefined) {
      edge = {
        skill,
        id,
        kind,
        confidence,
        evidence: { sources: [], count: 0, sample: sample ?? null },
      }
      edgeMap.set(key, edge)
    } else if (sample !== null && sample !== undefined && edge.evidence.sample === null) {
      edge.evidence.sample = sample
    }
    return edge
  }

  for (const edge of input.skillEdges ?? []) {
    const target = ensureEdge(edge.skill, edge.id, edge.kind, edge.confidence, edge.evidence)
    if (!target.evidence.sources.includes('static')) target.evidence.sources.push('static')
  }
  for (const edge of input.sessionEdges ?? []) {
    const target = ensureEdge(edge.skill, edge.tool, 'tool', 'observed', null)
    if (!target.evidence.sources.includes('session')) target.evidence.sources.push('session')
    target.evidence.count += edge.count ?? 0
    // A session-only edge has no source text to quote; state the observation
    // itself so the card is never count-without-evidence.
    if (target.evidence.sample === null) {
      target.evidence.sample = `${target.evidence.count} call(s) observed in session logs after loading this skill`
    }
  }

  const edges = [...edgeMap.values()]
  const edgesBySkill = new Map()
  for (const edge of edges) {
    if (!edgesBySkill.has(edge.skill)) edgesBySkill.set(edge.skill, [])
    edgesBySkill.get(edge.skill).push(edge)
  }

  const skills = (input.skills ?? []).map((skill) => ({
    ...skill,
    edges: edgesBySkill.get(skill.name) ?? [],
  }))

  return {
    generatedAt,
    profile: input.profile ?? null,
    packages,
    rows,
    mcp,
    skills,
    tools,
    edges,
    counts: {
      packages: packages.length,
      orphanPackages: packages.filter((pkg) => pkg.orphan).length,
      rows: rows.length,
      mcp: mcp.length,
      mcpConnected: mcp.filter((entry) => entry.status === 'connected').length,
      skills: skills.length,
      shadowedSkills: skills.filter((skill) => skill.disabled).length,
      tools: tools.length,
      edges: edges.length,
    },
    warnings,
  }
}
