import { test } from 'node:test'
import assert from 'node:assert/strict'

import { matchSkillTools } from '../lib/match-tools.js'

const base = {
  toolNames: ['read', 'write', 'mcp__officecli__officecli', 'mcp__davinci-resolve__timeline'],
  mcpServers: ['officecli', 'davinci-resolve', 'codegraph'],
  cliNames: ['officecli', 'vmrun', 'comfyui'],
}

test('exact tool names produce high-confidence tool edges', () => {
  const edges = matchSkillTools({ ...base, body: 'Call mcp__davinci-resolve__timeline when you need frames.' })
  const hit = edges.find((e) => e.id === 'mcp__davinci-resolve__timeline')
  assert.ok(hit)
  assert.equal(hit.kind, 'tool')
  assert.equal(hit.confidence, 'high')
  assert.match(hit.evidence, /mcp__davinci-resolve__timeline/)
})

test('an MCP server name yields one medium server edge, and suppresses the cli duplicate', () => {
  const edges = matchSkillTools({ ...base, body: '用 officecli 处理 docx；也支持 codegraph 检索。' })
  const ids = edges.map((e) => e.id)
  assert.ok(ids.includes('officecli'))
  assert.equal(ids.filter((id) => id === 'officecli').length, 1)
  const edge = edges.find((e) => e.id === 'officecli')
  assert.equal(edge.kind, 'mcp-server')
  assert.equal(edge.confidence, 'medium')
  assert.ok(edges.some((e) => e.id === 'codegraph' && e.kind === 'mcp-server'))
})

test('cli-only names become low-confidence external cli edges', () => {
  const edges = matchSkillTools({ ...base, body: 'Run vmrun start and vmrun stop.' })
  const edge = edges.find((e) => e.id === 'vmrun')
  assert.ok(edge)
  assert.equal(edge.kind, 'cli')
  assert.equal(edge.confidence, 'low')
  assert.equal(edges.filter((e) => e.id === 'vmrun').length, 1)
})

test('text with no reference yields no edges', () => {
  assert.deepEqual(matchSkillTools({ ...base, body: '# Just prose about writing.' }), [])
})

test('script paths inside a skill bundle surface as script edges', () => {
  const edges = matchSkillTools({
    ...base,
    body: 'Run `scripts/vmws.ps1 -Action start` and then ./tools/check.py --deep.',
  })
  const ids = edges.map((e) => e.id)
  assert.ok(ids.includes('scripts/vmws.ps1'))
  assert.ok(ids.includes('tools/check.py'))
  assert.equal(edges.find((e) => e.id === 'scripts/vmws.ps1').kind, 'script')
  assert.equal(edges.find((e) => e.id === 'scripts/vmws.ps1').confidence, 'low')
})

test('generic words do not become cli edges', () => {
  const edges = matchSkillTools({ ...base, body: 'A single node in the graph, plus generic python prose.' })
  assert.equal(edges.some((e) => e.kind === 'cli'), false)
})

test('MCP server ids with underscores resolve to the server edge', () => {
  const edges = matchSkillTools({
    body: 'Use the mcp__code_graph_ws__codegraph_explore tool to inspect the graph.',
    toolNames: ['mcp__code_graph_ws__codegraph_explore'],
  })
  const edge = edges.find((e) => e.id === 'mcp__code_graph_ws__codegraph_explore')
  assert.ok(edge, 'underscore server id should match')
  assert.equal(edge.kind, 'tool')
  assert.equal(edge.confidence, 'high')
})
