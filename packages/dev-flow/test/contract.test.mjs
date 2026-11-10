// The flow contract is no longer a skill.
//
// A registered skill is only a *candidate*: it lives in a catalog next to every
// other skill and the model decides whether to load it. Measured on 2026-11-10,
// the live session's catalog held 270 skills and dev-flow was not among them —
// so "改代码先走 dev-flow" was a hope, not a mechanism. This bundle now pushes a
// short contract into the assembled system prompt instead, which every turn
// carries whether or not anyone remembers to load anything.
//
// What these tests hold:
//   1. one systemPrompt context is registered through a managed effect,
//   2. its text carries the two-touch rule and the agent-decides list,
//   3. it points at the shipped FLOW.md rather than duplicating the procedure,
//   4. nothing is registered as a skill any more.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as plugin from '../index.js'
import { renderFlowContract } from '../lib/contract.mjs'
import { lintContract } from '../lib/lint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')

/**
 * A cordis-shaped context that records what the plugin asks for.
 *
 * `skills.register` throws on purpose: registering the flow as a skill is the
 * behaviour this issue removes, and a stub that silently accepts it would let
 * the old code path come back without a red test.
 */
function makeContext() {
  const contexts = []
  const effects = []
  const scope = {
    systemPrompt: {
      context(definition) {
        contexts.push(definition)
        return () => {}
      },
    },
    effect(register, label) {
      effects.push(label)
      return register()
    },
  }
  const ctx = {
    inject(deps, callback) {
      assert.deepEqual(deps, ['systemPrompt'], 'the contract rides the system-prompt service and nothing else')
      callback(scope)
    },
    skills: {
      register() {
        throw new Error('dev-flow must not register a skill: that is the catalog path this issue replaces')
      },
    },
  }
  return { ctx, contexts, effects }
}

describe('dev-flow injects an always-on contract', () => {
  it('is still loadable as a cordis plugin', () => {
    assert.equal(plugin.name, 'dev-flow')
    assert.equal(typeof plugin.apply, 'function')
  })

  it('registers exactly one systemPrompt context', () => {
    const { ctx, contexts } = makeContext()
    plugin.apply(ctx)
    assert.equal(contexts.length, 1)
    const [definition] = contexts
    assert.equal(definition.name, plugin.CONTEXT_NAME)
    assert.equal(typeof definition.order, 'number')
    assert.equal(definition.order, plugin.CONTEXT_ORDER)
  })

  it('places the contract after the discipline blocks and keeps it when runtime context is optional', () => {
    const { ctx, contexts } = makeContext()
    plugin.apply(ctx)
    const [definition] = contexts
    // 20000 = command discipline, 21000 = delegation discipline (dsh-auto-delegation).
    assert.ok(definition.order > 21000, `order ${definition.order} must land after the delegation block`)
    assert.equal(definition.required, true, 'optional runtime context must not drop the flow contract')
  })

  it('registers through a managed effect so a reload cannot leave a duplicate', () => {
    const { ctx, effects } = makeContext()
    plugin.apply(ctx)
    assert.equal(effects.length, 1)
    assert.match(String(effects[0]), /contract/i)
  })

  it('never touches the skill registry', () => {
    const { ctx } = makeContext()
    // The stub throws from skills.register; reaching it fails this test.
    assert.doesNotThrow(() => plugin.apply(ctx))
    assert.equal(plugin.SKILL_NAME, undefined, 'the skill name left with the skill registration')
  })
})

describe('the contract text', () => {
  const text = renderFlowContract({ docPath: '/pkg/FLOW.md' })

  it('asks for exactly two touches and names both', () => {
    assert.match(text, /两次/)
    assert.match(text, /意图/)
    assert.match(text, /合并/)
    // The old flow had three stop points; the third one (spec confirmation) is
    // now the agent's own call, so the number must not creep back in.
    assert.equal(/三个?停点|三次交互/.test(text), false, 'the contract must not reintroduce a third stop point')
  })

  it('takes the technical decisions away from the user', () => {
    for (const decision of ['分级', '裁剪', 'CI', 'review']) {
      assert.match(text, new RegExp(decision), `the contract must say who decides: ${decision}`)
    }
    assert.match(text, /自决|自己判断/, 'the contract must state that the agent decides, not the user')
  })

  it('carries the non-negotiable rules', () => {
    assert.match(text, /禁止直接改 main/)
    assert.match(text, /\.flow\//, 'the board reads docs/specs/.flow/<issue>.json')
  })

  it('points at the shipped procedure instead of duplicating it', () => {
    assert.match(text, /\/pkg\/FLOW\.md/, 'the absolute path of the packaged FLOW.md must appear')
    assert.equal(text.includes('## 任务状态文件'), false, 'the full procedure stays in FLOW.md, not in every turn')
  })

  it('stays short enough to ride every turn', () => {
    assert.ok(text.split('\n').length <= 70, `contract grew to ${text.split('\n').length} lines`)
  })

  it('passes its own contract lint', () => {
    const result = lintContract(text)
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2))
  })
})

describe('packaging', () => {
  it('ships the procedure the contract points at', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    assert.ok(manifest.files.includes('FLOW.md'), 'FLOW.md must ship, or the read at flow start fails after install')
    assert.equal(manifest.files.includes('SKILL.md'), false, 'the skill-named file is gone')
  })

  it('never writes a file', () => {
    const source = readFileSync(join(PACKAGE_ROOT, 'index.js'), 'utf8')
    assert.equal(/writeFile|appendFile|mkdir|unlink|rename/.test(source), false)
  })
})
