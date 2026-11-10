import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOADER } from '../lib/catalog-hint.mjs'
import { setHostApi } from '../lib/host-api.mjs'
import { apply } from '../index.js'

setHostApi({
  renderSkillContent: () => '',
  isModelInvocable: () => true,
  createUserMessage: () => ({}),
})

function registered() {
  const seen = []
  const scope = {
    effect(factory) { return factory() },
    logger: { warn() {} },
    systemPrompt: { section: () => () => {}, context: () => () => {} },
    on: () => () => {},
    skills: { snapshot: () => Promise.resolve({ skills: [], complete: true }), get: () => Promise.resolve(undefined) },
    workingDirectory: { ensure: () => Promise.resolve('/work') },
    tools: { get: () => undefined, register(definition, options) { seen.push({ definition, options }); return () => {} } },
  }
  apply({ inject(_deps, callback) { callback(scope) } })
  return seen.find((row) => row.definition.name === LOADER).definition
}

test('the output schema is raw JSON Schema, not the authoring DSL', () => {
  // #160 review: ctx.tools.register validates output.schema directly, and the
  // host rejects a property-level `required: true`. That throw also rolled back
  // earlier effects, so the loader vanished while the hint still referenced it.
  const definition = registered()
  const schema = definition.output.schema
  assert.equal(schema.type, 'object')
  for (const [name, property] of Object.entries(schema.properties)) {
    assert.equal(property.required, undefined, 'property ' + name + ' must not carry required:true')
  }
  assert.deepEqual(schema.required, ['text'], 'requiredness belongs on the object')
})

test('the parameters stay inside the JSON-Schema subset the host supports', () => {
  const definition = registered()
  for (const property of Object.values(definition.parameters.properties)) {
    assert.ok(['string', 'number', 'boolean', 'array', 'object'].includes(property.type))
    assert.equal(property.required, undefined)
  }
  assert.equal(definition.parameters.additionalProperties, false)
})

test('the installed host accepts the schema it will actually validate', async (t) => {
  // Run the real validator when this checkout can resolve the host package; a
  // linked install may not, and CI never has it. The structural tests above
  // still guard the shape, so a skip is not a hole.
  let check
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    check = mod.assertSupportedJsonSchema ?? mod.default?.assertSupportedJsonSchema
  } catch {
    check = undefined
  }
  if (typeof check !== 'function') {
    t.skip('host @deepseek-ai/dsh-tools is not resolvable from this checkout')
    return
  }
  const definition = registered()
  assert.doesNotThrow(() => check(definition.output.schema))
  assert.doesNotThrow(() => check(definition.parameters))
})
