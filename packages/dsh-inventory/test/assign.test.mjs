import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assignMcp,
  assignSkill,
  mcpFileOf,
  projectRootOf,
  readDeclaration,
  removeMcp,
  removeSkill,
  skillRootOf,
} from '../lib/assign.js'
import { scanSkillRoots } from '../lib/scan-skills.js'
import { projectSkillRoots } from '../lib/workspaces.js'
import { planMount } from '../lib/workspace-gate.js'

/**
 * The write path must land exactly where DSH looks afterwards, so these tests
 * assert the *consumer* view too: the gate's planMount for MCP, the filesystem
 * skill provider's scan for skills.
 */

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix))
}

function installSkill(root, name) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  writeFileSync(file, `---\nname: ${name}\ndescription: test skill\n---\nbody\n`, 'utf8')
  return file
}

test('projectRootOf follows the nearest .git and stops at the workspace itself', () => {
  const root = tempDir('inv-root-')
  const nested = join(root, 'a', 'b')
  mkdirSync(nested, { recursive: true })
  assert.equal(projectRootOf(nested), nested)
  mkdirSync(join(root, '.git'))
  assert.equal(projectRootOf(nested), root)
  assert.equal(skillRootOf(nested), join(root, '.dsh', 'skills'))
})

test('assignMcp writes a declaration the gate will mount', () => {
  const dir = tempDir('inv-ws-')
  const result = assignMcp({ workspaceDir: dir, name: 'officecli', server: { transport: 'stdio', command: 'officecli', args: ['mcp'] } })
  assert.equal(result.ok, true)
  assert.equal(result.path, mcpFileOf(dir))

  const plan = planMount(dir)
  assert.equal(plan.mount, true)
  assert.equal(plan.servers.officecli.command, 'officecli')
  assert.deepEqual(plan.servers.officecli.args, ['mcp'])

  const again = assignMcp({ workspaceDir: dir, name: 'officecli', server: { transport: 'stdio', command: 'x' } })
  assert.equal(again.ok, false)
  assert.match(again.error, /已经声明/)
})

test('removeMcp keeps a shared declaration and deletes an emptied one', () => {
  const dir = tempDir('inv-ws-')
  assignMcp({ workspaceDir: dir, name: 'a', server: { transport: 'stdio', command: 'a' } })
  assignMcp({ workspaceDir: dir, name: 'b', server: { transport: 'stdio', command: 'b' } })

  assert.equal(removeMcp({ workspaceDir: dir, name: 'a' }).ok, true)
  const doc = JSON.parse(readFileSync(mcpFileOf(dir), 'utf8'))
  assert.deepEqual(Object.keys(doc.servers), ['b'])

  assert.equal(removeMcp({ workspaceDir: dir, name: 'b' }).ok, true)
  assert.equal(existsSync(mcpFileOf(dir)), false, 'an emptied declaration should not linger')
  assert.equal(removeMcp({ workspaceDir: dir, name: 'b' }).ok, false)
})

/**
 * Issue #75: the relink loop (assign -> remove -> assign again) exercises the
 * unlink/mkdir/symlink rebuild path — including the junction branch on Windows
 * — that a one-way test never reaches. Both sides must come back visible to
 * the consumers the gate and the skill provider run.
 */
test('removing and re-assigning an MCP makes the gate mount it again', () => {
  const dir = tempDir('inv-ws-')
  const server = { transport: 'stdio', command: 'officecli', args: ['mcp'] }

  assert.equal(assignMcp({ workspaceDir: dir, name: 'officecli', server }).ok, true)
  assert.equal(planMount(dir).mount, true)

  assert.equal(removeMcp({ workspaceDir: dir, name: 'officecli' }).ok, true)
  assert.equal(planMount(dir).mount, false, 'after removal the gate must skip the workspace')

  const re = assignMcp({ workspaceDir: dir, name: 'officecli', server })
  assert.equal(re.ok, true, `re-assign must succeed: ${re.error ?? ''}`)
  const plan = planMount(dir)
  assert.equal(plan.mount, true)
  assert.equal(plan.servers.officecli.command, 'officecli')
})

test('removing and re-assigning a skill makes the provider scan it again', () => {
  const home = tempDir('inv-home-')
  const sourcePath = installSkill(home, 'demo-skill')
  const dir = tempDir('inv-ws-')

  assert.equal(assignSkill({ workspaceDir: dir, name: 'demo-skill', sourcePath }).ok, true)
  assert.ok(scanSkillRoots(projectSkillRoots(dir)).skills.some((skill) => skill.name === 'demo-skill'))

  assert.equal(removeSkill({ workspaceDir: dir, name: 'demo-skill' }).ok, true)
  assert.ok(!scanSkillRoots(projectSkillRoots(dir)).skills.some((skill) => skill.name === 'demo-skill'))

  const re = assignSkill({ workspaceDir: dir, name: 'demo-skill', sourcePath })
  assert.equal(re.ok, true, `re-assign must succeed: ${re.error ?? ''}`)
  assert.equal(lstatSync(re.path).isSymbolicLink(), true, 'the rebuilt link must still be a link')
  assert.ok(scanSkillRoots(projectSkillRoots(dir)).skills.some((skill) => skill.name === 'demo-skill'))
})

/**
 * Issue #75: `allowServerNames` is the gate's declaration whitelist —
 * deployments can pin which declared servers the gate may mount. The filter
 * lives in parseDeclaration/planMount and had no test at all.
 */
test('allowServerNames filters declared servers down to the allowlist', () => {
  const dir = tempDir('inv-ws-')
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(
    mcpFileOf(dir),
    JSON.stringify({ servers: { allowed: { transport: 'stdio', command: 'a' }, blocked: { transport: 'stdio', command: 'b' } } }),
    'utf8',
  )

  const plan = planMount(dir, { allowServerNames: ['allowed'] })
  assert.equal(plan.mount, true)
  assert.deepEqual(Object.keys(plan.servers), ['allowed'], 'only allowlisted servers may mount')

  const open = planMount(dir)
  assert.deepEqual(Object.keys(open.servers).sort(), ['allowed', 'blocked'], 'an empty allowlist means no restriction')
})

test('assignMcp refuses to overwrite a declaration it cannot read', () => {
  const dir = tempDir('inv-ws-')
  mkdirSync(join(dir, '.dsh'), { recursive: true })
  writeFileSync(mcpFileOf(dir), '{ not json', 'utf8')
  const result = assignMcp({ workspaceDir: dir, name: 'a', server: { transport: 'stdio', command: 'a' } })
  assert.equal(result.ok, false)
  assert.match(result.error, /不是合法 JSON/)
  assert.equal(readFileSync(mcpFileOf(dir), 'utf8'), '{ not json', 'the user file must survive')
})

test('assignSkill links a skill where the skill provider scans it', () => {
  const home = tempDir('inv-home-')
  const sourcePath = installSkill(home, 'demo-skill')
  const dir = tempDir('inv-ws-')

  const result = assignSkill({ workspaceDir: dir, name: 'demo-skill', sourcePath })
  assert.equal(result.ok, true)
  assert.equal(result.path, join(dir, '.dsh', 'skills', 'demo-skill'))
  assert.equal(lstatSync(result.path).isSymbolicLink(), true)

  const { skills } = scanSkillRoots(projectSkillRoots(dir))
  const found = skills.find((skill) => skill.name === 'demo-skill')
  assert.ok(found, 'the provider scan must see the linked skill')
  assert.equal(found.source, 'project-dsh')

  const again = assignSkill({ workspaceDir: dir, name: 'demo-skill', sourcePath })
  assert.equal(again.ok, false)
  assert.match(again.error, /已经有技能/)
})

test('removeSkill unlinks a link but refuses a real installation', () => {
  const home = tempDir('inv-home-')
  const sourcePath = installSkill(home, 'demo-skill')
  const dir = tempDir('inv-ws-')

  assignSkill({ workspaceDir: dir, name: 'demo-skill', sourcePath })
  const removed = removeSkill({ workspaceDir: dir, name: 'demo-skill' })
  assert.equal(removed.ok, true)
  assert.equal(existsSync(join(dir, '.dsh', 'skills', 'demo-skill')), false)
  assert.equal(removeSkill({ workspaceDir: dir, name: 'demo-skill' }).ok, false)

  // A copied-in skill (what the skills manager does) is somebody's content.
  const copied = join(dir, '.dsh', 'skills', 'copied')
  mkdirSync(copied, { recursive: true })
  writeFileSync(join(copied, 'SKILL.md'), '---\nname: copied\ndescription: d\n---\n', 'utf8')
  const refused = removeSkill({ workspaceDir: dir, name: 'copied' })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /不是本页建立的链接/)
  assert.equal(existsSync(join(copied, 'SKILL.md')), true)
})

test('a single-file skill links as <name>.md', () => {
  const home = tempDir('inv-home-')
  writeFileSync(join(home, 'solo.md'), '---\nname: solo\ndescription: one file\n---\n', 'utf8')
  const dir = tempDir('inv-ws-')
  const result = assignSkill({ workspaceDir: dir, name: 'solo', sourcePath: join(home, 'solo.md') })
  assert.equal(result.ok, true)
  assert.equal(result.path, join(dir, '.dsh', 'skills', 'solo.md'))
  const { skills } = scanSkillRoots(projectSkillRoots(dir))
  assert.ok(skills.some((skill) => skill.name === 'solo'))
  assert.equal(removeSkill({ workspaceDir: dir, name: 'solo' }).ok, true)
})

test('readDeclaration reports a missing file without throwing', () => {
  const dir = tempDir('inv-ws-')
  const result = readDeclaration(mcpFileOf(dir))
  assert.equal(result.ok, false)
  assert.equal(result.missing, true)
})
