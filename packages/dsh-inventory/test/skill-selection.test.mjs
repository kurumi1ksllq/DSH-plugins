import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planSelection, applySelection } from '../lib/skill-selection.js'
import { isSkillDisabled } from '../lib/skill-toggle.js'

const scratch = []
after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may still hold a handle; a temp leftover is harmless.
    }
  }
})

/** A root holding one directory-shaped skill per name, all model-visible. */
function rootWith(names, { disabled = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skill-selection-'))
  scratch.push(root)
  for (const name of names) {
    mkdirSync(join(root, name), { recursive: true })
    const flag = disabled.includes(name) ? 'disable-model-invocation: true\n' : ''
    writeFileSync(
      join(root, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} does a thing.\n${flag}---\n\nBody of ${name}.\n`,
      'utf8',
    )
  }
  writeFileSync(join(root, '.names'), names.join('\n'), 'utf8')
  return root
}

/** Rebuild the scan shape the panel feeds the selector. */
function skillsOf(root) {
  const names = readFileSync(join(root, '.names'), 'utf8').trim().split('\n')
  return names.map((name) => ({
    name,
    path: join(root, name, 'SKILL.md'),
    modelInvocable: !isSkillDisabled(readFileSync(join(root, name, 'SKILL.md'), 'utf8')),
  }))
}

test('plan keeps the named set and marks everything else', () => {
  const skills = [
    { name: 'alpha', path: '/s/alpha/SKILL.md', modelInvocable: true },
    { name: 'beta', path: '/s/beta/SKILL.md', modelInvocable: true },
    { name: 'gamma', path: '/s/gamma/SKILL.md', modelInvocable: true },
  ]
  const plan = planSelection({ skills, keep: ['alpha', 'gamma'] })
  assert.deepEqual(plan.keep, ['alpha', 'gamma'])
  assert.deepEqual(plan.mark.map((skill) => skill.name), ['beta'])
  assert.deepEqual(plan.unmark, [])
  assert.deepEqual(plan.unknown, [])
})

test('plan re-enables a kept skill that was already hidden, and reports unknown names', () => {
  const skills = [
    { name: 'alpha', path: '/s/alpha/SKILL.md', modelInvocable: false },
    { name: 'beta', path: '/s/beta/SKILL.md', modelInvocable: true },
  ]
  const plan = planSelection({ skills, keep: ['alpha', 'typo-name'] })
  assert.deepEqual(plan.unmark.map((skill) => skill.name), ['alpha'])
  assert.deepEqual(plan.mark.map((skill) => skill.name), ['beta'])
  assert.deepEqual(plan.unknown, ['typo-name'])
})

test('apply hides every unkept skill on disk and leaves the kept files byte-identical', () => {
  const root = rootWith(['alpha', 'beta', 'gamma'])
  const beforeAlpha = readFileSync(join(root, 'alpha', 'SKILL.md'), 'utf8')

  const report = applySelection({ skills: skillsOf(root), keep: ['alpha'] })

  assert.deepEqual(report.marked.sort(), ['beta', 'gamma'])
  assert.deepEqual(report.unmarked, [])
  assert.equal(readFileSync(join(root, 'alpha', 'SKILL.md'), 'utf8'), beforeAlpha)
  assert.equal(isSkillDisabled(readFileSync(join(root, 'beta', 'SKILL.md'), 'utf8')), true)
  assert.equal(isSkillDisabled(readFileSync(join(root, 'gamma', 'SKILL.md'), 'utf8')), true)
  assert.match(readFileSync(join(root, 'beta', 'SKILL.md'), 'utf8'), /Body of beta\./)
})

test('apply is idempotent and preserves the skill body', () => {
  const root = rootWith(['alpha', 'beta'])
  applySelection({ skills: skillsOf(root), keep: ['alpha'] })
  const second = applySelection({ skills: skillsOf(root), keep: ['alpha'] })

  assert.deepEqual(second.marked, [])
  assert.deepEqual(second.unmarked, [])
  assert.match(readFileSync(join(root, 'beta', 'SKILL.md'), 'utf8'), /Body of beta\./)
})

test('applying the full set as keep restores every hidden skill', () => {
  const root = rootWith(['alpha', 'beta', 'gamma'])
  applySelection({ skills: skillsOf(root), keep: ['alpha'] })
  const restored = applySelection({ skills: skillsOf(root), keep: ['alpha', 'beta', 'gamma'] })

  assert.equal(restored.unmarked.length, 2)
  for (const name of ['alpha', 'beta', 'gamma']) {
    assert.equal(isSkillDisabled(readFileSync(join(root, name, 'SKILL.md'), 'utf8')), false)
  }
})

test('a dry run reports the plan without touching any file', () => {
  const root = rootWith(['alpha', 'beta'])
  const report = applySelection({ skills: skillsOf(root), keep: ['alpha'], dryRun: true })

  assert.deepEqual(report.marked, ['beta'])
  assert.equal(report.dryRun, true)
  assert.equal(isSkillDisabled(readFileSync(join(root, 'beta', 'SKILL.md'), 'utf8')), false)
})

test('an unknown keep name is reported and never disables the kept set by surprise', () => {
  const root = rootWith(['alpha', 'beta'])
  const report = applySelection({ skills: skillsOf(root), keep: ['alpha', 'nope'] })

  assert.deepEqual(report.unknown, ['nope'])
  assert.equal(isSkillDisabled(readFileSync(join(root, 'beta', 'SKILL.md'), 'utf8')), true)
})

test('a skill file with no frontmatter is reported and does not abort the rest', () => {
  const root = rootWith(['alpha', 'beta'])
  rmSync(join(root, 'beta', 'SKILL.md'))
  writeFileSync(join(root, 'beta', 'SKILL.md'), 'no frontmatter here\n', 'utf8')
  const report = applySelection({ skills: skillsOf(root), keep: ['alpha'] })

  assert.deepEqual(report.marked, [])
  assert.deepEqual(report.failed.map((entry) => entry.name), ['beta'])
  assert.equal(visibleAlpha(root), true)
})

/** alpha must stay model-visible even next to a broken sibling. */
function visibleAlpha(root) {
  return !isSkillDisabled(readFileSync(join(root, 'alpha', 'SKILL.md'), 'utf8'))
}

test('a throwing writer is collected as a failure instead of aborting the sweep', () => {
  const skills = [
    { name: 'alpha', path: '/s/alpha/SKILL.md', modelInvocable: true },
    { name: 'beta', path: '/s/beta/SKILL.md', modelInvocable: true },
  ]
  const wrote = []
  const report = applySelection({
    skills,
    keep: ['alpha'],
    setEnabled: ({ path }) => {
      if (path.includes('beta')) throw new Error('EACCES: read-only file')
      wrote.push(path)
    },
  })

  assert.deepEqual(report.marked, [])
  assert.deepEqual(report.failed.map((entry) => entry.name), ['beta'])
  assert.equal(report.failed[0].message.includes('EACCES'), true)
})
