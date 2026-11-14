import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from '../index.js'

/**
 * Collect every `ctx.inject(deps, callback)` the plugin makes, keyed by the
 * dependency it asked for. Keyed rather than ordered: #194 added a second
 * injection ('tools'), and asserting a call order would test the sequence of
 * two independent registrations instead of what each one does.
 */
function injections(ctx) {
  const calls = []
  ctx.inject = (deps, callback) => calls.push({ deps, callback })
  return calls
}

test('apply registers the delegation context through systemPrompt.inject', () => {
  const ctx = {}
  const calls = injections(ctx)
  apply(ctx)
  const promptCall = calls.find((call) => call.deps.includes('systemPrompt'))
  assert.ok(promptCall, 'apply must inject systemPrompt')

  const registered = []
  const effects = []
  const scope = {
    effect(factory, label) {
      effects.push(label)
      factory()
    },
    systemPrompt: {
      context(row) {
        registered.push(row)
        return () => {}
      },
    },
  }
  promptCall.callback(scope)
  assert.deepEqual(effects, ['auto-delegation discipline context'])
  assert.equal(registered.length, 1, 'exactly one context segment')
  const [row] = registered
  assert.equal(row.name, 'dsh:auto-delegation-discipline')
  assert.equal(row.order, 21000)
  const text = row.text()
  assert.ok(text.includes('## 自动委派编排'), 'segment text renders the discipline section')
  assert.ok(text.includes('`python-reviewer`'), 'segment text renders the role table')
})

test('apply registers the role tools through tools.inject', () => {
  const ctx = {}
  const calls = injections(ctx)
  apply(ctx)
  const toolsCall = calls.find((call) => call.deps.includes('tools'))
  assert.ok(toolsCall, 'apply must inject tools')

  const names = []
  const scope = {
    effect(factory) {
      factory()
    },
    tools: {
      register(definition) {
        names.push(definition.name)
        return () => {}
      },
    },
    get() {
      return undefined
    },
  }
  toolsCall.callback(scope)
  assert.deepEqual(names.sort(), ['delegate_role', 'role_search'])
})

test('apply is inert when the host lacks ctx.inject', () => {
  assert.doesNotThrow(() => apply({}))
})
