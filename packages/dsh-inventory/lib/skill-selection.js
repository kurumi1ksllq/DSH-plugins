/**
 * Whole-catalog selection over the skills a machine already has.
 *
 * WHY THIS EXISTS (measured 2026-11-17, 418 logged sessions): every session
 * renders the model-facing catalog from every skill the filesystem provider
 * finds, and only 7.4% of those sessions ever loaded one. A 269-entry catalog
 * of mostly irrelevant skills is a router nobody can route with. The upstream
 * lever for shrinking it is per-skill, not config-level: `disable-model-invocation:
 * true` keeps a skill loadable by the user (`/name`) and drops it from the
 * catalog the model sees. There is no config-level deny list to write instead.
 *
 * So a selection is a set of names to keep model-visible plus the edits that
 * make the rest match. The plan is pure; applying it reuses the same surgical
 * frontmatter edit the panel's per-skill toggle already uses.
 */

import { setSkillEnabled } from './skill-toggle.js'

/**
 * Normalise a keep list: strings, trimmed, de-duplicated, order preserved.
 * @param {unknown} keep - raw keep value.
 * @returns {string[]}
 */
function normaliseKeep(keep) {
  if (!Array.isArray(keep)) return []
  const seen = new Set()
  for (const name of keep) {
    if (typeof name !== 'string') continue
    const trimmed = name.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) continue
    seen.add(trimmed)
  }
  return [...seen]
}

/**
 * Decide which skills to hide and which to keep visible.
 * @param {{skills: Array<{name: string, path: string, modelInvocable: boolean}>, keep: string[]}} input
 *   the scanned skills and the names that must stay in the model catalog.
 * @returns {{keep: string[], mark: object[], unmark: object[], unknown: string[]}}
 *   the kept names that exist, the skills to hide, the kept skills to re-enable,
 *   and keep names no skill matched.
 */
export function planSelection({ skills, keep }) {
  const wanted = normaliseKeep(keep)
  const kept = new Set()
  const unknown = []
  const byName = new Map()
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (skill === null || typeof skill !== 'object' || typeof skill.name !== 'string') continue
    byName.set(skill.name, skill)
  }
  for (const name of wanted) {
    if (byName.has(name)) kept.add(name)
    else unknown.push(name)
  }

  const mark = []
  const unmark = []
  for (const skill of byName.values()) {
    if (kept.has(skill.name)) {
      if (skill.modelInvocable === false) unmark.push(skill)
      continue
    }
    if (skill.modelInvocable !== false) mark.push(skill)
  }
  return { keep: [...kept], mark, unmark, unknown }
}

/**
 * Apply a selection to the skills on disk.
 * @param {{skills: object[], keep: string[], dryRun?: boolean,
 *   setEnabled?: (input: {path: string, enabled: boolean}) => unknown}} input
 *   the scanned skills, the names to keep model-visible, and whether to only report.
 * @returns {{marked: string[], unmarked: string[], unknown: string[], dryRun: boolean,
 *   failed: Array<{name: string, message: string}>}}
 *   what changed (or would change), what failed, and whether this was a dry run.
 */
export function applySelection({ skills, keep, dryRun = false, setEnabled = setSkillEnabled }) {
  const plan = planSelection({ skills, keep })
  const report = {
    marked: [],
    unmarked: [],
    unknown: plan.unknown,
    dryRun: dryRun === true,
    failed: [],
  }
  if (report.dryRun) {
    report.marked = plan.mark.map((skill) => skill.name)
    report.unmarked = plan.unmark.map((skill) => skill.name)
    return report
  }

  const edits = [
    ...plan.mark.map((skill) => ({ skill, enabled: false })),
    ...plan.unmark.map((skill) => ({ skill, enabled: true })),
  ]
  for (const { skill, enabled } of edits) {
    try {
      setEnabled({ path: skill.path, enabled })
    } catch (error) {
      report.failed.push({ name: skill.name, message: String(error && error.message ? error.message : error) })
      continue
    }
    if (enabled) report.unmarked.push(skill.name)
    else report.marked.push(skill.name)
  }
  return report
}
