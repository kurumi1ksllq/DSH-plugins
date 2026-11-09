/*
 * Regression tests (this file) for the open sync issues:
 *
 *   #5  a pulled skill is copied into the vault AND linked into a skill root,
 *       and a failed link is visible in the per-item result instead of being
 *       reported as a healthy install.
 *   #8  a failed `pnpm install` restores the exact prior `package.json` bytes,
 *       says so in the error, and does not claim a rollback when nothing was
 *       written in the first place.
 *
 * Only public behaviour is asserted: no private helpers are imported and no
 * call counts / internal ordering are checked.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyItems, copySkill } from '../lib/sync-apply.js'

function scratch(prefix = 'dsh-issue-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A profile directory holding `package.json` with the given raw content. */
function makeProfile(content = JSON.stringify({ name: 'profile', dependencies: {} }, null, 2)) {
  const dir = scratch('dsh-profile-')
  writeFileSync(join(dir, 'package.json'), content)
  return dir
}

/** A plugin repository clone with `skills/<name>/SKILL.md` for each name. */
function makeSkillRepo(names) {
  const root = scratch('dsh-repo-')
  for (const name of names) {
    mkdirSync(join(root, 'skills', name), { recursive: true })
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), `# ${name}`)
  }
  return root
}

/** An executable file that always exits with `code`, usable as `pnpmBin`. */
function makeStubBinary(code) {
  const dir = scratch('dsh-bin-')
  const bin = join(dir, 'pnpm-stub.sh')
  writeFileSync(bin, `#!/bin/sh\necho "stub pnpm refusing to run" >&2\nexit ${code}\n`, { mode: 0o755 })
  return bin
}

/** A directory-like path whose parent is a regular file: links into it fail. */
function unusableSkillRoot() {
  const dir = scratch('dsh-badroot-')
  const file = join(dir, 'not-a-dir')
  writeFileSync(file, 'x')
  return join(file, 'skills')
}

// ---- #5 -------------------------------------------------------------------

test('#5 copySkill links the vaulted skill into the given skill root', () => {
  const repoRoot = makeSkillRepo(['ui-design'])
  const vaultDir = scratch('dsh-vault-')
  const skillRoot = scratch('dsh-skills-')
  const result = copySkill({ kind: 'skill', name: 'ui-design' }, { repoRoot, vaultDir, skillRoot })
  assert.equal(result.ok, true)
  assert.equal(result.linked, true)
  assert.equal(result.linkError, undefined)
  // Two copies of the content: the vault and the root the model actually scans.
  assert.equal(existsSync(join(vaultDir, 'ui-design', 'SKILL.md')), true)
  assert.equal(existsSync(join(skillRoot, 'ui-design', 'SKILL.md')), true)
})

test('#5 copySkill onto an already-populated skill root still succeeds', () => {
  const repoRoot = makeSkillRepo(['ui-design'])
  const vaultDir = scratch('dsh-vault-')
  const skillRoot = scratch('dsh-skills-')
  // A previous install left a link (or a copy) at the target path.
  mkdirSync(join(skillRoot, 'ui-design'), { recursive: true })
  writeFileSync(join(skillRoot, 'ui-design', 'SKILL.md'), '# old')
  const result = copySkill({ kind: 'skill', name: 'ui-design' }, { repoRoot, vaultDir, skillRoot })
  assert.equal(result.ok, true)
  assert.equal(result.linked, true)
  assert.equal(existsSync(join(skillRoot, 'ui-design', 'SKILL.md')), true)
})

test('#5 copySkill defaults the skill root to $DSH_HOME/skills when the profile has none', () => {
  const home = scratch('dsh-home-')
  const previous = process.env.DSH_HOME
  const previousAgents = process.env.DSH_AGENTS_HOME
  const previousCustom = process.env.DSH_CUSTOM_SKILL_DIRS
  process.env.DSH_HOME = home
  // Isolate the real user dirs (issue #143): skillRootOf prefers the first
  // EXISTING root among $DSH_HOME/skills, $DSH_AGENTS_HOME/skills (defaults to
  // ~/.agents/skills) and DSH_CUSTOM_SKILL_DIRS. With /root/.agents/skills
  // present the resolver correctly picks it — but this test asserts the
  // $DSH_HOME/skills fallback, so the "no agents/custom root" premise must be
  // guaranteed. Without isolation this test also wrote dangling symlinks into
  // the real user directory.
  process.env.DSH_AGENTS_HOME = join(home, 'agents-home')
  delete process.env.DSH_CUSTOM_SKILL_DIRS
  try {
    const result = copySkill(
      { kind: 'skill', name: 'ui-design' },
      { repoRoot: makeSkillRepo(['ui-design']), vaultDir: scratch('dsh-vault-') },
    )
    assert.equal(result.ok, true)
    assert.equal(result.linked, true)
    // Vaulted skills are invisible to every scanner; the user skill root is
    // the one DSH reads, so the fallback must land there.
    assert.equal(existsSync(join(home, 'skills', 'ui-design', 'SKILL.md')), true)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    if (previousAgents === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = previousAgents
    if (previousCustom === undefined) delete process.env.DSH_CUSTOM_SKILL_DIRS
    else process.env.DSH_CUSTOM_SKILL_DIRS = previousCustom
  }
})

test('#5 copySkill reports a failed link instead of claiming success', () => {
  const skillRoot = unusableSkillRoot()
  const result = copySkill(
    { kind: 'skill', name: 'ui-design' },
    { repoRoot: makeSkillRepo(['ui-design']), vaultDir: scratch('dsh-vault-'), skillRoot },
  )
  assert.equal(result.ok, true)
  assert.equal(result.linked, false)
  assert.match(result.linkError, /链接技能到技能根失败/)
})

test('#5 applyItems makes a failed skill link visible per item', async () => {
  const profileDir = makeProfile()
  const repoRoot = makeSkillRepo(['ui-design', 'lint-helper'])
  const skillRoot = unusableSkillRoot()
  const result = await applyItems(
    [
      { kind: 'skill', name: 'ui-design' },
      { kind: 'skill', name: 'lint-helper' },
    ],
    { profileDir, repoRoot, vaultDir: scratch('dsh-vault-'), skillRoot },
  )
  assert.equal(result.ok, false)
  const item = result.results.find((r) => r.key === 'skill:ui-design')
  assert.equal(item.ok, false)
  assert.equal(item.linked, false)
  assert.match(item.error, /链接技能到技能根失败/)
  // Non-aborting: one bad link is reported without dropping the rest of the batch.
  assert.equal(result.results.length, 2)
  assert.equal(result.failed, 2)
})

test('#5 applyItems reports a linked skill as applied', async () => {
  const profileDir = makeProfile()
  const skillRoot = scratch('dsh-skills-')
  const result = await applyItems([{ kind: 'skill', name: 'ui-design' }], {
    profileDir,
    repoRoot: makeSkillRepo(['ui-design']),
    vaultDir: scratch('dsh-vault-'),
    skillRoot,
  })
  assert.equal(result.ok, true)
  assert.equal(result.applied, 1)
  assert.equal(existsSync(join(skillRoot, 'ui-design', 'SKILL.md')), true)
})

// ---- #8 -------------------------------------------------------------------

test('#8 a missing pnpm restores the exact prior package.json bytes', async () => {
  // Deliberately unusual formatting: a re-serialised file would normalise it.
  const original = '{\n  "name": "profile",\n  "dependencies": { "existing": "1.0.0" }\n}\n'
  const dir = makeProfile(original)
  const result = await applyItems(
    [{ kind: 'plugin', name: 'dsh-ctx-guard', source: 'npm', version: '1.0.0' }],
    { profileDir: dir, pnpmBin: 'definitely-not-pnpm-xyz' },
  )
  assert.equal(result.ok, false)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), original)
  const item = result.results.find((r) => r.key === 'plugin:dsh-ctx-guard')
  assert.equal(item.ok, false)
  assert.match(item.error, /pnpm install 失败/)
  assert.match(item.error, /已回滚/)
})

test('#8 a non-zero pnpm exit rolls package.json back', async () => {
  const original = JSON.stringify({ name: 'profile', dependencies: { existing: '1.0.0' } }, null, 2)
  const dir = makeProfile(original)
  const result = await applyItems(
    [{ kind: 'plugin', name: 'dsh-ctx-guard', source: 'npm', version: '2.0.0' }],
    { profileDir: dir, pnpmBin: makeStubBinary(1) },
  )
  assert.equal(result.ok, false)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), original)
  const item = result.results.find((r) => r.key === 'plugin:dsh-ctx-guard')
  assert.equal(item.ok, false)
  assert.match(item.error, /已回滚/)
})

test('#8 a pnpm timeout rolls package.json back', async () => {
  const original = JSON.stringify({ name: 'profile', dependencies: {} }, null, 2)
  const dir = makeProfile(original)
  const bin = join(scratch('dsh-bin-'), 'pnpm-slow.sh')
  writeFileSync(bin, '#!/bin/sh\nsleep 5\nexit 0\n', { mode: 0o755 })
  const result = await applyItems(
    [{ kind: 'plugin', name: 'dsh-ctx-guard', source: 'npm', version: '2.0.0' }],
    { profileDir: dir, pnpmBin: bin, installTimeoutMs: 100 },
  )
  assert.equal(result.ok, false)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), original)
  const item = result.results.find((r) => r.key === 'plugin:dsh-ctx-guard')
  assert.match(item.error, /已回滚/)
})

test('#8 nothing written means no rollback is claimed', async () => {
  // The dependency already sits at the wanted spec, so the batch never
  // rewrites package.json; a failing install must not claim a rollback.
  const original = JSON.stringify({ name: 'profile', dependencies: { 'dsh-ctx-guard': '1.0.0' } }, null, 2)
  const dir = makeProfile(original)
  const result = await applyItems(
    [{ kind: 'plugin', name: 'dsh-ctx-guard', source: 'npm', version: '1.0.0' }],
    { profileDir: dir, pnpmBin: 'definitely-not-pnpm-xyz' },
  )
  assert.equal(result.ok, false)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), original)
  const item = result.results.find((r) => r.key === 'plugin:dsh-ctx-guard')
  assert.equal(item.changed, false)
  assert.doesNotMatch(item.error, /回滚/)
})
