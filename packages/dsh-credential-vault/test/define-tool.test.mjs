// Tests for the optional `@deepseek-ai/dsh-tools` dependency (issue #28).
//
// The plugin imports `defineTool` from the DSH runtime, but never declared it.
// On a developer machine a hand-made symlink under node_modules made it resolve;
// on a clean CI runner the package simply is not there, so every test that
// imports index.js died with ERR_MODULE_NOT_FOUND.
//
// `lib/define-tool.js` resolves the real package when present and falls back to a
// minimal, contract-compatible implementation when it is not. These tests pin
// both halves: the fallback must be shaped like the real thing, and the tool the
// plugin registers must still behave identically either way.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveDefineTool, FALLBACK_DEFINE_TOOL } from '../lib/define-tool.js'

test('resolveDefineTool returns a callable that produces a tool', () => {
  const fn = resolveDefineTool()
  assert.equal(typeof fn, 'function')
  // A stub returning a function is not enough: the resolved defineTool must
  // actually build a definition from a spec.
  const tool = fn({
    name: 'demo',
    description: 'demo',
    parameters: { action: { type: 'string', required: true, description: 'action' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: async () => ({}),
  })
  assert.equal(tool.name, 'demo')
  assert.equal(typeof tool.execute, 'function')
})

test('the fallback produces a registry-ready tool definition', () => {
  const tool = FALLBACK_DEFINE_TOOL({
    name: 'demo',
    description: 'demo tool',
    parameters: { a: { type: 'string', required: true, description: 'a' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'x' }] },
    execute: async () => ({ ok: true }),
  })
  assert.equal(tool.name, 'demo')
  assert.equal(tool.description, 'demo tool')
  assert.equal(typeof tool.execute, 'function')
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(typeof tool.parameters, 'object')
})

test('the fallback validates required parameters before executing', async () => {
  let ran = false
  const tool = FALLBACK_DEFINE_TOOL({
    name: 'demo',
    description: 'demo',
    parameters: { action: { type: 'string', required: true, description: 'action' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: async () => { ran = true; return {} },
  })
  await assert.rejects(() => tool.execute({}), /action/i)
  assert.equal(ran, false, 'execute must not run when validation fails')
})

test('the fallback passes valid arguments through untouched', async () => {
  const tool = FALLBACK_DEFINE_TOOL({
    name: 'demo',
    description: 'demo',
    parameters: { action: { type: 'string', required: true, description: 'action' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: async (args) => ({ echoed: args.action }),
  })
  const result = await tool.execute({ action: 'list' })
  assert.deepEqual(result, { echoed: 'list' })
})

test('the real defineTool and the fallback agree on the public shape', () => {
  // Whichever one resolves, the plugin only relies on these members.
  const spec = {
    name: 'demo',
    description: 'demo',
    parameters: { action: { type: 'string', required: true, description: 'action' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: async () => ({}),
  }
  const fromResolver = resolveDefineTool()(spec)
  const fromFallback = FALLBACK_DEFINE_TOOL(spec)
  for (const key of ['name', 'description']) {
    assert.equal(fromResolver[key], fromFallback[key], `${key} must agree`)
    assert.equal(typeof fromResolver[key], 'string', `${key} must be a string, not undefined`)
  }
  for (const key of ['execute', 'output', 'parameters']) {
    assert.equal(typeof fromResolver[key], typeof fromFallback[key], `${key} must be the same kind`)
  }
})

test('the plugin registers its credential tool without the real package present', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-notools-'))
  const previous = process.env.DSH_CREDENTIAL_VAULT_DIR
  process.env.DSH_CREDENTIAL_VAULT_DIR = dir
  try {
    const { apply, TOOL_NAME } = await import('../index.js')
    const registered = []
    const sections = []
    const routes = []
    const ctx = {
      effect: (fn) => fn(),
      systemPrompt: { section: (s) => sections.push(s) },
      webServer: { register: (entry) => routes.push(entry) },
      tools: { register: (tool) => registered.push(tool) },
    }
    await apply(ctx)
    assert.equal(registered.length, 1, 'the credential tool must still register')
    assert.equal(registered[0].name, TOOL_NAME)
    assert.equal(typeof registered[0].execute, 'function')
    assert.ok(sections.length > 0, 'the system-prompt section must still be contributed')
  } finally {
    if (previous === undefined) delete process.env.DSH_CREDENTIAL_VAULT_DIR
    else process.env.DSH_CREDENTIAL_VAULT_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
