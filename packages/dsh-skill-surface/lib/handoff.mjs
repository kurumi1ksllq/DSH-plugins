// `skills: a, b` handoff parsing and per-agent injection memory.
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

const injectedByAgent = new WeakMap()

/**
 * Skill names already present in one agent's conversation.
 *
 * Resume and fork copy an earlier session, so process memory alone would inject
 * the same bodies twice; the first call replays the session's own
 * skill-invocation records (the same read dsh-tool-skill uses for its catalog
 * history). A session shape this plugin cannot read degrades to memory-only
 * tracking instead of throwing inside the step listener.
 * @param agent - the agent whose conversation is being tracked.
 * @returns the live set of already-injected names for that agent.
 */
export function injectedSkills(agent) {
  const known = injectedByAgent.get(agent)
  if (known !== undefined) return known
  const names = new Set()
  try {
    const session = agent?.session
    const length = typeof session?.seq === 'number' ? session.seq : 0
    for (let index = 0; index < length; index += 1) {
      const event = session.eventAt(index)
      if (event?.type !== 'user/message') continue
      if (event.data?.source?.kind === 'skill-invocation') names.add(event.data.source.name)
    }
  } catch {
    // An unreadable history only costs a possible duplicate body.
  }
  injectedByAgent.set(agent, names)
  return names
}
