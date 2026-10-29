/**
 * Self-check for dsh-ctx-guard: exercise the deny/allow decisions and the
 * /handoff output with a fake Cordis context, no harness boot required.
 * Run: node test/self-check.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { apply, inject, name } = await import('../lib/index.js')

const warnings = []
let tokens = 0
const listeners = new Map()
const commands = new Map()

const ctx = {
  logger: { warn: (message) => warnings.push(message) },
  on: (event, listener) => {
    listeners.set(event, listener)
    return () => {}
  },
  commands: {
    register: (definition) => {
      commands.set(definition.name, definition)
      return () => {}
    },
  },
  tokenMeter: { measure: () => ({ totalTokens: tokens }) },
  get: () => undefined,
}

assert.equal(name, 'ctx-guard')
assert.deepEqual(inject, ['tools', 'tokenMeter', 'commands'])

apply(ctx, { maxWriteChars: 10, maxEditChars: 10, maxCommandChars: 10, warnTokens: 100, freezeTokens: 200 })
assert.ok(listeners.has('tools/pre-execute'), 'pre-execute hook registered')
assert.ok(listeners.has('agent/pre-step'), 'pre-step hook registered')
assert.ok(commands.has('handoff'), '/handoff registered')

const pre = listeners.get('tools/pre-execute')
const allow = { kind: 'allow' }
// next() = the rest of the waterfall chain (other gates, then the tool body).
const run = (toolName, args, agent = { session: {} }) =>
  pre({ name: toolName, arguments: args, agent }, () => allow)

// R1/R2/R3: payload size, independent of context pressure.
assert.equal((await run('write', { content: 'x'.repeat(11) })).kind, 'deny')
assert.equal((await run('write', { content: 'x'.repeat(10) })).kind, 'allow')
assert.equal((await run('edit', { new_string: 'x'.repeat(11) })).kind, 'deny')
assert.equal((await run('pwsh', { command: 'x'.repeat(11) })).kind, 'deny')
assert.equal((await run('bash', { command: 'x'.repeat(11) })).kind, 'deny')

// R5 freeze: expanding tools denied, delivering tools allowed.
tokens = 201
assert.equal((await run('web_fetch', { url: 'https://example.com' })).kind, 'deny')
assert.equal((await run('skill', { name: 'ponytail' })).kind, 'deny')
assert.equal((await run('write', { file_path: join(tmpdir(), 'nope-ctx-guard.md'), content: 'x' })).kind, 'deny')
assert.equal((await run('read', { file_path: 'package.json' })).kind, 'allow')
assert.equal((await run('present', { files: [] })).kind, 'allow')
assert.equal((await run('ask_user_question', { questions: [] })).kind, 'allow')
assert.equal((await run('todo_write', { todos: [] })).kind, 'allow')

// Overwriting an existing file stays allowed at freeze (it is an edit tail).
const existing = join(tmpdir(), `ctx-guard-existing-${process.pid}.md`)
writeFileSync(existing, 'old')
assert.equal((await run('write', { file_path: existing, content: 'new' })).kind, 'allow')
rmSync(existing)

// A relative file_path resolves against the agent's session cwd, not the host cwd.
const agentCwd = mkdtempSync(join(tmpdir(), 'ctx-guard-cwd-'))
writeFileSync(join(agentCwd, 'relative.md'), 'old')
const agentIn = (dir) => ({ id: 'a', session: { id: 's', header: { cwd: dir } } })
assert.equal((await run('write', { file_path: 'relative.md', content: 'new' }, agentIn(agentCwd))).kind, 'allow')
assert.equal((await run('write', { file_path: 'missing.md', content: 'new' }, agentIn(agentCwd))).kind, 'deny')

// R6: a frozen call past compactTokens compacts once, then re-measures.
// If the compaction frees enough room, the same call goes through.
let compactions = 0
const compactionCtx = {
  ...ctx,
  get: (service) => (service === 'compaction' ? {
    compactIfNeeded: async () => {
      compactions += 1
      tokens = 120
      return null
    },
  } : undefined),
}
const compactListeners = new Map()
compactionCtx.on = (event, listener) => { compactListeners.set(event, listener); return () => {} }
apply(compactionCtx, { maxWriteChars: 10, maxEditChars: 10, maxCommandChars: 10, freezeTokens: 200, compactTokens: 300 })
tokens = 400
const afterCompact = await compactListeners.get('tools/pre-execute')(
  { name: 'web_fetch', arguments: { url: 'https://example.com' }, agent: agentIn(agentCwd) },
  () => allow,
)
assert.equal(compactions, 1, 'R6 compacts once')
assert.equal(afterCompact.kind, 'allow', 'R6 re-measures after compaction')

// Without the compaction service the call stays denied; a throw is contained.
tokens = 400
assert.equal((await run('web_fetch', { url: 'https://example.com' })).kind, 'deny')
const throwingCtx = { ...compactionCtx, get: () => ({ compactIfNeeded: async () => { throw new Error('boom') } }) }
const throwingListeners = new Map()
throwingCtx.on = (event, listener) => { throwingListeners.set(event, listener); return () => {} }
apply(throwingCtx, { freezeTokens: 200, compactTokens: 300 })
assert.equal((await throwingListeners.get('tools/pre-execute')(
  { name: 'skill', arguments: {}, agent: agentIn(agentCwd) },
  () => allow,
)).kind, 'deny', 'compaction failure never opens the gate')
rmSync(agentCwd, { recursive: true, force: true })

// R4: pre-step warns once per 10k tokens, never denies the step.
// The agent object is stable across steps in the real loop, so it is the warn key.
const warnBase = warnings.length
const stableAgent = { id: 'a', session: { id: 's' } }
const preStep = listeners.get('agent/pre-step')
tokens = 150
assert.deepEqual(preStep({ agent: stableAgent }, () => allow), allow)
assert.equal(warnings.length, warnBase + 1)
preStep({ agent: stableAgent }, () => allow)
assert.equal(warnings.length, warnBase + 1, 'warn is rate limited')

// /handoff: four sections, edited files, todos, paste-ready prompt.
const cwd = mkdtempSync(join(tmpdir(), 'ctx-guard-handoff-'))
const session = {
  id: 'session-test',
  header: { cwd },
  snapshotEvents: () => [
    { type: 'session/title', data: { title: '测试交接' } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '把插件做完' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再补一个测试' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '写好了 guard' }] } } },
    { type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ file_path: 'lib/index.js' }) } },
    { type: 'tool/call', data: { name: 'edit', arguments: JSON.stringify({ file_path: 'lib/index.js' }) } },
    { type: 'tool/call', data: { name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: '验证 R5', status: 'pending' }] }) } },
  ],
}

tokens = 4321
// Freeze the clock so both writes below land on the same filename stamp.
const RealDate = Date
const frozen = RealDate.parse('2026-10-28T12:00:00.000Z')
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length === 0 ? [frozen] : args))
  }
  static now() {
    return frozen
  }
}
const result = await commands.get('handoff').handler({ agent: { session }, rawInput: ' 交接标题 ' })
assert.equal(result.kind, 'success', result.text)
const path = /交接文档: (.+)/u.exec(result.text)?.[1]
assert.ok(path && existsSync(path), 'handoff file written')
const body = readFileSync(path, 'utf8')
assert.match(body, /^# HANDOFF — 测试交接/mu)
assert.match(body, /## 目标\n把插件做完/u)
assert.match(body, /## 最近进展/u)
assert.match(body, /## 改动文件\n- lib\/index\.js/u)
assert.match(body, /## 未完成\n- \[ \] 验证 R5/u)
assert.match(body, /~4321 tokens/u)
assert.match(result.text, /先读 .*HANDOFF-.*\.md/u)
assert.equal(readFileSync(path, 'utf8').match(/lib\/index\.js/gu).length, 1, 'files deduped')

// Two handoffs in the same millisecond must not clobber each other.
const second = await commands.get('handoff').handler({ agent: { session }, rawInput: '' })
globalThis.Date = RealDate
const secondPath = /交接文档: (.+)/u.exec(second.text)?.[1]
assert.equal(second.kind, 'success', second.text)
assert.notEqual(secondPath, path, 'second handoff gets its own file')
assert.ok(existsSync(secondPath) && existsSync(path), 'both handoffs survive')
assert.match(secondPath, /-1\.md$/u)

rmSync(cwd, { recursive: true, force: true })

console.log('ctx-guard self-check: ok')
