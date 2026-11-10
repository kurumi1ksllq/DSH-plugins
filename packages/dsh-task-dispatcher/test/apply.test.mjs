import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from '../index.js'

test('apply registers the delegation context through systemPrompt.inject', () => {
  const registered = []
  let inner
  const ctx = {
    inject(deps, callback) {
      assert.deepEqual(deps, ['systemPrompt'])
      inner = callback
    },
  }
  apply(ctx)
  assert.ok(typeof inner === 'function', 'apply must hand a callback to ctx.inject')

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
  inner(scope)
  assert.deepEqual(effects, ['auto-delegation discipline context'])
  assert.equal(registered.length, 1, 'exactly one context segment')
  const [row] = registered
  assert.equal(row.name, 'dsh:auto-delegation-discipline')
  assert.equal(row.order, 21000)
  const text = row.text()
  assert.ok(text.includes('## 自动委派编排'), 'segment text renders the discipline section')
  assert.ok(text.includes('`planner`'), 'segment text renders the routing table')
})

test('apply is inert when the host lacks ctx.inject', () => {
  assert.doesNotThrow(() => apply({}))
})
