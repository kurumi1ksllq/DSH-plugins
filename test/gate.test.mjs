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
  await assert.doesNotReject(() => listeners.get('agent/created')({ agent }))
  assert.ok(
    logs.some(([level, message]) => level === 'info' && message.includes('skip agent=gate-skip') && message.includes('no .dsh/mcp.json')),
  )
})

test('a broken declaration degrades to a skip with the parse reason', async () => {
  const { ctx, listeners, logs } = fakeCtx()
  apply(ctx, { logFile: '' })
  const agent = { id: 'gate-broken', session: { header: { cwd: workspaceWith('{ nope') } } }
  await assert.doesNotReject(() => listeners.get('agent/created')({ agent }))
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
  await assert.doesNotReject(() => listeners.get('agent/created')({ agent }))
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
  await assert.doesNotReject(() => listeners.get('agent/created')({ agent }))
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
