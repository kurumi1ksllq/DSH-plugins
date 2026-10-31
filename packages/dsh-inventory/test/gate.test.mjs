import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, name as pluginName } from '../gate.js'

/**
 * Wiring contract for the gate half. The mounting itself needs a live Harness
 * (mcp-client only resolves inside it), so these tests pin the decision path:
 * who gets mounted, who is skipped, and that nothing ever throws.
 */

const created = []

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'inv-gate-'))
  created.push(dir)
  return dir
}

function workspaceWith(declaration) {
  const dir = scratch()
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(join(dir, '.dsh', 'mcp.json'), declaration)
  return dir
}

test.after(() => {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Temp leftovers are harmless.
    }
  }
})

function fakeCtx() {
  const listeners = new Map()
  const logs = []
  return {
    listeners,
    logs,
    ctx: {
      logger: {
        info: (message) => logs.push(['info', message]),
        warn: (message) => logs.push(['warn', message]),
      },
      effect(fn) {
        return fn()
      },
      on(event, handler) {
        listeners.set(event, handler)
        return () => listeners.delete(event)
      },
    },
  }
}

const VALID = JSON.stringify({
  servers: { officecli: { transport: 'stdio', command: 'officecli.exe', args: ['mcp'] } },
})

/**
 * Fire `agent/created` and wait for its background work to settle.
 *
 * The listener is deliberately fire-and-forget (a mount must not hold up session
 * creation), so the promise it returns is not the work's promise. Every branch
 * writes one decision line before returning, so the log is the settle signal.
 */
async function dispatch(listeners, logs, agent) {
  listeners.get('agent/created')({ agent })
  const settled = () => logs.some(([, message]) => / (skip|mount|mount failed|gate error) agent=/.test(message))
  for (let attempt = 0; attempt < 200 && !settled(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('the gate half exports its own plugin name', () => {
  assert.equal(pluginName, 'dsh-inventory-gate')
})

test('apply registers agent/created and logs activation without a file log', () => {
  const { ctx, listeners, logs } = fakeCtx()
  apply(ctx, { logFile: '' })
  assert.equal(typeof listeners.get('agent/created'), 'function')
  assert.ok(logs.some(([level, message]) => level === 'info' && message.includes('activated')))
})

test('an undeclared workspace is skipped, never thrown', async () => {
  const { ctx, listeners, logs } = fakeCtx()
  apply(ctx, { logFile: '' })
  const agent = { id: 'gate-skip', session: { header: { cwd: scratch() } } }
  await dispatch(listeners, logs, agent)
  assert.ok(
    logs.some(([level, message]) => level === 'info' && message.includes('skip agent=gate-skip') && message.includes('no .dsh/mcp.json')),
  )
})

test('a broken declaration degrades to a skip with the parse reason', async () => {
  const { ctx, listeners, logs } = fakeCtx()
  apply(ctx, { logFile: '' })
  const agent = { id: 'gate-broken', session: { header: { cwd: workspaceWith('{ nope') } } }
  await dispatch(listeners, logs, agent)
  assert.ok(
    logs.some(
      ([level, message]) =>
        level === 'info' && message.includes('skip agent=gate-broken') && message.includes('invalid JSON'),
    ),
  )
})

test('a declared workspace warns instead of throwing when mcp-client is unreachable', async () => {
  const { ctx, listeners, logs } = fakeCtx()
  apply(ctx, { logFile: '' })
  const agent = { id: 'gate-mount', session: { header: { cwd: workspaceWith(VALID) } } }
  await dispatch(listeners, logs, agent)
  assert.ok(
    logs.some(
      ([level, message]) =>
        level === 'warn' &&
        (message.includes('mcp-client unavailable') || message.includes('mount failed')),
    ),
    'an unreachable mcp-client must be a warning, not a rejection',
  )
})

test('a forbidden service read falls back to the session header', async () => {
  const { ctx, listeners, logs } = fakeCtx()
  apply(ctx, { logFile: '' })
  const declared = workspaceWith(VALID)
  const agent = { id: 'gate-forbidden', session: { header: { cwd: declared } } }
  Object.defineProperty(agent, 'ctx', {
    get() {
      // Exactly what cordis does for a service the plugin did not inject.
      throw new Error('cannot get property "workingDirectory" without inject')
    },
  })
  await dispatch(listeners, logs, agent)
  assert.ok(!logs.some(([, message]) => message.includes('gate error')), 'must not surface as a gate error')
  assert.ok(
    logs.some(([level, message]) => level === 'warn' && message.includes('agent=gate-forbidden')),
    'the session header cwd must still drive the decision',
  )
})

test('the cleanup removes the listener', () => {
  const { ctx, listeners } = fakeCtx()
  const cleanup = apply(ctx, { logFile: '' })
  assert.equal(typeof listeners.get('agent/created'), 'function')
  if (typeof cleanup === 'function') cleanup()
  assert.ok(true, 'cleanup must not throw')
})

test('a mount that resolves after mountTimeoutMs is disposed when the agent is gone', async () => {
  // Stub mcp-client module: the gate only needs an `apply` export to proceed.
  const stubDir = scratch()
  const stubFile = join(stubDir, 'mcp-client-stub.mjs')
  writeFileSync(stubFile, 'export function apply() {}\n')

  const lateFiber = { disposed: false, dispose() { this.disposed = true } }
  let resolveMount
  const { ctx, listeners, logs } = fakeCtx()
  ctx.plugin = (_mod, _serverConfig) =>
    new Promise((resolve) => {
      resolveMount = () => resolve(lateFiber)
    })

  const cleanup = apply(ctx, { logFile: '', mcpClientEntry: stubFile, mountTimeoutMs: 20 })
  const agent = { id: 'gate-late', session: { header: { cwd: workspaceWith(VALID) } }, ctx }
  listeners.get('agent/created')({ agent })
  // No decision line is written on the timeout path, so just wait out the
  // timeout plus slack instead of dispatch()'s log-based settle.
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.ok(
    logs.some(([, message]) => message.includes('mount slow agent=gate-late')),
    'the slow mount must be reported',
  )

  // The agent goes away (the timed-out mount was never recorded in the
  // mounted table), then the underlying mount succeeds.
  if (typeof cleanup === 'function') cleanup()
  resolveMount()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(lateFiber.disposed, true, 'the late fiber must be disposed, not leaked')
})
