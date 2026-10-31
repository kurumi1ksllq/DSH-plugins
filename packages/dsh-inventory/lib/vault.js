/**
 * The skill vault: where a skill is *registered* but not active.
 *
 * DSH discovers skills on fixed roots (`~/.dsh/skills`, `~/.agents/skills`,
 * project `.dsh/skills`, …). A skill sitting on one of those is visible to every
 * session, which is exactly what a per-workspace model must avoid. The vault is
 * a directory no root scans (`$DSH_HOME/inventory/skills`): a skill parked there
 * costs nothing until a workspace links it into its own project skill root.
 *
 * Moving a skill is a rename, so the skill keeps its single copy — the link a
 * workspace holds points at the vault directory afterwards.
 */

import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { dshHome } from './dsh-home.js'
import { scanSkillRoots } from './scan-skills.js'

/** Source label the snapshot uses for a vaulted skill. */
export const VAULT_SOURCE = 'vault'

/** DSH home — re-exported so existing `vault.js` consumers keep working. */
export { dshHome }

/** Directory holding registered-but-inactive skills. Never a scanned root. */
export function vaultDir() {
  return join(dshHome(), 'inventory', 'skills')
}

/** Roots for scanning the vault with the normal skill scanner. */
export function vaultRoots() {
  // Rank 350 keeps it between custom dirs (300) and the user root (400); the
  // vault never competes with a real root, the number only orders diagnostics.
  return [{ dir: vaultDir(), source: VAULT_SOURCE, rank: 350 }]
}

/** Scan the vault. */
export function scanVault() {
  return scanSkillRoots(vaultRoots())
}

/** A skill is either `<root>/<name>/SKILL.md` or a single `<root>/<name>.md`. */
export function isSingleFileSkill(skillPath) {
  return !/[\\/]SKILL\.md$/i.test(skillPath)
}

/**
 * Move one scanned global skill into the vault.
 * @param {{name: string, path: string}} skill
 * @returns {{ok: true, name: string, from: string, to: string} | {ok: false, code: string, error: string}}
 */
export function moveIntoVault(skill) {
  if (skill === null || typeof skill !== 'object' || typeof skill.name !== 'string' || typeof skill.path !== 'string') {
    return { ok: false, code: 'invalid', error: '技能记录不完整' }
  }
  const single = isSingleFileSkill(skill.path)
  const from = single ? skill.path : dirname(skill.path)
  const to = single ? join(vaultDir(), `${skill.name}.md`) : join(vaultDir(), skill.name)
  if (existsSync(to)) return { ok: false, code: 'exists', error: `仓库里已经有技能 ${skill.name}` }
  try {
    mkdirSync(vaultDir(), { recursive: true })
    renameSync(from, to)
  } catch (error) {
    return { ok: false, code: 'failed', error: `移入仓库失败：${error?.message ?? error}` }
  }
  return { ok: true, name: skill.name, from, to }
}

/**
 * Move one vaulted skill back to the user skill root (`$DSH_HOME/skills`).
 * @param {string} name
 * @returns {{ok: true, name: string, from: string, to: string} | {ok: false, code: string, error: string}}
 */
export function moveOutOfVault(name) {
  const skill = scanVault().skills.find((item) => item.name === name)
  if (skill === undefined) return { ok: false, code: 'missing', error: `仓库里没有技能 ${name}` }
  const single = isSingleFileSkill(skill.path)
  const from = single ? skill.path : dirname(skill.path)
  const to = single ? join(dshHome(), 'skills', `${name}.md`) : join(dshHome(), 'skills', name)
  if (existsSync(to)) return { ok: false, code: 'exists', error: `全局技能根已经有 ${name}` }
  try {
    mkdirSync(join(dshHome(), 'skills'), { recursive: true })
    renameSync(from, to)
  } catch (error) {
    return { ok: false, code: 'failed', error: `移出仓库失败：${error?.message ?? error}` }
  }
  return { ok: true, name, from, to }
}
