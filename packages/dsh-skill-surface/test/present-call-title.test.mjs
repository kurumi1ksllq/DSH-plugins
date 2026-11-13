import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { setHostApi } from '../lib/host-api.mjs'
import { LOADER } from '../lib/catalog-hint.mjs'

// #203: the card title is the ONLY thing a reader sees in a session log, so it
// must describe what execute() actually does. #201 made a single-hit query
// return a skill BODY; a title still saying "List skills" misleads whoever
// debugs that session later.

setHostApi({
  renderSkillContent: () => '',
  isModelInvocable: () => true,
  createUserMessage: () => ({}),
})

function loader() {
  const seen = []
  const scope = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    systemPrompt: { section: () => () => {}, context: () => () => {} },
    on: () => () => {},
    skills: { snapshot: () => Promise.resolve({ skills: [], complete: true }), get: () => Promise.resolve(undefined) },
    workingDirectory: { ensure: () => Promise.resolve('/work') },
    tools: { get: () => undefined, register(definition) { seen.push(definition); return () => {} } },
  }
  apply({ inject(_deps, callback) { callback(scope) } })
  return seen.find((definition) => definition.name === LOADER)
}

test('203-1: a query that is not blank is presented as a search, not as a listing', () => {
  const title = loader().presentCall({ query: 'alpha' }).title
  assert.notEqual(title, 'List skills', 'a query narrows the catalog; "List skills" hides that')
  assert.match(title, /alpha/, 'the query itself belongs in the title so the log line is identifiable')
})

test('203-2: a blank query is still a LIST request, matching what execute() does with it', () => {
  // 201-13 fixed the same ambiguity in execute(): whitespace is not a filter.
  // The presenter must not disagree with the executor about that.
  for (const args of [{ query: '' }, { query: '   ' }]) {
    assert.equal(loader().presentCall(args).title, 'List skills', JSON.stringify(args))
  }
})

test('203-3: an explicit name is presented as a load, unchanged from before', () => {
  const view = loader().presentCall({ name: 'alpha-skill' })
  assert.equal(view.title, 'Load skill alpha-skill')
  assert.equal(view.rawInput, 'alpha-skill')
})

test('203-4: a name wins over a query in the card, exactly as it does in execute()', () => {
  const view = loader().presentCall({ name: 'beta-skill', query: 'alpha' })
  assert.equal(view.title, 'Load skill beta-skill', 'the card must show the branch that will actually run')
})

test('203-5: a call with no arguments is the plain listing', () => {
  const view = loader().presentCall({})
  assert.equal(view.title, 'List skills')
  assert.equal(view.rawInput, '')
})
