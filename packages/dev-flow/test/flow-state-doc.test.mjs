import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LINT_RULES, lintFlowDoc } from '../lib/lint.mjs'
import { FLOW_DIR, STAGES } from '../lib-git-status/flow-state.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FLOW = readFileSync(join(HERE, '..', 'FLOW.md'), 'utf8')

describe('dev-flow writes its own task state (issue #26)', () => {
  it('declares a state-file section in the lint contract', () => {
    const rule = LINT_RULES.find((r) => r.id === 'flow-state')
    assert.notEqual(rule, undefined, 'LINT_RULES must require a 任务状态文件 section')
    assert.equal(rule.type, 'required-section')
  })

  it('FLOW.md carries the state-file section', () => {
    assert.ok(/^##\s*任务状态文件/m.test(FLOW), 'missing "## 任务状态文件"')
  })

  it('FLOW.md names the exact file path the panel reads', () => {
    assert.ok(FLOW.includes(FLOW_DIR.join('/') + '/<issue>.json'), 'the path must match lib-git-status/flow-state.js (shared FLOW_DIR)')
  })

  it('FLOW.md lists the eight stage values the board renders', () => {
    for (const stage of STAGES) {
      assert.ok(FLOW.includes(stage), `missing stage value ${stage}`)
    }
  })

  it('FLOW.md states that git evidence wins over a stale state file', () => {
    assert.match(FLOW, /以(仓库|实况|git)/i, 'must say evidence beats the recorded stage')
  })

  it('the real FLOW.md still passes the full lint', () => {
    const result = lintFlowDoc(FLOW)
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2))
    assert.equal(result.ok, true)
  })

  it('lint reports the missing section on an old document', () => {
    const legacy = FLOW.replace(/^##\s*任务状态文件[\s\S]*?(?=^##\s)/m, '')
    const result = lintFlowDoc(legacy)
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.rule === 'flow-state'), 'lint must catch the removal')
  })
})
