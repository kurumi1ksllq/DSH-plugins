/**
 * dev-flow-skill — host half.
 *
 * The skill itself is a prose document (`SKILL.md`). This module is what makes
 * a profile able to load it: cordis rejects a bundle row whose entry exports
 * neither a function nor an object with `apply`, which is exactly what
 * `lib/lint.mjs` (the linter, and the package's old `main`) does.
 *
 * The body is read from disk at apply time rather than inlined here. An inlined
 * copy would be a second source of truth: editing `SKILL.md` would leave the
 * registered text stale while the contract linter kept passing on the file.
 *
 * Frontmatter is stripped before registering, because that is what
 * `@deepseek-ai/dsh-skill-filesystem` hands the registry (`parsed.body.trim()`).
 * Registering the raw bytes would give the model two different bodies for the
 * same file depending on which provider won.
 *
 * Surface: one skill registration, no tools, no routes.
 * @module dev-flow-skill
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dev-flow-skill'

/**
 * Cordis injects a dependency only when it is listed here — and, importantly,
 * a fiber whose injected service is missing never reaches `apply` at all. That
 * is the guard against loading this bundle into a profile without the skill
 * registry: the row stays inactive instead of throwing at boot.
 */
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
 * Read the shipped SKILL.md source.
 * @returns {string}
 */
export function readSkillSource(path = skillPath()) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    // Nothing else in this module can fail for a packaging reason, so name the
    // path here: `files` missing SKILL.md, a half-built `link:` target, and a
    // permission error all surface as this one line instead of a bare ENOENT.
    throw new Error(`[dev-flow-skill] cannot read the skill body at ${path}: ${error.message}`)
  }
}

/**
 * Split a skill file into its YAML frontmatter fields and its body.
 *
 * Deliberately small and dependency-free, but not a one-line regex: folded
 * `description:` values (continuation lines indented under the key) are part of
 * YAML and would otherwise be truncated mid-sentence, silently dropping the
 * trigger words the routing depends on.
 * @param {string} text - full SKILL.md source.
 * @returns {{fields: Record<string, string>, body: string}}
 */
export function parseSkill(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new Error('[dev-flow-skill] SKILL.md must open with a YAML frontmatter block')
  }
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) {
    throw new Error('[dev-flow-skill] SKILL.md frontmatter is not terminated by a --- line')
  }
  const fields = {}
  let lastKey = null
  for (const line of normalized.slice(3, end).split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (match === null) {
      // Continuation of a folded value.
      if (lastKey !== null && typeof fields[lastKey] === 'string') fields[lastKey] += ` ${line.trim()}`
      continue
    }
    const [, key, rest] = match
    lastKey = key
    fields[key] = rest.trim().replace(/^['"]|['"]$/g, '')
  }
  return { fields, body: normalized.slice(end + 4).replace(/^\n+/, '').trim() }
}

/**
 * Cordis plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const { fields, body } = parseSkill(readSkillSource())
  const description = fields.description
  if (typeof description !== 'string' || description.length === 0) {
    // A skill without a description is rejected by the registry anyway; failing
    // here names the file instead of leaving "requires a description" dangling.
    throw new Error('[dev-flow-skill] SKILL.md frontmatter has no description')
  }
  ctx.skills.register({
    name: SKILL_NAME,
    description,
    content: body,
    source: 'bundled',
  })
}
