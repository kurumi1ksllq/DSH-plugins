/**
 * Session evidence: which tools a skill actually pulled in.
 *
 * A skill load is a tool event named `skill` whose arguments carry
 * `{"name": "<skill>"}`. Every tool event in the following window counts as a
 * witnessed use of that skill's toolchain.
 *
 * Two event shapes carry tool calls: native sessions record `tool/call` (with
 * `arguments` as a JSON string), while Deep PTC records `tool/ptc-dispatch`
 * (with `arguments` already an object). Reading only `tool/call` left every
 * deep-ptc session with zero evidence, because there the outer call is always
 * `run_code` and the real skill load is the nested dispatch (#177).
 */

/** Event types that carry a tool invocation. */
const TOOL_EVENTS = new Set(['tool/call', 'tool/ptc-dispatch'])

const SKILL_TOOL = 'skill'

function parseArguments(raw) {
  if (raw !== null && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Walk events and collect per-skill tool usage.
 * @param {object[]} events - decoded session events.
 * @param {{window?: number}} [options] - tool calls counted after each skill load.
 * @returns {Array<{skill: string, tools: Map<string, number>}>}
 */
export function collectSkillToolEvidence(events, { window = 8 } = {}) {
  const rows = []
  let current = null
  let remaining = 0

  for (const event of events) {
    if (!event || !TOOL_EVENTS.has(event.type)) continue
    const data = event.data
    if (!data || typeof data !== 'object') continue
    const name = data.name
    if (typeof name !== 'string' || name.length === 0) continue

    if (name === SKILL_TOOL) {
      const args = parseArguments(data.arguments)
      const skill = args && typeof args.name === 'string' ? args.name : null
      if (skill !== null) {
        current = { skill, tools: new Map() }
        rows.push(current)
        remaining = window
      }
      continue
    }

    if (current === null) continue
    if (remaining <= 0) {
      current = null
      continue
    }
    current.tools.set(name, (current.tools.get(name) ?? 0) + 1)
    remaining -= 1
  }

  return rows
}
