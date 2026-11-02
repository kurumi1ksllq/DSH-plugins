import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lintSkill, LINT_RULES } from '../lib/lint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8')

describe('dev-flow writes its own task state (issue #26)', () => {
  it('declares a state-file section in the lint contract', () => {
    const rule = LINT_RULES.find((r) => r.id === 'flow-state')
    assert.notEqual(rule, undefined, 'LINT_RULES must require a 任务状态文件 section')
    assert.equal(rule.type, 'required-section')
  })

  it('SKILL.md carries the state-file section', () => {
    assert.ok(/^##\s*任务状态文件/m.test(SKILL), 'missing "## 任务状态文件"')
  })

  it('SKILL.md names the exact file path the panel reads', () => {
    assert.ok(SKILL.includes('docs/specs/.flow/<issue>.json'), 'the path must match lib/flow-state.js')
  })

  it('SKILL.md lists the eight stage values the board renders', () => {
    for (const stage of ['intake', 'spec', 'dev', 'pr', 'ci', 'review', 'merge', 'done']) {
      assert.ok(SKILL.includes(stage), `missing stage value ${stage}`)
    }
  })

  it('SKILL.md states that git evidence wins over a stale state file', () => {
    assert.match(SKILL, /以(仓库|实况|git)/i, 'must say evidence beats the recorded stage')
  })

  it('the real SKILL.md still passes the full lint', () => {
    const result = lintSkill(SKILL)
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2))
    assert.equal(result.ok, true)
  })

  it('lint reports the missing section on an old document', () => {
    const legacy = SKILL.replace(/^##\s*任务状态文件[\s\S]*?(?=^##\s)/m, '')
    const result = lintSkill(legacy)
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.rule === 'flow-state'), 'lint must catch the removal')
  })
})
