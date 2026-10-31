import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collectSkillToolEvidence } from '../lib/collect-sessions.js'
import { buildSnapshot, summarizeConfig } from '../lib/inventory.js'

const call = (name, args = {}) => ({ type: 'tool/call', data: { name, arguments: JSON.stringify(args) } })

test('counts tools invoked within the window after a skill load', () => {
  const events = [
    { type: 'session' },
    call('skill', { name: 'officecli' }),
    call('mcp__officecli__officecli'),
    call('read'),
    call('write'),
    call('read'),
  ]
  const rows = collectSkillToolEvidence(events, { window: 8 })
  const officecli = rows.find((r) => r.skill === 'officecli')
  assert.ok(officecli)
  assert.equal(officecli.tools.get('mcp__officecli__officecli'), 1)
  assert.equal(officecli.tools.get('read'), 2)
  assert.equal(officecli.tools.get('write'), 1)
})

test('ignores tool calls beyond the window and tolerates malformed events', () => {
  const events = [
    call('skill', { name: 'comfyui' }),
    ...Array.from({ length: 10 }, () => call('read')),
    call('mcp__officecli__officecli'),
    { type: 'tool/call', data: {} },
    { type: 'tool/call' },
    { type: 'tool/result', data: { name: 'x' } },
  ]
  const rows = collectSkillToolEvidence(events, { window: 3 })
  const comfy = rows.find((r) => r.skill === 'comfyui')
  assert.ok(comfy)
  assert.equal(comfy.tools.has('mcp__officecli__officecli'), false)
  assert.equal(comfy.tools.get('read'), 3)
})

test('buildSnapshot merges the four lists, derives MCP status and flags orphans', () => {
  const snapshot = buildSnapshot({
    now: 1,
    profile: { dir: 'C:/p/desktop', bundles: ['dsh-inventory', 'dsh-websearch-failover'] },
    packages: [
      { name: 'dsh-tool-search', version: '0.1.8', installed: true, declaredBy: ['dependencies'] },
      { name: 'dsh-websearch-failover', installed: false, declaredBy: ['bundles'] },
    ],
    rows: [
      { id: 'mcp-officecli', name: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', config: { serverName: 'officecli' } },
      { id: 'inventory', name: 'dsh-inventory', enabled: true, fiberPhase: 'active' },
    ],
    skills: [
      { name: 'officecli', source: 'user-dsh', rank: 400, modelInvocable: true, disabled: false, path: 'C:/s/officecli/SKILL.md' },
    ],
    tools: [
      { name: 'read', deferred: false, descLen: 10 },
      { name: 'mcp__officecli__officecli', deferred: false, descLen: 20 },
    ],
    builtinTools: ['read'],
    sessionEdges: [{ skill: 'officecli', tool: 'mcp__officecli__officecli', count: 3 }],
    skillEdges: [],
  })

  assert.equal(snapshot.generatedAt, 1)
  assert.ok(Array.isArray(snapshot.packages))
  assert.equal(snapshot.packages.find((p) => p.name === 'dsh-websearch-failover').orphan, true)
  assert.equal(snapshot.mcp.length, 1)
  assert.equal(snapshot.mcp[0].server, 'officecli')
  assert.equal(snapshot.mcp[0].status, 'connected')
  assert.equal(snapshot.mcp[0].toolCount, 1)
  const read = snapshot.tools.find((t) => t.name === 'read')
  assert.equal(read.owner.kind, 'builtin')
  const mcpTool = snapshot.tools.find((t) => t.name === 'mcp__officecli__officecli')
  assert.equal(mcpTool.owner.kind, 'mcp')
  assert.equal(mcpTool.owner.ref, 'officecli')
  const officeEdge = snapshot.edges.find((e) => e.id === 'mcp__officecli__officecli')
  assert.ok(officeEdge)
  assert.ok(officeEdge.evidence.sources.includes('session'))
  assert.equal(officeEdge.evidence.count, 3)
  assert.ok(snapshot.warnings.some((w) => w.code === 'orphan-package'))
})

test('config summarisation keeps readable paths but redacts secrets', () => {
  const summary = summarizeConfig({
    serverName: 'context7',
    command: 'C:\\Program Files\\nodejs\\node.exe',
    args: [
      'C:\\Users\\admin\\AppData\\Roaming\\npm\\node_modules\\@upstash\\context7-mcp\\dist\\index.js',
      '--api-key',
      'ctx7sk-TEST-0000-0000-0000-000000000000',
    ],
    env: { MCP_TOKEN: 'should-never-appear' },
    headers: { Authorization: 'Bearer should-never-appear' },
  })
  assert.equal(summary.command, 'C:\\Program Files\\nodejs\\node.exe')
  // A long path is not a secret: keep it readable.
  assert.match(summary.args[0], /context7-mcp/)
  assert.doesNotMatch(summary.args[0], /redacted/)
  // The flag's value is the secret, not the flag.
  assert.equal(summary.args[1], '--api-key')
  assert.equal(summary.args[2], '<redacted>')
  // env/headers are dropped wholesale and declared as such.
  assert.deepEqual(summary.redacted, ['env', 'headers'])
  assert.doesNotMatch(JSON.stringify(summary), /should-never-appear/)
})

test('header-shaped, env-shaped and inline secret arguments are all redacted', () => {
  const headerCase = summarizeConfig({ args: ['--header', 'Authorization: Bearer sk-live-ABC123def456'] })
  assert.equal(headerCase.args[0], '--header')
  assert.match(headerCase.args[1], /^Authorization: /)
  assert.doesNotMatch(JSON.stringify(headerCase), /sk-live-ABC123def456/)

  const envCase = summarizeConfig({ args: ['-e', 'API_KEY=abc123def456', '-e', 'MODE=production'] })
  assert.doesNotMatch(JSON.stringify(envCase), /abc123def456/)
  assert.match(JSON.stringify(envCase), /API_KEY=/)
  // A non-secret env pair stays readable.
  assert.match(JSON.stringify(envCase), /MODE=production/)

  const inlineCase = summarizeConfig({ args: ['--token=ghp_abcdef123456', '--verbose'] })
  assert.doesNotMatch(JSON.stringify(inlineCase), /ghp_abcdef123456/)

  // A command line that carries a secret flag is redacted too.
  const commandCase = summarizeConfig({ command: 'C:\\nodejs\\node.exe --api-key=ctx7sk-abc123 --verbose' })
  assert.doesNotMatch(JSON.stringify(commandCase), /ctx7sk-abc123/)
  assert.match(commandCase.command, /--verbose/)
})

test('session-only edges carry a human-readable evidence sample', () => {
  const snapshot = buildSnapshot({
    now: 3,
    profile: { dir: 'C:/p', bundles: [] },
    packages: [],
    rows: [],
    skills: [{ name: 'video-asr', source: 'user-dsh', rank: 400 }],
    tools: [],
    builtinTools: [],
    pluginTools: {},
    skillEdges: [],
    sessionEdges: [{ skill: 'video-asr', tool: 'yt-dlp', count: 2 }],
  })
  const edge = snapshot.edges[0]
  assert.equal(edge.id, 'yt-dlp')
  assert.ok(edge.evidence.sample, 'session edge has no sample')
  assert.match(edge.evidence.sample, /2/)
})

test('a configured MCP server with no live tools reports no-tools', () => {
  const snapshot = buildSnapshot({
    now: 2,
    profile: { dir: 'C:/p/web', bundles: [] },
    packages: [],
    rows: [
      { id: 'mcp-ghost', name: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', config: { serverName: 'ghost' } },
    ],
    skills: [],
    tools: [],
    builtinTools: [],
    sessionEdges: [],
    skillEdges: [],
  })
  assert.equal(snapshot.mcp[0].status, 'no-tools')
  assert.equal(snapshot.mcp[0].toolCount, 0)
})

test('header redaction tolerates a missing space after the colon', () => {
  const summary = summarizeConfig({ args: ['--header', 'Authorization:Bearer sk-live-XYZ789uvwxyz'] })
  assert.match(JSON.stringify(summary), /<redacted>/)
  assert.doesNotMatch(JSON.stringify(summary), /sk-live-XYZ789uvwxyz/)
})

test('long opaque tokens are masked even without both letters and digits', () => {
  const lettersOnly = summarizeConfig({ args: ['--token', 'abcdefghijklmnopqrstuvwxyzzzzzzzzzzz'] })
  assert.match(JSON.stringify(lettersOnly), /<redacted>/)
  const digitsOnly = summarizeConfig({ args: ['--token', '123456789012345678901234567890123456789012'] })
  assert.match(JSON.stringify(digitsOnly), /<redacted>/)
})
