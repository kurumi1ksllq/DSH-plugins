import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'
import { LOADER } from '../lib/catalog-hint.mjs'

// #204: injectedSkills() keys a WeakMap by agent, so an assembly that runs the
// tool with no agent threw "Invalid value used as weak map key" instead of
// returning the body. The official skill tool tolerates that shape
// (dsh-tool-skill/lib/index.js:869); this bundle must too.
//
// The bookkeeping is a nudge-suppression record. With no agent there is no
// conversation to suppress a nudge in, so skipping the record is the whole fix.

function skillRow(name, { content = 'body-of-' + name } = {}) {
  return { name, description: name + ' description for the loader.', provider: 'filesystem', content, invocation: { modelInvocable: true } }
}

function harness(rows) {
  const all = rows ?? [skillRow('alpha-skill'), skillRow('beta-skill')]
  const registered = []
  const scope = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    systemPrompt: { section: () => () => {}, context: () => () => {} },
    on: () => () => {},
    skills: {
      snapshot: () => Promise.resolve({ skills: all.map(({ name, description, provider, invocation }) => ({ name, description, provider, invocation })), complete: true }),
      get: (name) => Promise.resolve(all.find((skill) => skill.name === name)),
    },
    // Host-faithful: the real ensure() reads agent.session on its FIRST line
    // (dsh-working-directory/lib/index.js:91-93). A stub returning '/work'
    // unconditionally hid that the loader threw before reaching bodyFor(), which
    // is exactly how the first version of this fix passed its own tests (#204).
    workingDirectory: {
      ensure(agent) {
        if (agent === undefined) throw new TypeError("Cannot read properties of undefined (reading 'session')")
        return Promise.resolve('/work')
      },
    },
    tools: { get: () => undefined, register(definition) { registered.push(definition); return () => {} } },
  }
  apply({ inject(_deps, callback) { callback(scope) } })
  return registered.find((definition) => definition.name === LOADER)
}

setHostApi({
  renderSkillContent: (skill) => '<skill_content name="' + skill.name + '">' + skill.content + '</skill_content>',
  isModelInvocable: (skill) => skill.invocation.modelInvocable === true,
  createUserMessage: ({ content, source }) => ({ role: 'user', content, source }),
})

test('204-1: a single-hit query with NO agent returns the body instead of throwing', async () => {
  // The regression #201 introduced: this path used to return a listing, then
  // started throwing once it began rendering the body.
  const result = await harness().execute({ query: 'alpha' }, { agent: undefined, signal: undefined })
  assert.match(result.text, /body-of-alpha-skill/)
})

test('204-2: a named load with NO agent returns the body instead of throwing', async () => {
  // Pre-existing breakage, untouched by #201, fixed here because it is the same line.
  const result = await harness().execute({ name: 'beta-skill' }, { agent: undefined, signal: undefined })
  assert.match(result.text, /body-of-beta-skill/)
})

test('204-3: with an agent the load is still RECORDED, so the nudge stays silent', async () => {
  // The guard must not swallow the bookkeeping on the path that has an agent.
  const agent = { session: { seq: 0, eventAt: () => undefined } }
  await harness().execute({ name: 'alpha-skill' }, { agent, signal: undefined })
  const { injectedSkills } = await import('../lib/handoff.mjs')
  assert.equal(injectedSkills(agent).has('alpha-skill'), true)
})

test('204-4: a multi-hit query with no agent still lists, unchanged', async () => {
  const result = await harness().execute({ query: 'skill' }, { agent: undefined, signal: undefined })
  assert.match(result.text, /可用技能 2 个/u)
})
