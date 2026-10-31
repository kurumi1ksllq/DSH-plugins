/**
 * Skill -> tool edge matching.
 *
 * Frontmatter has no tool declaration, so edges come from the skill body text
 * in three confidence tiers:
 *   L1 exact registered tool name (e.g. `mcp__officecli__officecli`) — high
 *   L2 MCP server name (e.g. `davinci-resolve`)                     — medium
 *   L3 external command name (e.g. `vmrun`)                        — low
 */

/** Build a word-boundary regex for a token that may contain `-` and `_`. */
function tokenRegex(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`)
}

function snippet(body, at, length) {
  const from = Math.max(0, at - 20)
  const to = Math.min(body.length, at + length + 40)
  return body.slice(from, to).replace(/\s+/g, ' ').trim().slice(0, 120)
}

/**
 * Match one skill body against the live tool surface.
 * @param {{body: string, toolNames?: string[], mcpServers?: string[], cliNames?: string[]}} input
 * @returns {Array<{id: string, kind: 'tool'|'mcp-server'|'cli', confidence: 'high'|'medium'|'low', evidence: string}>}
 */
export function matchSkillTools({ body, toolNames = [], mcpServers = [], cliNames = [] }) {
  if (typeof body !== 'string' || body.length === 0) return []
  const edges = []
  const seen = new Set()

  const push = (id, kind, confidence, evidence) => {
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ id, kind, confidence, evidence })
  }

  // L1 — exact registered tool names.
  for (const tool of toolNames) {
    if (typeof tool !== 'string' || tool.length === 0) continue
    const at = body.search(tokenRegex(tool))
    if (at === -1) continue
    push(tool, 'tool', 'high', snippet(body, at, tool.length))
  }

  // Servers already pinned down by an exact tool edge need no second edge.
  const coveredServers = new Set()
  for (const edge of edges) {
    // Server name charset matches workspace-gate SERVER_NAME ([A-Za-z0-9_-]{1,32}).
    const match = /^mcp__([A-Za-z0-9_-]+)__/.exec(edge.id)
    if (match) coveredServers.add(match[1])
  }

  // L2 — MCP server names.
  for (const server of mcpServers) {
    if (typeof server !== 'string' || server.length === 0) continue
    if (coveredServers.has(server) || seen.has(server)) continue
    const at = body.search(tokenRegex(server))
    if (at === -1) continue
    push(server, 'mcp-server', 'medium', snippet(body, at, server.length))
  }

  // L3 — external commands, only when not already explained by L1/L2.
  for (const cli of cliNames) {
    if (typeof cli !== 'string' || cli.length === 0) continue
    if (seen.has(cli)) continue
    const at = body.search(tokenRegex(cli))
    if (at === -1) continue
    push(cli, 'cli', 'low', snippet(body, at, cli.length))
  }

  // L4 — bundle script paths, the concrete way many skills "point at a tool".
  const scriptRe = /(?:^|[\s`'"(=])((?:\.\/)?(?:[\w.-]+\/)*(?:scripts|tools|bin)\/[A-Za-z0-9_./-]+\.(?:ps1|py|sh|mjs|cjs|js|exe|bat))/g
  let match
  while ((match = scriptRe.exec(body)) !== null) {
    const id = match[1].replace(/^\.\//, '')
    if (seen.has(id)) continue
    push(id, 'script', 'low', snippet(body, match.index + match[0].indexOf(match[1]), id.length))
  }

  return edges
}
