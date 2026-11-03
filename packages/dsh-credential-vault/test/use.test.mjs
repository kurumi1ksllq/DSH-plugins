// Tests for the zero-plaintext path (issue #36, T4).
//
// `action:"use"` must hand the model an environment-variable NAME and never the
// value, and the plugin must inject that value only into shell calls belonging
// to the session that asked for it. These tests fake the `shellEnv` registry and
// drive the contributor's resolver directly, which is the same surface
// `dsh-shell-env` uses for every shell execution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { envVarFor } from '../lib/env-injection.js'
import { createVaultStore } from '../lib/vault-store.js'
import { readAudit } from '../lib/audit.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-use-test-'))
}

/** A fake ctx whose shellEnv records contributors so tests can call resolve(). */
function fakeContext({ withShellEnv = true } = {}) {
  const registered = { tools: [], sections: [], routes: [], contributors: [], disposed: 0 }
  const ctx = {
    registered,
    systemPrompt: { section: (section) => registered.sections.push(section) },
    effect(fn) { fn() },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: () => {} },
  }
  if (withShellEnv) {
    ctx.shellEnv = {
      register(contributor) {
        registered.contributors.push(contributor)
        return () => {
          registered.disposed += 1
          const index = registered.contributors.indexOf(contributor)
          if (index >= 0) registered.contributors.splice(index, 1)
        }
      },
    }
  }
  return ctx
}

/** The shape `dsh-shell-env` passes to a contributor's resolve(). */
function execution(sessionId) {
  return { agent: sessionId === undefined ? undefined : { session: { header: { id: sessionId } } } }
}

function latestContributor(ctx) {
  return ctx.registered.contributors[ctx.registered.contributors.length - 1]
}

test('envVarFor derives an all-caps DSH_CRED_ name', () => {
  assert.equal(envVarFor('github-token'), 'DSH_CRED_GITHUB_TOKEN')
  assert.equal(envVarFor('github token'), 'DSH_CRED_GITHUB_TOKEN')
  assert.equal(envVarFor('prod mysql root'), 'DSH_CRED_PROD_MYSQL_ROOT')
})

test('use returns a variable name and no secret, and audits the read', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'ghp_supersecret', service: 'github', aliases: ['gh'] })

    const tool = ctx.registered.tools[0]
    const result = await tool.execute({ action: 'use', name: 'gh' }, { agent: { session: { header: { id: 's1' } } } })

    assert.equal(result.action, 'use')
    assert.equal(result.name, 'github token')
    assert.equal(result.envVar, 'DSH_CRED_GITHUB_TOKEN')
    assert.equal(result.resolvedBy, 'alias')
    assert.equal(typeof result.expiresAt, 'string')
    assert.equal(JSON.stringify(result).includes('ghp_supersecret'), false)

    const audit = readAudit(dir, 10)
    assert.equal(audit[0].name, 'github token')
    assert.equal(audit[0].outcome, 'ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the injected value reaches only the issuing session', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    createVaultStore(dir).set('github token', { kind: 'token', secret: 'ghp_supersecret' })

    const tool = ctx.registered.tools[0]
    await tool.execute({ action: 'use', name: 'github token' }, { agent: { session: { header: { id: 's1' } } } })

    const contributor = latestContributor(ctx)
    assert.ok(contributor.variables.DSH_CRED_GITHUB_TOKEN)
    assert.equal(typeof contributor.variables.DSH_CRED_GITHUB_TOKEN.description, 'string')

    assert.deepEqual(contributor.resolve(execution('s1')), { DSH_CRED_GITHUB_TOKEN: 'ghp_supersecret' })
    assert.deepEqual(contributor.resolve(execution('other-session')), {})
    assert.deepEqual(contributor.resolve(execution(undefined)), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a grant expires, and the value stops being injected', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir, grantTtlMs: 5 })
    createVaultStore(dir).set('github token', { kind: 'token', secret: 'ghp_supersecret' })

    const tool = ctx.registered.tools[0]
    await tool.execute({ action: 'use', name: 'github token' }, { agent: { session: { header: { id: 's1' } } } })
    const contributor = latestContributor(ctx)
    assert.deepEqual(contributor.resolve(execution('s1')), { DSH_CRED_GITHUB_TOKEN: 'ghp_supersecret' })

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(contributor.resolve(execution('s1')), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('use reports an explicit error when the deployment has no shellEnv injection', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext({ withShellEnv: false })
    apply(ctx, { vaultDir: dir })
    createVaultStore(dir).set('github token', { kind: 'token', secret: 'ghp_supersecret' })

    const tool = ctx.registered.tools[0]
    await assert.rejects(
      () => tool.execute({ action: 'use', name: 'github token' }, { agent: { session: { header: { id: 's1' } } } }),
      /environment variable injection is not available/i,
    )
    // It must not have silently revealed the value instead.
    assert.equal(readAudit(dir, 10).length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a credential added after startup is declared before use', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    createVaultStore(dir).set('first token', { kind: 'token', secret: 'v1' })
    const tool = ctx.registered.tools[0]
    await tool.execute({ action: 'use', name: 'first token' }, { agent: { session: { header: { id: 's1' } } } })

    createVaultStore(dir).set('second token', { kind: 'token', secret: 'v2' })
    const result = await tool.execute({ action: 'use', name: 'second token' }, { agent: { session: { header: { id: 's1' } } } })
    assert.equal(result.envVar, 'DSH_CRED_SECOND_TOKEN')

    const contributor = latestContributor(ctx)
    assert.ok(contributor.variables.DSH_CRED_SECOND_TOKEN)
    assert.deepEqual(contributor.resolve(execution('s1')), {
      DSH_CRED_FIRST_TOKEN: 'v1',
      DSH_CRED_SECOND_TOKEN: 'v2',
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('use on an ambiguous name is refused and audited', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github ci', { kind: 'token', secret: 'a', service: 'github' })
    store.set('github deploy', { kind: 'token', secret: 'b', service: 'github' })

    const tool = ctx.registered.tools[0]
    await assert.rejects(
      () => tool.execute({ action: 'use', name: 'github' }, { agent: { session: { header: { id: 's1' } } } }),
      /matches several/,
    )
    assert.equal(readAudit(dir, 10)[0].outcome, 'ambiguous')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the registered contributor is re-registered when the credential set changes', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    createVaultStore(dir).set('one', { kind: 'token', secret: 'v1' })
    const tool = ctx.registered.tools[0]
    await tool.execute({ action: 'use', name: 'one' }, { agent: { session: { header: { id: 's1' } } } })
    const before = ctx.registered.contributors.length

    createVaultStore(dir).set('two', { kind: 'token', secret: 'v2' })
    await tool.execute({ action: 'use', name: 'two' }, { agent: { session: { header: { id: 's1' } } } })

    assert.equal(ctx.registered.contributors.length, before)
    assert.ok(ctx.registered.disposed >= 1)
    const contributor = latestContributor(ctx)
    assert.deepEqual(Object.keys(contributor.variables).sort(), ['DSH_CRED_ONE', 'DSH_CRED_TWO'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
