/**
 * Global loader-entry enablement, written into the profile's patch file.
 *
 * The profile composes its plugin tree from bundle layers plus
 * `cordis.patch.yml`; the last patch that names an id wins. `pluginManager`
 * (when this installation has it) persists a switch through
 * `writePluginEnabled`, which edits that same file. This module is the fallback
 * for installations without the manager, and the writer the tests drive: it only
 * touches a trailing override that holds nothing but `id` and `disabled`, so a
 * block carrying `config` or comments is never rewritten — a new override is
 * appended after it instead.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const PLAIN_ID = /^[A-Za-z0-9_./@-]+$/
const ID_LINE = /^-\s*id:\s*(.+)$/
const FIELD_LINE = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/

function quoteId(id) {
  return PLAIN_ID.test(id) ? id : JSON.stringify(id)
}

function unquote(raw) {
  const value = raw.trim()
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Inspect one top-level sequence item.
 * @returns {{simple: boolean, id?: string, disabledIndex?: number, disabled?: boolean}}
 */
function inspectBlock(block) {
  const first = ID_LINE.exec(block[0] ?? '')
  if (first === null) return { simple: false }
  let disabledIndex
  let disabled
  for (let index = 1; index < block.length; index += 1) {
    const line = block[index]
    if (line.trim() === '') continue
    const field = FIELD_LINE.exec(line)
    if (field === null) return { simple: false }
    const [, key, rawValue] = field
    if (key !== 'disabled') return { simple: false }
    const value = rawValue.trim()
    if (value !== 'true' && value !== 'false') return { simple: false }
    disabledIndex = index
    disabled = value === 'true'
  }
  return { simple: true, id: unquote(first[1]), disabledIndex, disabled }
}

/**
 * Turn an enablement switch into patch text.
 * @param {string} text - current patch file text.
 * @param {{id: string, enabled: boolean}} input
 * @returns {{text: string, changed: boolean}}
 */
export function setPatchEnabled(text, { id, enabled }) {
  const source = typeof text === 'string' ? text : ''
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const desired = enabled !== true

  if (source.trim() === '' || source.trim() === '[]') {
    // An empty sequence cannot be appended to; replace it with the one override.
    const kept = source
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '[]')
      .join(eol)
      .replace(/\s+$/, '')
    const head = kept.length === 0 ? '' : kept + eol
    return { text: `${head}- id: ${quoteId(id)}${eol}  disabled: ${String(desired)}${eol}`, changed: true }
  }

  const lines = source.split(/\r?\n/)
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    if (/^-(?:\s|$)/.test(lines[index])) starts.push(index)
  }

  let target
  for (let index = 0; index < starts.length; index += 1) {
    const from = starts[index]
    const to = index + 1 < starts.length ? starts[index + 1] : lines.length
    const block = lines.slice(from, to)
    const info = inspectBlock(block)
    if (info.simple && info.id === id) target = { from, to, block, info }
  }

  if (target === undefined) {
    const base = source.endsWith('\n') ? source : source + eol
    const block = `- id: ${quoteId(id)}${eol}  disabled: ${String(desired)}${eol}`
    return { text: base + block, changed: true }
  }

  const { from, info } = target
  if (info.disabledIndex !== undefined) {
    if (info.disabled === desired) return { text: source, changed: false }
    lines[from + info.disabledIndex] = `  disabled: ${String(desired)}`
  } else {
    if (desired === false) return { text: source, changed: false }
    lines.splice(from + 1, 0, `  disabled: ${String(desired)}`)
  }
  return { text: lines.join(eol), changed: true }
}

/**
 * Persist one switch into a patch file.
 * @param {string} file - profile patch path (`cordis.patch.yml`).
 * @param {{id: string, enabled: boolean}} input
 * @returns {{path: string, changed: boolean}}
 */
export function writePatchEnabled(file, { id, enabled }) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const next = setPatchEnabled(text, { id, enabled })
  if (!next.changed) return { path: file, changed: false }
  const eol = next.text.includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(file, next.text.endsWith('\n') ? next.text : next.text + eol, 'utf8')
  return { path: file, changed: true }
}
