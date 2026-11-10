import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONTRACT_REQUIRED, LINT_RULES, lintContract, lintFlowDoc } from '../lib/lint.mjs'
import { renderFlowContract } from '../lib/contract.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FLOW = readFileSync(join(HERE, '..', 'FLOW.md'), 'utf8')

describe('lintFlowDoc contract', () => {
  it('passes on the real FLOW.md', () => {
    const result = lintFlowDoc(FLOW)
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2))
    assert.equal(result.ok, true)
  })

  it('rejects non-string input', () => {
    for (const input of [null, undefined, 42]) assert.equal(lintFlowDoc(input).ok, false)
  })

  it('flags every required section that is missing', () => {
    const result = lintFlowDoc('# 空文档\n')
    assert.equal(result.ok, false)
    const rules = new Set(result.violations.map((violation) => violation.rule))
    for (const required of LINT_RULES) assert.ok(rules.has(required.id), 'missing rule ' + required.id + ' not reported')
  })

  it('rejects a section that appears twice', () => {
    const doubled = FLOW + '\n## 两次交互\n\n重复的一节\n'
    const result = lintFlowDoc(doubled)
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((violation) => violation.rule === 'touches'))
  })

  it('rejects the phrases that hand judgement back to the user', () => {
    // The whole point of #154 is that the user is not asked to referee
    // technical choices; these phrases are how that regression is written back.
    for (const phrase of ['用户点头', '必须用户明示']) {
      const result = lintFlowDoc(FLOW + '\n' + phrase + '\n')
      assert.equal(result.ok, false, 'lint must reject ' + phrase)
      assert.ok(result.violations.some((violation) => violation.rule === 'forbidden-phrase'))
    }
  })

  it('reports rule id, message and how-to-fix for each violation', () => {
    for (const violation of lintFlowDoc('garbage').violations) {
      assert.equal(typeof violation.rule, 'string')
      assert.equal(typeof violation.message, 'string')
      assert.equal(typeof violation.fix, 'string')
    }
  })
})

describe('lintContract', () => {
  const text = renderFlowContract({ docPath: '/pkg/FLOW.md' })

  it('passes on the rendered contract', () => {
    const result = lintContract(text)
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2))
  })

  it('rejects empty text', () => {
    assert.equal(lintContract('').ok, false)
    assert.equal(lintContract(null).ok, false)
  })

  it('flags each missing marker', () => {
    const result = lintContract('只有一句话')
    const missing = result.violations.map((violation) => violation.message).join('|')
    for (const [marker] of CONTRACT_REQUIRED) assert.ok(missing.includes(marker), 'missing marker ' + marker + ' not reported')
  })

  it('flags a contract that grew too heavy to ride every turn', () => {
    // Padding characters, not lines: a long paragraph on every existing line
    // keeps the line count and still multiplies what each turn pays.
    const padded = text + '这一句是废话,却每轮都要付费。'.repeat(60)
    const result = lintContract(padded)
    assert.ok(result.violations.some((violation) => violation.rule === 'contract-length'), 'the budget is characters, not lines')
  })

  it('bans the same hand-it-back-to-the-user phrases inside the contract', () => {
    // The injected text is read on every turn, so it is held to at least the
    // standard FLOW.md is: writing 「用户点头」 back here must go red even when
    // the document itself stays clean.
    const result = lintContract(text + '\n本流程的分级必须用户明示。\n')
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((violation) => violation.rule === 'forbidden-phrase'))
  })

  it('requires the safety and test-discipline markers', () => {
    for (const marker of ['禁测私有函数', '破坏性操作']) {
      const result = lintContract(text.replaceAll(marker, '删掉'))
      assert.equal(result.ok, false, 'removing ' + marker + ' must be caught')
    }
  })
})
