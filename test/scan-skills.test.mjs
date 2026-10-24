import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseFrontmatter, scanSkillRoots } from '../lib/scan-skills.js'

function bundle(root, dir, frontmatter, body = '# body\n') {
  mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`)
}

test('parses quoted, boolean and plain frontmatter values', () => {
  const data = parseFrontmatter('---\nname: alpha\ndescription: "a: b"\ndisable-model-invocation: true\n---\nbody\n')
  assert.equal(data.name, 'alpha')
  assert.equal(data.description, 'a: b')
  assert.equal(data['disable-model-invocation'], true)
  assert.equal(data.body, 'body\n')
})

test('parses CRLF frontmatter (files written by Windows editors)', () => {
  const data = parseFrontmatter('---\r\nname: officecli\r\ndescription: Office CLI\r\n---\r\n# body\r\n')
  assert.equal(data.name, 'officecli')
  assert.equal(data.description, 'Office CLI')
})

test('follows a symlinked skill directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-skills-link-'))
  const real = mkdtempSync(join(tmpdir(), 'inv-skills-real-'))
  writeFileSync(join(real, 'SKILL.md'), '---\nname: linked\ndescription: Linked skill\n---\n# linked\n')
  try {
    symlinkSync(real, join(root, 'linked'), 'junction')
  } catch {
    return // symlink creation not permitted on this host; covered by the plain scan test
  }
  const { skills } = scanSkillRoots([{ dir: root, source: 'user-dsh', rank: 400 }])
  assert.deepEqual(skills.map((s) => s.name), ['linked'])
})

test('scans bundle dirs and flat files, flags shadowed skills, skips broken ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'inv-skills-'))
  bundle(root, 'alpha', 'name: alpha\ndescription: Alpha skill')
  bundle(root, 'beta', 'name: beta\ndescription: Beta skill\ndisable-model-invocation: true')
  writeFileSync(join(root, 'flat.md'), '---\nname: flat\ndescription: Flat skill\n---\n# flat\n')
  bundle(root, 'broken', 'name: broken')
  bundle(root, 'nested/deep', 'name: deep\ndescription: should be ignored')

  const { skills, diagnostics } = scanSkillRoots([{ dir: root, source: 'user-dsh', rank: 400 }])
  const names = skills.map((s) => s.name).sort()

  assert.deepEqual(names, ['alpha', 'beta', 'flat'])
  const beta = skills.find((s) => s.name === 'beta')
  assert.equal(beta.disabled, true)
  assert.equal(beta.modelInvocable, false)
  assert.equal(beta.source, 'user-dsh')
  assert.equal(beta.path.endsWith('SKILL.md'), true)
  assert.ok(diagnostics.some((d) => d.kind === 'invalid-frontmatter' && d.path.includes('broken')))
})

test('a missing or unreadable root is skipped without diagnostics noise', () => {
  const result = scanSkillRoots([
    { dir: join(tmpdir(), 'inv-does-not-exist-' + Date.now()), source: 'project-dsh', rank: 100 },
    null,
    { source: 'broken-entry', rank: 400 },
  ])
  assert.deepEqual(result.skills, [])
  assert.deepEqual(result.diagnostics, [])
})

test('a lower rank wins a duplicate name and the loser is reported', () => {
  const project = mkdtempSync(join(tmpdir(), 'inv-skills-proj-'))
  const user = mkdtempSync(join(tmpdir(), 'inv-skills-user-'))
  bundle(project, 'alpha', 'name: alpha\ndescription: Project variant')
  bundle(user, 'alpha', 'name: alpha\ndescription: User variant')

  const { skills, diagnostics } = scanSkillRoots([
    { dir: project, source: 'project-dsh', rank: 100 },
    { dir: user, source: 'user-dsh', rank: 400 },
  ])

  const alpha = skills.filter((s) => s.name === 'alpha')
  assert.equal(alpha.length, 1)
  assert.equal(alpha[0].source, 'project-dsh')
  assert.ok(diagnostics.some((d) => d.kind === 'duplicate' && d.name === 'alpha'))
})
