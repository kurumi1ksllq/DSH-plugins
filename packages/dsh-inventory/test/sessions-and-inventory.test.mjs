import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collectSkillToolEvidence } from '../lib/collect-sessions.js'
import { buildSnapshot, summarizeConfig } from '../lib/inventory.js'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// ---- #177: deep-ptc dispatches the skill tool instead of calling it ----

/** A `tool/ptc-dispatch` event: `arguments` is already an object here. */
const dispatch = (name, args = {}, extra = {}) => ({ type: 'tool/ptc-dispatch', data: { name, arguments: args, isError: false, ...extra } })

test('a skill loaded through tool/ptc-dispatch produces evidence', () => {
  // In deep-ptc the outer tool/call is always run_code; the real skill load is a
  // nested dispatch. Reading only tool/call made this statistic empty in every
  // deep-ptc session.
  const events = [
    call('run_code', { code: 'x' }),
    dispatch('skill', { name: 'design-system' }),
    dispatch('bash', { command: 'ls' }),
    dispatch('edit', { file_path: 'a.js' }),
  ]
  const rows = collectSkillToolEvidence(events, { window: 8 })
  const row = rows.find((r) => r.skill === 'design-system')
  assert.ok(row, 'a dispatched skill load must be counted')
  assert.equal(row.tools.get('bash'), 1)
  assert.equal(row.tools.get('edit'), 1)
})

test('both event sources are recognised in one session', () => {
  // The two shapes must stay symmetric: a native session and a deep-ptc session
  // can be mixed in one transcript when a preset changes mid-session.
  const events = [
    call('skill', { name: 'from-native' }),
    call('read'),
    dispatch('skill', { name: 'from-ptc' }),
    dispatch('grep'),
  ]
  const rows = collectSkillToolEvidence(events, { window: 8 })
  assert.ok(rows.some((r) => r.skill === 'from-native'), 'tool/call skill load lost')
  assert.ok(rows.some((r) => r.skill === 'from-ptc'), 'tool/ptc-dispatch skill load lost')
})

test('malformed dispatches are ignored instead of throwing', () => {
  const events = [
    dispatch('skill', null),
    dispatch('skill', { name: 42 }),
    { type: 'tool/ptc-dispatch', data: null },
    { type: 'tool/ptc-dispatch' },
    { type: 'tool/ptc-dispatch-start', data: { name: 'skill', arguments: { name: 'not-a-settle' } } },
    dispatch('skill', { name: 'real' }),
    dispatch('read'),
  ]
  const rows = collectSkillToolEvidence(events, { window: 8 })
  assert.deepEqual(rows.map((r) => r.skill), ['real'], 'only the settled, well-formed load counts')
})

test('a skill_get dispatch counts as a load too', () => {
  // dsh-skill-surface/lib/handoff.mjs models the loader family as
  // { skill, skill_get }. Keeping only 'skill' here meant a session that used the
  // fallback loader still produced zero evidence (#177).
  const events = [
    dispatch('skill_get', { name: 'via-fallback' }),
    dispatch('read'),
  ]
  const rows = collectSkillToolEvidence(events, { window: 8 })
  const row = rows.find((r) => r.skill === 'via-fallback')
  assert.ok(row, 'a skill_get load must be counted')
  assert.equal(row.tools.get('read'), 1)
})

test('a failed load does not open a window', () => {
  // Same rule as handoff.mjs: a failed load put nothing in context, so counting
  // the following calls as its toolchain would be false evidence.
  const events = [
    { type: 'tool/ptc-dispatch', data: { name: 'skill', arguments: { name: 'broken' }, isError: true } },
    dispatch('bash'),
    dispatch('skill', { name: 'working' }),
    dispatch('grep'),
  ]
  const rows = collectSkillToolEvidence(events, { window: 8 })
  assert.equal(rows.some((r) => r.skill === 'broken'), false, 'a failed load must not produce evidence')
  const ok = rows.find((r) => r.skill === 'working')
  assert.ok(ok, 'the successful load still counts')
  assert.equal(ok.tools.get('grep'), 1)
})
// ---- #177: end-to-end through the public route -------------------------------

test('session evidence is read from $DSH_HOME/sessions, not $DSH_HOME/.dsh/sessions', async () => {
  // The path bug this pins: dshHome() already returns the .dsh directory, so
  // appending '.dsh' again pointed at a directory that does not exist. Every
  // session read came back empty and no fixture could tell, because the
  // collector was never given a file in the first place.
  const home = mkdtempSync(join(tmpdir(), 'inv-177-home-'))
  const sessionDir = join(home, 'sessions', '--demo--', 'sess-1')
  mkdirSync(sessionDir, { recursive: true })
  const events = [
    { type: 'tool/ptc-dispatch', seq: 1, data: { name: 'skill', arguments: { name: 'demo-skill' }, isError: false } },
    { type: 'tool/ptc-dispatch', seq: 2, data: { name: 'bash', arguments: { command: 'ls' }, isError: false } },
  ]
  writeFileSync(join(sessionDir, 'session.v4.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')

  // Every DSH_* that apply() resolves must point inside the temp tree, or this
  // test reads the real profile on whoever runs it and its assertions change
  // with that machine. The bare three were not enough: resolveProfileDir also
  // reads DSH_PROFILE_DIR, globalSkillRoots reads DSH_BUNDLED_SKILL_DIR and
  // pluginRepoRoot reads DSH_PLUGIN_REPO.
  const ENV_KEYS = [
    'DSH_HOME',
    'DSH_AGENTS_HOME',
    'DSH_CUSTOM_SKILL_DIRS',
    'DSH_PROFILE_DIR',
    'DSH_BUNDLED_SKILL_DIR',
    'DSH_PLUGIN_REPO',
  ]
  const previous = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.DSH_HOME = home
  process.env.DSH_AGENTS_HOME = join(home, 'agents')
  process.env.DSH_CUSTOM_SKILL_DIRS = ''
  process.env.DSH_PROFILE_DIR = join(home, 'profile')
  process.env.DSH_BUNDLED_SKILL_DIR = join(home, 'bundled')
  process.env.DSH_PLUGIN_REPO = join(home, 'repo')
  try {
    const { apply } = await import('../index.js')
    const routes = []
    const ctx = {
      baseUrl: 'file:///C:/nope/',
      logger: { warn() {}, info() {}, error() {} },
      get(name) {
        if (name === 'loader') return { entries: () => [] }
        if (name === 'tools') return { schemas: () => [] }
        if (name === 'workspaceRegistry') return { list: () => [] }
        return undefined
      },
      effect(fn) { return fn() },
      webServer: { register(route) { routes.push(route) } },
      slots: { register() {} },
      locale: { register() {}, bind: () => (key) => key },
      systemPrompt: { context: () => () => {} },
    }
    apply(ctx)
    const route = routes.find((r) => r.path === '/inventory/snapshot')
    assert.ok(route, 'snapshot route not registered')
    let text = ''
    await route.handler({ method: 'GET', url: 'http://127.0.0.1/inventory/snapshot?refresh=1' }, {
      writeHead() {},
      end(chunk) { text = chunk ?? '' },
    })
    // Assert the structure, not a substring of the serialised JSON: a bare
    // includes('"session"') would also pass on an unrelated field or a path that
    // happens to contain the word.
    const snapshot = JSON.parse(text)
    const edge = snapshot.edges.find((entry) => entry.skill === 'demo-skill')
    assert.ok(edge, 'the skill from the session file never reached the snapshot')
    assert.ok(edge.evidence.sources.includes('session'), 'the edge carries no session source')
    assert.equal(edge.evidence.count, 1, 'the single bash dispatch should count once')
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    rmSync(home, { recursive: true, force: true })
  }
})