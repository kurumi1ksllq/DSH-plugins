import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lintSkill, LINT_RULES } from '../lib/lint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8')

describe('lintSkill contract', () => {
  it('passes on the real SKILL.md', () => {
    const result = lintSkill(SKILL)
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2))
    assert.equal(result.ok, true)
  })

  it('rejects non-string input', () => {
    assert.equal(lintSkill(null).ok, false)
    assert.equal(lintSkill(undefined).ok, false)
    assert.equal(lintSkill(42).ok, false)
  })

  it('rejects content without frontmatter', () => {
    const result = lintSkill('# no frontmatter\n')
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.rule === 'frontmatter'))
  })

  it('rejects missing trigger words in description', () => {
    const body = `---
name: dev-flow
description: 一个流程文档
---

# dev-flow
`
    const result = lintSkill(body)
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.rule === 'triggers'))
  })

  it('rejects the forbidden phrase 双保险', () => {
    const body = `---
name: dev-flow
description: 触发词 dev-flow
---
双保险
`
    const result = lintSkill(body)
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.rule === 'forbidden-phrase'))
  })

  it('flags every required section that is missing', () => {
    const body = `---
name: dev-flow
description: 触发词 dev-flow
---
`
    const result = lintSkill(body)
    assert.equal(result.ok, false)
    const rules = new Set(result.violations.map((v) => v.rule))
    for (const required of LINT_RULES.filter((r) => r.type === 'required-section')) {
      assert.ok(rules.has(required.id), `missing rule ${required.id} not reported`)
    }
  })

  it('reports rule id, message and how-to-fix for each violation', () => {
    const result = lintSkill('garbage')
    for (const violation of result.violations) {
      assert.equal(typeof violation.rule, 'string')
      assert.equal(typeof violation.message, 'string')
      assert.equal(typeof violation.fix, 'string')
    }
  })
})
