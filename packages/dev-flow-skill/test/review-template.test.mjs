// The dual-axis review is the only place dev-flow asks for something that has to
// be reproduced verbatim — and the text it told the reader to reuse was never in
// the skill at all ("用下面的固定 prompt 模板", with nothing below it). Every run
// rebuilt the template from memory, which is how review axes quietly diverge.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8')

/** The fenced block that carries the two copy-paste prompts. */
function templateBlock() {
  const blocks = [...SKILL.matchAll(/```(?:text|markdown)?\n([\s\S]*?)```/g)].map((match) => match[1])
  return blocks.filter((block) => block.includes('轴1') && block.includes('轴2'))
}

describe('dev-flow ships the dual-axis review prompt (issue #39)', () => {
  it('SKILL.md carries one copy-paste template for both axes', () => {
    assert.equal(
      templateBlock().length > 0,
      true,
      'SKILL.md must contain a fenced block holding the 轴1/轴2 prompts it tells the reviewer to use',
    )
  })

  it('each axis demands at least three findings or an explicit "no problem"', () => {
    // Slice per axis: slicing 轴1 to the end of the block let 轴2's wording
    // satisfy 轴1's requirement, so deleting 轴1's ask stayed green.
    const [block] = templateBlock()
    assert.notEqual(block, undefined)
    const axes = ['轴1', '轴2']
    for (const [index, axis] of axes.entries()) {
      const start = block.indexOf(axis)
      const end = index + 1 < axes.length ? block.indexOf(axes[index + 1]) : block.length
      assert.ok(start >= 0 && end > start, `template must contain a ${axis} section`)
      const section = block.slice(start, end)
      assert.ok(section.includes('列出至少 3 个问题'), `${axis} must demand at least three findings`)
      assert.ok(section.includes('未发现问题'), `${axis} must allow an explicit "no problem found"`)
      assert.ok(section.includes('只报告'), `${axis} must say "report only"`)
    }
  })

  it('the template tells the reviewer to only report, never edit', () => {
    const [block] = templateBlock()
    assert.notEqual(block, undefined)
    assert.match(block, /不得即兴改写/, 'the template must forbid improvising it')
    assert.match(block, /spec/, '轴1 must be given the spec, not only the diff')
    assert.match(block, /diff/, 'the reviewer must be given the full diff')
  })
})
