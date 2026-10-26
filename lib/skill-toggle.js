/**
 * Global skill enablement, on disk.
 *
 * A skill is "globally disabled" exactly when its frontmatter carries
 * `disable-model-invocation: true` — that is the flag `@deepseek-ai/dsh-skill-filesystem`
 * reads, and it is how this machine's office-* placeholder stubs stay out of the
 * model-facing catalog. There is no config-level deny list to write instead, so a
 * global switch has to edit the skill's own SKILL.md.
 *
 * The edit is deliberately surgical: only the one frontmatter line changes. The
 * BOM, the line endings (Windows editors write CRLF), every other frontmatter key,
 * the closing delimiter and the whole body stay byte-identical.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FLAG = 'disable-model-invocation'

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * Split a SKILL.md into the parts an edit must preserve.
 * @param {string} source - raw file text.
 * @returns {{bom: string, eol: string, open: string, lines: string[], close: string}}
 */
function splitFrontmatter(source) {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const body = source.slice(bom.length)
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const open = /^---[ \t]*\r?\n/.exec(body)
  if (open === null) throw fail('no-frontmatter', 'SKILL.md 没有 YAML frontmatter')

  const contentStart = open[0].length
  // The closing delimiter is the first line that is exactly `---` (trailing
  // spaces allowed). A `---` inside a folded value would be indented, so a
  // column-0 match is the delimiter the skill loader itself uses.
  let cursor = contentStart
  while (cursor <= body.length) {
    const next = body.indexOf('\n', cursor)
    const lineEnd = next === -1 ? body.length : next
    const line = body.slice(cursor, lineEnd).replace(/\r$/, '')
    if (line.trimEnd() === '---') {
      const content = body.slice(contentStart, cursor)
      const close = body.slice(cursor)
      const lines = content === '' ? [] : content.split(eol)
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      return { bom, eol, open: body.slice(0, contentStart), lines, close }
    }
    if (next === -1) break
    cursor = next + 1
  }
  throw fail('no-frontmatter', 'SKILL.md 的 frontmatter 没有结束分隔符')
}

/**
 * Pure frontmatter edit: add, rewrite or drop the disable flag.
 * @param {string} source - raw SKILL.md text.
 * @param {boolean} enabled - desired state.
 * @returns {{text: string, changed: boolean}}
 */
export function applySkillEnabled(source, enabled) {
  const { bom, eol, open, lines, close } = splitFrontmatter(source)
  const index = lines.findIndex((line) => new RegExp(`^${FLAG}\\s*:`).test(line))
  let changed = false

  if (enabled) {
    if (index !== -1) {
      lines.splice(index, 1)
      changed = true
    }
  } else if (index === -1) {
    lines.push(`${FLAG}: true`)
    changed = true
  } else if (!/^\s*true\s*$/i.test(lines[index].slice(lines[index].indexOf(':') + 1))) {
    lines[index] = `${FLAG}: true`
    changed = true
  }

  if (!changed) return { text: source, changed: false }
  const content = lines.length === 0 ? '' : lines.join(eol) + eol
  return { text: `${bom}${open}${content}${close}`, changed: true }
}

/** Whether the skill's frontmatter currently hides it from the model catalog. */
export function isSkillDisabled(source) {
  try {
    const { lines } = splitFrontmatter(source)
    const line = lines.find((row) => new RegExp(`^${FLAG}\\s*:`).test(row))
    return line !== undefined && /^\s*true\s*$/i.test(line.slice(line.indexOf(':') + 1))
  } catch {
    return false
  }
}

/**
 * Flip one skill file's global enablement.
 * @param {{path: string, enabled: boolean}} input
 * @returns {{ok: true, path: string, changed: boolean}}
 */
export function setSkillEnabled({ path, enabled }) {
  if (typeof path !== 'string' || path.length === 0) throw fail('missing-file', '技能没有磁盘路径')
  if (!existsSync(path)) throw fail('missing-file', `技能文件不存在：${path}`)
  const source = readFileSync(path, 'utf8')
  const { text, changed } = applySkillEnabled(source, enabled === true)
  if (changed) writeFileSync(path, text, 'utf8')
  return { ok: true, path, changed }
}
