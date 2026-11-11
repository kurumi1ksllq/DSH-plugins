// `skills: a, b` handoff parsing and per-agent load memory.
//
// Only the FIRST handoff line counts: a task that quotes the format twice must
// not silently load six bodies. The token is matched at the START of a line
// (optionally after a list marker), never mid-sentence, so prose discussing the
// format never triggers an injection.

/** Longest handoff a delegation may carry. */
export const HANDOFF_MAX = 6

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HANDOFF_LINE = /^[ \t]*(?:[-*][ \t]+)?skills[ \t]*:[ \t]*(.+)$/gim

/**
 * Skill names the delegation asked for.
 * @param messages - the step's claimed messages; only direct user input is read.
 * @returns validated, deduplicated names from the first handoff line only.
 */
export function handoffNames(messages) {
  if (!Array.isArray(messages)) return []
  const names = []
  for (const message of messages) {
    if (message?.source?.kind !== 'user') continue
    const blocks = Array.isArray(message.content) ? message.content : []
    for (const block of blocks) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      for (const match of block.text.matchAll(HANDOFF_LINE)) {
        for (const raw of match[1].split(/[,，\s]+/u)) {
          const name = raw.trim()
          if (!SKILL_NAME.test(name) || names.includes(name)) continue
          names.push(name)
          if (names.length >= HANDOFF_MAX) return names
        }
        return names
      }
    }
  }
  return names
}

/** Loader tool names whose calls mean "this skill is now in context". */
const LOADER_TOOLS = new Set(['skill', 'skill_get'])

const memory = new WeakMap()

/** One event's contribution to the loaded-skill set, or undefined. */
function loadedBy(event) {
  if (event?.type === 'user/message' && event.data?.source?.kind === 'skill-invocation') {
    const name = event.data.source.name
    return typeof name === 'string' ? name : undefined
  }
  // deep-ptc routes tool calls through tool/ptc-dispatch, where arguments is
  // already an object. Missing that event made the nudge repeat skills the
  // model had just loaded (#175).
  if (event?.type === 'tool/ptc-dispatch' && LOADER_TOOLS.has(event.data?.name)) {
    // A failed load did not put anything in context, so it must not suppress
    // the next nudge.
    if (event.data.isError === true) return undefined
    const raw = event.data.arguments
    let dispatched = raw
    if (typeof raw === 'string') {
      try {
        dispatched = JSON.parse(raw)
      } catch {
        return undefined
      }
    }
    return typeof dispatched?.name === 'string' && dispatched.name !== '' ? dispatched.name : undefined
  }
  if (event?.type === 'tool/call' && LOADER_TOOLS.has(event.data?.name)) {
    try {
      const args = JSON.parse(event.data.arguments ?? '{}')
      return typeof args?.name === 'string' && args.name !== '' ? args.name : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Skill names already in one agent's conversation.
 *
 * Two sources count, because a skill reaches the context two ways: our own
 * injection (a skill-invocation message) and the model calling a loader tool
 * (official `skill` or our `skill_get`), which leaves only a tool call. Missing
 * the second one made the nudge repeat skills the model had just read.
 *
 * The scan is incremental: each call reads only events appended since the last
 * one, so a long session does not replay its whole history every turn.
 * @param agent - the agent whose conversation is being tracked.
 * @returns the live set of loaded names for that agent.
 */
export function injectedSkills(agent) {
  let record = memory.get(agent)
  if (record === undefined) {
    record = { names: new Set(), scanned: 0 }
    memory.set(agent, record)
  }
  try {
    const session = agent?.session
    const length = typeof session?.seq === 'number' ? session.seq : 0
    for (let index = record.scanned; index < length; index += 1) {
      const name = loadedBy(session.eventAt(index))
      if (name !== undefined) record.names.add(name)
    }
    record.scanned = Math.max(record.scanned, length)
  } catch {
    // An unreadable history only costs a possible duplicate body.
  }
  return record.names
}
