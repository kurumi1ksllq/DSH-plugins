import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanSkillRoots } from '../lib/scan-skills.js'
import { moveIntoVault, moveOutOfVault, scanVault, vaultDir, vaultRoots } from '../lib/vault.js'

/**
 * The skill vault: registered-but-inactive skills live outside every scanned
 * root, and moving one is a rename — the workspace links that point at it must
 * keep pointing at the same single copy.
 */

const SKILL_TEXT = (name) => `---\nname: ${name}\ndescription: ${name} fixture\n---\n# ${name}\n\nbody\n`

function homeFixture() {
  const home = mkdtempSync(join(tmpdir(), 'inv-vault-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  return {
    home,
    skillsRoot: join(home, 'skills'),
    restore() {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    },
  }
}

function writeDirSkill(root, name) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), SKILL_TEXT(name), 'utf8')
  return join(dir, 'SKILL.md')
}

function writeFileSkill(root, name) {
  mkdirSync(root, { recursive: true })
  const file = join(root, `${name}.md`)
  writeFileSync(file, SKILL_TEXT(name), 'utf8')
  return file
}

function scanUserRoot(root) {
  return scanSkillRoots([{ dir: root, source: 'user-dsh', rank: 400 }]).skills
}

test('the vault lives under DSH_HOME and is scanned as source vault', () => {
  const fixture = homeFixture()
  try {
    assert.equal(vaultDir(), join(fixture.home, 'inventory', 'skills'))
    assert.deepEqual(vaultRoots(), [{ dir: vaultDir(), source: 'vault', rank: 350 }])
  } finally {
    fixture.restore()
  }
})

test('without DSH_HOME the vault falls back to ~/.dsh', () => {
  const previous = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    assert.equal(vaultDir(), join(homedir(), '.dsh', 'inventory', 'skills'))
  } finally {
    if (previous !== undefined) process.env.DSH_HOME = previous
  }
})

test('moveIntoVault moves a directory skill and keeps its SKILL.md', () => {
  const fixture = homeFixture()
  try {
    const sourceFile = writeDirSkill(fixture.skillsRoot, 'demo-skill')
    const skill = scanUserRoot(fixture.skillsRoot).find((item) => item.name === 'demo-skill')
    assert.ok(skill, 'fixture skill was not scanned')

    const result = moveIntoVault(skill)

    assert.equal(result.ok, true)
    assert.equal(result.name, 'demo-skill')
    assert.equal(result.from, join(fixture.skillsRoot, 'demo-skill'))
    assert.equal(result.to, join(vaultDir(), 'demo-skill'))
    assert.equal(existsSync(sourceFile), false, 'the source directory must be gone after the move')
    assert.equal(readFileSync(join(result.to, 'SKILL.md'), 'utf8'), SKILL_TEXT('demo-skill'))
  } finally {
    fixture.restore()
  }
})

test('moveIntoVault moves a single-file skill as <name>.md', () => {
  const fixture = homeFixture()
  try {
    const sourceFile = writeFileSkill(fixture.skillsRoot, 'single-skill')
    const skill = scanUserRoot(fixture.skillsRoot).find((item) => item.name === 'single-skill')
    assert.ok(skill, 'single-file skill was not scanned')

    const result = moveIntoVault(skill)

    assert.equal(result.ok, true)
    assert.equal(result.from, sourceFile)
    assert.equal(result.to, join(vaultDir(), 'single-skill.md'))
    assert.equal(existsSync(sourceFile), false)
    assert.equal(readFileSync(result.to, 'utf8'), SKILL_TEXT('single-skill'))
  } finally {
    fixture.restore()
  }
})

test('moveIntoVault refuses to overwrite a vaulted skill and leaves the source alone', () => {
  const fixture = homeFixture()
  try {
    writeDirSkill(fixture.skillsRoot, 'demo-skill')
    const vaultedDir = join(vaultDir(), 'demo-skill')
    mkdirSync(vaultedDir, { recursive: true })
    writeFileSync(join(vaultedDir, 'SKILL.md'), `${SKILL_TEXT('demo-skill')}vault copy\n`, 'utf8')

    const skill = scanUserRoot(fixture.skillsRoot).find((item) => item.name === 'demo-skill')
    const result = moveIntoVault(skill)

    assert.equal(result.ok, false)
    assert.equal(typeof result.error, 'string')
    assert.ok(result.error.length > 0)
    assert.equal(existsSync(join(fixture.skillsRoot, 'demo-skill', 'SKILL.md')), true, 'the source must stay in place')
    assert.match(readFileSync(join(vaultedDir, 'SKILL.md'), 'utf8'), /vault copy/, 'the vault copy must not be overwritten')
  } finally {
    fixture.restore()
  }
})

test('scanVault finds the moved skill with source vault', () => {
  const fixture = homeFixture()
  try {
    writeDirSkill(fixture.skillsRoot, 'demo-skill')
    const skill = scanUserRoot(fixture.skillsRoot).find((item) => item.name === 'demo-skill')
    const moved = moveIntoVault(skill)

    const { skills } = scanVault()
    const found = skills.find((item) => item.name === 'demo-skill')

    assert.ok(found, 'the vault scan did not find the moved skill')
    assert.equal(found.source, 'vault')
    assert.equal(found.path, join(moved.to, 'SKILL.md'))
  } finally {
    fixture.restore()
  }
})

test('moveOutOfVault moves a vaulted directory skill back to the user root', () => {
  const fixture = homeFixture()
  try {
    writeDirSkill(fixture.skillsRoot, 'demo-skill')
    const skill = scanUserRoot(fixture.skillsRoot).find((item) => item.name === 'demo-skill')
    const moved = moveIntoVault(skill)

    const result = moveOutOfVault('demo-skill')

    assert.equal(result.ok, true)
    assert.equal(result.name, 'demo-skill')
    assert.equal(result.from, moved.to)
    assert.equal(result.to, join(fixture.skillsRoot, 'demo-skill'))
    assert.equal(existsSync(moved.to), false, 'the vault copy must be gone after moving out')
    assert.equal(readFileSync(join(result.to, 'SKILL.md'), 'utf8'), SKILL_TEXT('demo-skill'))
    assert.equal(scanVault().skills.some((item) => item.name === 'demo-skill'), false)
  } finally {
    fixture.restore()
  }
})

test('moveOutOfVault moves a vaulted single-file skill back as <name>.md', () => {
  const fixture = homeFixture()
  try {
    writeFileSkill(fixture.skillsRoot, 'single-skill')
    const skill = scanUserRoot(fixture.skillsRoot).find((item) => item.name === 'single-skill')
    moveIntoVault(skill)

    const result = moveOutOfVault('single-skill')

    assert.equal(result.ok, true)
    assert.equal(result.to, join(fixture.skillsRoot, 'single-skill.md'))
    assert.equal(readFileSync(result.to, 'utf8'), SKILL_TEXT('single-skill'))
    assert.equal(existsSync(join(vaultDir(), 'single-skill.md')), false)
  } finally {
    fixture.restore()
  }
})

test('moveOutOfVault refuses to overwrite a global skill and leaves the vault copy alone', () => {
  const fixture = homeFixture()
  try {
    writeDirSkill(fixture.skillsRoot, 'demo-skill')
    const skill = scanUserRoot(fixture.skillsRoot).find((item) => item.name === 'demo-skill')
    const moved = moveIntoVault(skill)
    writeDirSkill(fixture.skillsRoot, 'demo-skill')

    const result = moveOutOfVault('demo-skill')

    assert.equal(result.ok, false)
    assert.equal(typeof result.error, 'string')
    assert.equal(existsSync(join(moved.to, 'SKILL.md')), true, 'the vault copy must stay')
    assert.equal(readFileSync(join(fixture.skillsRoot, 'demo-skill', 'SKILL.md'), 'utf8'), SKILL_TEXT('demo-skill'))
  } finally {
    fixture.restore()
  }
})

test('moveOutOfVault reports a missing name instead of throwing', () => {
  const fixture = homeFixture()
  try {
    const result = moveOutOfVault('ghost-skill')

    assert.equal(result.ok, false)
    assert.equal(typeof result.error, 'string')
    assert.ok(result.error.length > 0)
  } finally {
    fixture.restore()
  }
})
