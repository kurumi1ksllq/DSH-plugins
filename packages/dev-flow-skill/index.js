/**
 * dev-flow-skill — host half.
 *
 * The skill itself is a prose document (`SKILL.md`). This module is what makes
 * a profile able to load it: cordis refuses a bundle row whose entry exports
 * neither a function nor an object with `apply`, which is exactly what
 * `lib/lint.mjs` (the linter, and the package's old `main`) does.
 *
 * The body is read from disk at apply time rather than inlined here. An inlined
 * copy would be a second source of truth: editing `SKILL.md` would leave the
 * registered text stale while the contract linter kept passing on the file.
 *
 * Surface: one skill registration, no tools, no routes.
 * @module dev-flow-skill
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dev-flow-skill'

/** Cordis injects a dependency only when it is listed here. */
export const inject = ['skills']

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))

/** The skill's addressable name; must stay kebab-case and match SKILL.md's frontmatter. */
export const SKILL_NAME = 'dev-flow'

/**
 * Absolute path of the shipped skill body.
 * @returns {string}
 */
export function skillPath() {
  return join(PACKAGE_ROOT, 'SKILL.md')
}

/**
 * Read the shipped SKILL.md body.
 * @returns {string}
 */
export function readSkillBody() {
  return readFileSync(skillPath(), 'utf8')
}

/**
 * The routing description shown in the session skill catalog.
 *
 * Kept in sync with SKILL.md's frontmatter by `test/loader.test.mjs`: the
 * contract linter's required trigger words must appear here too, because this
 * is the text the model actually sees when deciding whether to load the skill.
 * @returns {string}
 */
export function skillDescription(body) {
  const match = /^---\n[\s\S]*?\ndescription:\s*(.+)$/m.exec(body.split('\n---')[0])
  return match === null ? 'dev-flow' : match[1].trim().replace(/^['"]|['"]$/g, '')
}

/**
 * Cordis plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const register = ctx.skills?.register
  if (typeof register !== 'function') {
    // A profile that links this bundle without the skill registry must not fail
    // at boot: a documentation bundle is the last thing that should be able to
    // take the host down. Warn and stay inert.
    ctx.logger?.warn?.('[dev-flow-skill] ctx.skills is unavailable; the dev-flow skill was not registered')
    return
  }
  const content = readSkillBody()
  ctx.skills.register({
    name: SKILL_NAME,
    description: skillDescription(content),
    content,
    source: 'bundled',
  })
}
