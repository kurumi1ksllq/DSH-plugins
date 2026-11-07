// Tests for the zero-plaintext path (issue #36, T4).
//
// `action:"use"` must hand the model an environment-variable NAME and never the
// value, and the plugin must inject that value only into shell calls belonging
// to the session that asked for it. These tests fake the `shellEnv` registry and
// drive the contributor's resolver directly, which is the same surface
// `dsh-shell-env` uses for every shell execution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'
import { declarationsFor, envVarFor } from '../lib/env-injection.js'
import { createVaultStore } from '../lib/vault-store.js'
import { readAudit } from '../lib/audit.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'vault-use-test-'))
}

/** A fake ctx whose shellEnv records contributors so tests can call resolve(). */
function fakeContext({ withShellEnv = true, strictKeys = false } = {}) {
  const registered = { tools: [], sections: [], routes: [], contributors: [], disposed: 0 }
  const listeners = new Map()
  const ctx = {
    registered,
    listeners,
    systemPrompt: { section: (section) => registered.sections.push(section) },
    effect(fn) { fn() },
    on(event, handler) { listeners.set(event, handler); return () => listeners.delete(event) },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: () => {} },
  }
  const shellEnv = withShellEnv
    ? {
        register(contributor) {
          if (strictKeys) {
            // Mirror dsh-shell-env: every declared key must survive its own check.
            for (const key of Object.keys(contributor.variables ?? {})) {
              if (!/^DSH_CRED_[A-Z][A-Z0-9_]*$/.test(key)) {
                throw new Error(`bash env contributor "${contributor.name}" declared invalid key "${key}"`)
              }
            }
          }
          registered.contributors.push(contributor)
          return () => {
            registered.disposed += 1
            const index = registered.contributors.indexOf(contributor)
            if (index >= 0) registered.contributors.splice(index, 1)
          }
        },
      }
    : null
  // Optional service delivery goes through `inject`, exactly as in cordis.
  ctx.inject = (names, callback) => {
    if (names.includes('shellEnv') && shellEnv !== null) return callback({ shellEnv })
    return () => {}
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

test('a disposed session loses its grants immediately (#103 D3)', async () => {
  const dir = tempDir()
  try {
    createVaultStore(dir).set('session-secret', { kind: 'token', secret: 'sv-live' })
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const tool = ctx.registered.tools[0]
    const sessionId = 'session-d3'
    const execution = { agent: { session: { header: { id: sessionId } } } }
    const result = await tool.execute({ action: 'use', name: 'session-secret' }, execution)
    assert.equal(result.action, 'use')
    const contributor = latestContributor(ctx)
    const before = contributor.resolve(execution)
    assert.equal(before[envVarFor('session-secret')], 'sv-live', 'the grant must serve the session before disposal')

    ctx.listeners.get('agent/disposed')({ agent: execution.agent })
    const after = contributor.resolve(execution)
    assert.equal(after[envVarFor('session-secret')], undefined, 'the disposed session must lose its grant at once')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

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

// ---- review round: P0-1 (non-ASCII names must still produce valid keys) ----

/** The validation `dsh-shell-env` applies to the part after `DSH_`. */
const SHELL_ENV_KEY = /^[A-Z][A-Z0-9_]*$/

test('a non-ASCII credential name still yields a declared-able DSH_* key', () => {
  for (const name of ['阿里云 ECS 密码', '数据库 root', '生产库口令']) {
    const key = envVarFor(name)
    assert.match(key, /^DSH_CRED_/, name)
    assert.ok(SHELL_ENV_KEY.test(key.slice('DSH_'.length)), `${key} is not a valid shell-env key`)
  }
})

test('two different non-ASCII names never collapse to the same key', () => {
  const keys = ['阿里云 ECS 密码', '阿里云 RDS 密码', '密码', '口令'].map(envVarFor)
  assert.equal(new Set(keys).size, keys.length, keys.join(', '))
})

test('an ASCII name keeps the plain readable key', () => {
  assert.equal(envVarFor('github-token'), 'DSH_CRED_GITHUB_TOKEN')
})

test('a store holding a non-ASCII credential still loads and can be used', async () => {
  // A failing registration inside apply() failed the WHOLE plugin, not just `use`.
  const dir = tempDir()
  try {
    const ctx = fakeContext({ strictKeys: true })
    createVaultStore(dir).set('阿里云 ECS 密码', { kind: 'password', secret: 'Vps#2026' })
    apply(ctx, { vaultDir: dir }) // must not throw
    const tool = ctx.registered.tools[0]
    const result = await tool.execute({ action: 'use', name: '阿里云 ECS 密码' }, { agent: { session: { header: { id: 's1' } } } })
    assert.ok(SHELL_ENV_KEY.test(result.envVar.slice('DSH_'.length)), result.envVar)
    const contributor = latestContributor(ctx)
    assert.deepEqual(contributor.resolve(execution('s1')), { [result.envVar]: 'Vps#2026' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('one corrupt entry does not break the prompt index or the other credentials', async () => {
  const dir = tempDir()
  try {
    const ctx = fakeContext()
    apply(ctx, { vaultDir: dir })
    const store = createVaultStore(dir)
    store.set('github token', { kind: 'token', secret: 'ghp_ok' })
    store.set('broken one', { kind: 'token', secret: 'v' })

    // Corrupt one sealed value the way a stale master key would.
    const file = join(dir, 'vault.json')
    const doc = JSON.parse(readFileSync(file, 'utf8'))
    doc.entries['broken one'].secret = Buffer.from('not-a-valid-ciphertext-at-all').toString('base64')
    writeFileSync(file, JSON.stringify(doc))

    const section = ctx.registered.sections.find((item) => item.name === 'dsh-credential-vault:hint')
    const text = section.text() // must not throw
    assert.match(text, /github token/)

    const tool = ctx.registered.tools[0]
    const got = await tool.execute({ action: 'get', name: 'github token' })
    assert.equal(got.name, 'github token')
    await assert.rejects(() => tool.execute({ action: 'get', name: 'broken one' }), /./)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- review round: P0-1 (a real cordis ctx throws on undeclared services) ----

/**
 * A ctx that mirrors cordis' proxy: reading a service property the plugin did
 * not `inject` throws instead of yielding undefined. The old `ctx.shellEnv !==
 * undefined` probe passed on a plain fake object and crashed in production.
 */
function strictServiceContext() {
  const registered = { tools: [], sections: [], routes: [], contributors: [] }
  const services = {
    registered,
    systemPrompt: { section: (section) => registered.sections.push(section) },
    effect(fn) { fn() },
    tools: { register: (tool) => registered.tools.push(tool) },
    webServer: { register: () => {} },
    // `inject` resolves the optional dependency the way cordis does.
    inject(names, callback) {
      assert.deepEqual(names, ['shellEnv'])
      return callback(strictServiceContext.withShellEnv(registered))
    },
  }
  return new Proxy(registered, {
    get(target, key) {
      if (key in services) return services[key]
      if (key in target) return target[key]
      throw new Error(`cannot get property "${String(key)}" without inject`)
    },
  })
}

strictServiceContext.withShellEnv = (registered) => ({
  shellEnv: {
    register(contributor) {
      for (const key of Object.keys(contributor.variables ?? {})) {
        assert.match(key, /^DSH_CRED_[A-Z][A-Z0-9_]*$/, `${key} is not a valid shell-env key`)
      }
      registered.contributors.push(contributor)
      return () => {}
    },
  },
})

test('apply never probes an undeclared service (real cordis throws on that)', async () => {
  const dir = tempDir()
  try {
    const ctx = strictServiceContext()
    createVaultStore(dir).set('github token', { kind: 'token', secret: 'ghp_strictctx1234' })
    apply(ctx, { vaultDir: dir }) // must not throw
    assert.equal(ctx.registered.sections.length, 1)
    assert.equal(ctx.registered.contributors.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without a shellEnv service the plugin still loads and `use` explains why it cannot', async () => {
  const dir = tempDir()
  try {
    const registered = { tools: [], sections: [], routes: [] }
    const services = {
      systemPrompt: { section: (section) => registered.sections.push(section) },
      effect(fn) { fn() },
      tools: { register: (tool) => registered.tools.push(tool) },
      webServer: { register: () => {} },
      // cordis leaves the callback pending for a missing service; either way
      // nothing arrives, which is what this fake models.
      inject() {
        return () => {}
      },
    }
    const ctx = new Proxy(registered, {
      get(target, key) {
        if (key in services) return services[key]
        if (key in target) return target[key]
        throw new Error(`cannot get property "${String(key)}" without inject`)
      },
    })
    createVaultStore(dir).set('github token', { kind: 'token', secret: 'ghp_noshellenv' })
    apply(ctx, { vaultDir: dir }) // must not throw
    assert.equal(registered.tools.length, 1)
    await assert.rejects(
      () => registered.tools[0].execute({ action: 'use', name: 'github token' }, { agent: { session: { header: { id: 's1' } } } }),
      /environment variable injection is not available/i,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- review round: P0-2b (a variable-name collision must be refused loudly) ----

test('declarationsFor refuses to let two credentials share one variable name', () => {
  const { variables, collisions } = declarationsFor([
    { name: 'github token' },
    { name: 'github_token' },
    { name: 'openai key' },
  ])
  assert.equal(Object.hasOwn(variables, 'DSH_CRED_GITHUB_TOKEN'), false, 'the colliding key must not be declared')
  assert.ok(Object.hasOwn(variables, 'DSH_CRED_OPENAI_KEY'))
  assert.equal(collisions.length, 1)
  assert.deepEqual(collisions[0].names.sort(), ['github token', 'github_token'])
})
