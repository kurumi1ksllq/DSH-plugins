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
  // apply() registers its cleanup through ctx.effect, whose returned disposer
  // is what cordis invokes on plugin unload — not apply's return value.
  let effectCleanup
  const effect = ctx.effect.bind(ctx)
  ctx.effect = (fn) => {
    effectCleanup = effect(fn)
    return effectCleanup
  }
  apply(ctx, { logFile: '' })
  assert.equal(typeof listeners.get('agent/created'), 'function')
  assert.equal(typeof effectCleanup, 'function', 'the effect callback must return a disposer')
  effectCleanup()
  // Issue #75: the test name promised listener removal — assert it, so a
  // no-op cleanup (double mounting after HMR) turns this red.
  assert.equal(listeners.get('agent/created'), undefined, 'cleanup must remove the agent/created listener')
})

/**
 * Issue #71: gate.js forwards `config.serverNameSuffix` into planMount. The
 * lib-level tests inject the suffix directly; this test pins the wiring — a
 * dropped pass-through would mount under the plain name again, silently
 * breaking the documented `mountedAs` contract (README:303).
 */
test('the gate forwards serverNameSuffix to the mounted server name', async () => {
  const stubDir = scratch()
  const stubFile = join(stubDir, 'mcp-client-stub.mjs')
  writeFileSync(stubFile, 'export function apply() {}\n')

  const mountedNames = []
  const { ctx, listeners, logs } = fakeCtx()
  ctx.plugin = (_mod, serverConfig) => {
    mountedNames.push(serverConfig?.serverName)
    return Promise.resolve({ dispose() {} })
  }

  apply(ctx, { logFile: '', mcpClientEntry: stubFile, serverNameSuffix: '-ws' })
  const agent = { id: 'gate-suffix', session: { header: { cwd: workspaceWith(VALID) } }, ctx }
  await dispatch(listeners, logs, agent)

  assert.ok(logs.some(([, message]) => message.includes('mount agent=gate-suffix')), 'the gate must attempt the mount')
  assert.deepEqual(mountedNames, ['officecli-ws'], 'the configured suffix must reach the mounted serverName')
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

  let cleanup
  const effect = ctx.effect.bind(ctx)
  ctx.effect = (fn) => {
    cleanup = effect(fn)
    return cleanup
  }
  apply(ctx, { logFile: '', mcpClientEntry: stubFile, mountTimeoutMs: 20 })
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


/**
 * Issue #102: the late-fiber fallback used to dispose fast mounts too, because
 * its mounted.has() check ran before mounted.set() ever did (microtask order).
 * These two tests pin the contract the gate.js comment always claimed:
 * a fiber is disposed when its agent is gone, and tracked while it lives.
 */
test('a mount that completes within the window stays alive while the agent lives', async () => {
  const stubDir = scratch()
  const stubFile = join(stubDir, 'mcp-client-stub.mjs')
  writeFileSync(stubFile, 'export function apply() {}\n')

  const fiber = { disposed: false, dispose() { this.disposed = true } }
  const { ctx, listeners, logs } = fakeCtx()
  ctx.plugin = () => Promise.resolve(fiber)

  let cleanup
  const effect = ctx.effect.bind(ctx)
  ctx.effect = (fn) => {
    cleanup = effect(fn)
    return cleanup
  }
  apply(ctx, { logFile: '', mcpClientEntry: stubFile })
  const agent = { id: 'gate-fast', session: { header: { cwd: workspaceWith(VALID) } }, ctx }
  await dispatch(listeners, logs, agent)
  assert.ok(logs.some(([, m]) => m.includes('mount agent=gate-fast')), 'the fast mount must be logged')
  assert.equal(fiber.disposed, false, 'a fast mount must survive while the agent is alive')
  if (typeof cleanup === 'function') cleanup()
  assert.equal(fiber.disposed, true, 'the tracked fiber must be disposed at plugin teardown')
})

test('a mount that resolves after mountTimeoutMs stays tracked while the agent lives', async () => {
  const stubDir = scratch()
  const stubFile = join(stubDir, 'mcp-client-stub.mjs')
  writeFileSync(stubFile, 'export function apply() {}\n')

  const lateFiber = { disposed: false, dispose() { this.disposed = true } }
  let resolveMount
  const { ctx, listeners, logs } = fakeCtx()
  ctx.plugin = () => new Promise((resolve) => { resolveMount = () => resolve(lateFiber) })

  let cleanup
  const effect = ctx.effect.bind(ctx)
  ctx.effect = (fn) => {
    cleanup = effect(fn)
    return cleanup
  }
  apply(ctx, { logFile: '', mcpClientEntry: stubFile, mountTimeoutMs: 20 })
  const agent = { id: 'gate-late-alive', session: { header: { cwd: workspaceWith(VALID) } }, ctx }
  listeners.get('agent/created')({ agent })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.ok(logs.some(([, m]) => m.includes('mount slow agent=gate-late-alive')), 'the slow mount must be reported')

  // The agent is still alive when the mount finally lands: it must be tracked,
  // not disposed (the mounted.has() proxy could not know this before #102).
  resolveMount()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(lateFiber.disposed, false, 'a late mount for a living agent must be tracked')

  if (typeof cleanup === 'function') cleanup()
  assert.equal(lateFiber.disposed, true, 'plugin teardown still disposes the tracked fiber')
})
