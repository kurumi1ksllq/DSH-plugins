import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerRoleTools } from '../lib/role-tools.mjs'

// ---------------------------------------------------------------------------
// #194 ticket 3: the two role tools, exercised through the registry contract.
// Only public behaviour: what the tool is named, what it answers, what it
// refuses. No private symbols, no call counts.
// ---------------------------------------------------------------------------

/** A ctx stub that records registered tools and answers the services we inject. */
function fakeContext(services = {}) {
  const tools = new Map()
  const effects = []
  return {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    effect(factory) {
      effects.push(factory())
    },
    get(name) {
      return services[name]
    },
    registered: tools,
    disposeAll() {
      for (const dispose of effects) dispose?.()
    },
  }
}

/** Roster with one role and one built-in composition. */
const ROSTER = [
  { id: 'standard', name: 'Standard', description: 'coding agent' },
  { id: 'django-security', name: 'django-security', description: 'Django security reviewer' },
]

const PERSONA_YAML = [
  "- id: persona",
  "  name: '@deepseek-ai/dsh-persona'",
  '  config:',
  '    prefix: |',
  '      You audit Django apps for security defects.',
].join('\n')

test('registerRoleTools registers both tools on the host tool registry', () => {
  const ctx = fakeContext({ agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: PERSONA_YAML }) } })
  registerRoleTools(ctx)
  assert.deepEqual([...ctx.registered.keys()].sort(), ['delegate_role', 'role_search'])
})

test('role_search lists roles without the built-in compositions', async () => {
  const ctx = fakeContext({ agentPresets: { list: async () => ROSTER } })
  registerRoleTools(ctx)
  const answer = await ctx.registered.get('role_search').execute({})
  assert.match(answer, /django-security/)
  assert.doesNotMatch(answer, /standard/)
})

test('role_search filters by query and explains an empty result', async () => {
  const ctx = fakeContext({ agentPresets: { list: async () => ROSTER } })
  registerRoleTools(ctx)
  const tool = ctx.registered.get('role_search')
  assert.match(await tool.execute({ query: 'security' }), /django-security/)
  const miss = await tool.execute({ query: 'kubernetes' })
  assert.match(miss, /No role matched/)
  assert.match(miss, /no query|English/, 'the miss must point at the way out')
})

test('role_search explains a composition without the preset registry', async () => {
  const ctx = fakeContext({})
  registerRoleTools(ctx)
  await assert.rejects(() => ctx.registered.get('role_search').execute({}), /agent-preset registry/)
})

test('delegate_role refuses an unknown role before starting a child', async () => {
  let started = 0
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: PERSONA_YAML }) },
    subagents: { list: () => ['spawn'], getProvider: () => ({ inheritsParentContext: false }), startActivation: async () => { started += 1; return { childId: 'c1' } } },
  })
  registerRoleTools(ctx)
  await assert.rejects(
    () => ctx.registered.get('delegate_role').execute({ role: 'nope', prompt: 'x' }, { agent: { id: 'a' }, signal: undefined }),
    /unknown role/,
  )
  assert.equal(started, 0, 'no child may be started for an unknown role')
})

test('delegate_role starts a child that inherits the parent composition', async () => {
  let seen
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: PERSONA_YAML }) },
    subagents: {
      list: () => ['spawn'],
      getProvider: () => ({ inheritsParentContext: false }),
      startActivation: async (spec) => {
        seen = spec
        return { childId: 'child-1', result: Promise.resolve('done') }
      },
    },
  })
  registerRoleTools(ctx)
  const answer = await ctx.registered.get('delegate_role').execute(
    { role: 'django-security', prompt: 'Audit the auth flow.', description: 'audit auth' },
    { agent: { id: 'parent' }, signal: undefined },
  )
  assert.match(answer, /child-1/)
  assert.equal(seen.provider, 'spawn')
  assert.equal(seen.delivery, 'parent')
  assert.equal(seen.label, 'audit auth')
  // The invariant that keeps the child's toolset intact:
  assert.equal(Object.hasOwn(seen.request, 'agentPreset'), false, 'the child must inherit, never mount a preset')
  assert.match(seen.request.prompt[0].text, /You audit Django apps for security defects\./)
  assert.match(seen.request.prompt[0].text, /Audit the auth flow\./)
})

test('delegate_role refuses a role whose declaration has no persona', async () => {
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: "- id: x\n  name: '@deepseek-ai/dsh-tool-fs'\n" }) },
    subagents: { list: () => ['spawn'], getProvider: () => ({ inheritsParentContext: false }), startActivation: async () => ({ childId: 'c' }) },
  })
  registerRoleTools(ctx)
  await assert.rejects(
    () => ctx.registered.get('delegate_role').execute({ role: 'django-security', prompt: 'x' }, { agent: { id: 'a' }, signal: undefined }),
    /no persona/,
  )
})

test('delegate_role explains an old host without startActivation', async () => {
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: PERSONA_YAML }) },
    subagents: { list: () => ['spawn'], getProvider: () => ({ inheritsParentContext: false }) },
  })
  registerRoleTools(ctx)
  await assert.rejects(
    () => ctx.registered.get('delegate_role').execute({ role: 'django-security', prompt: 'x' }, { agent: { id: 'a' }, signal: undefined }),
    /startActivation/,
  )
})

test('the tools unregister when the plugin is disposed', () => {
  const ctx = fakeContext({ agentPresets: { list: async () => ROSTER } })
  registerRoleTools(ctx)
  assert.equal(ctx.registered.size, 2)
  ctx.disposeAll()
  assert.equal(ctx.registered.size, 0)
})

// ---------------------------------------------------------------------------
// #194 review finding: the depth cap must be FORWARDED.
//
// The host gate compares `request.maxDepth`; omitting the field means no limit,
// not "use the default". Only the official subagent tool reads the configured
// value, so a host-plane tool that omits it can re-delegate without bound.
// ---------------------------------------------------------------------------

test('delegate_role forwards the deployment depth cap', async () => {
  let seen
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: PERSONA_YAML }) },
    subagents: {
      list: () => ['spawn'],
      getProvider: () => ({ inheritsParentContext: false }),
      resolveMaxDepth: () => 3,
      startActivation: async (spec) => {
        seen = spec
        return { childId: 'child-depth' }
      },
    },
  })
  registerRoleTools(ctx)
  await ctx.registered.get('delegate_role').execute(
    { role: 'django-security', prompt: 'Audit.' },
    { agent: { id: 'parent' }, signal: undefined },
  )
  assert.equal(seen.request.maxDepth, 3, 'omitting maxDepth would disable the host gate entirely')
})

test('delegate_role omits maxDepth only when the host cannot resolve one', async () => {
  let seen
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: PERSONA_YAML }) },
    subagents: {
      list: () => ['spawn'],
      getProvider: () => ({ inheritsParentContext: false }),
      resolveMaxDepth: () => undefined,
      startActivation: async (spec) => {
        seen = spec
        return { childId: 'child-nodepth' }
      },
    },
  })
  registerRoleTools(ctx)
  await ctx.registered.get('delegate_role').execute(
    { role: 'django-security', prompt: 'Audit.' },
    { agent: { id: 'parent' }, signal: undefined },
  )
  assert.equal(Object.hasOwn(seen.request, 'maxDepth'), false)
})

test('delegate_role refuses a blank prompt instead of starting an empty child', async () => {
  let started = 0
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: PERSONA_YAML }) },
    subagents: { list: () => ['spawn'], getProvider: () => ({ inheritsParentContext: false }), startActivation: async () => { started += 1; return { childId: 'c' } } },
  })
  registerRoleTools(ctx)
  await assert.rejects(
    () => ctx.registered.get('delegate_role').execute({ role: 'django-security', prompt: '   ' }, { agent: { id: 'a' }, signal: undefined }),
    /prompt/,
  )
  assert.equal(started, 0)
})


// ---------------------------------------------------------------------------
// #194 review finding (P4): the persona test must exercise the REAL loader.
//
// An earlier version injected its own YAML parser, so breaking the production
// loader in role-tools.mjs stayed green. These cases drive the public tool
// instead: the loader is whatever delegate_role actually uses.
// ---------------------------------------------------------------------------

test('delegate_role reads a date-shaped persona through its real loader', async () => {
  let seen
  // A single-line value that looks like a date. Under DEFAULT_SCHEMA the
  // production loader would return a Date, fail the string check, and report
  // 'declares no persona text' even though the persona exists.
  const datePersona = [
    "- id: persona",
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: 2026-11-12',
  ].join('\n')
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: datePersona }) },
    subagents: {
      list: () => ['spawn'],
      getProvider: () => ({ inheritsParentContext: false }),
      startActivation: async (spec) => {
        seen = spec
        return { childId: 'child-date' }
      },
    },
  })
  registerRoleTools(ctx)
  await ctx.registered.get('delegate_role').execute(
    { role: 'django-security', prompt: 'Audit.' },
    { agent: { id: 'parent' }, signal: undefined },
  )
  assert.match(seen.request.prompt[0].text, /2026-11-12/, 'a date-shaped persona must survive as text')
})

test('delegate_role tolerates a !!js tag in a declaration', async () => {
  let seen
  const jsPersona = [
    "- id: persona",
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: !!js some.expression',
  ].join('\n')
  const ctx = fakeContext({
    agentPresets: { list: async () => ROSTER, readDocument: async () => ({ content: jsPersona }) },
    subagents: {
      list: () => ['spawn'],
      getProvider: () => ({ inheritsParentContext: false }),
      startActivation: async (spec) => {
        seen = spec
        return { childId: 'child-js' }
      },
    },
  })
  registerRoleTools(ctx)
  await ctx.registered.get('delegate_role').execute(
    { role: 'django-security', prompt: 'Audit.' },
    { agent: { id: 'parent' }, signal: undefined },
  )
  assert.match(seen.request.prompt[0].text, /some\.expression/, 'the expression is read as text, never evaluated')
})

