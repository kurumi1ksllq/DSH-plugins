// Host module access, following dsh-deep-ptc-mode's resolver shape: a linked
// install routes only peer-declared names, so fall back to the runtime's own
// package graph. Nothing here hard-codes a symbol name that a test needs to
// fake — callers install a stub instead.

let installed
let pending

function resolveHost(specifier) {
  try {
    return import.meta.resolve(specifier)
  } catch {
    return undefined
  }
}

/**
 * Replace the host API (tests, or an embedding that already holds it).
 * @param api - the render/create pair to use instead of the installed Harness.
 */
export function setHostApi(api) {
  installed = api
  pending = undefined
}

/**
 * Load the official helpers this plugin borrows.
 *
 * BORROWS, does not reimplement: the `<skill_content>` frame and the durable
 * user message are official single sources.
 * @returns renderSkillContent and createUserMessage from the installed Harness.
 */
export async function hostApi() {
  if (installed !== undefined) return installed
  pending ??= (async () => {
    const url = resolveHost('@deepseek-ai/dsh-skill')
    const llm = resolveHost('@deepseek-ai/dsh-llm')
    if (url === undefined || llm === undefined) {
      throw new Error('dsh-skill-surface: the installed Harness provides no dsh-skill/dsh-llm module')
    }
    const [skill, message] = await Promise.all([import(url), import(llm)])
    if (typeof skill.renderSkillContent !== 'function' || typeof message.createUserMessage !== 'function') {
      throw new Error('dsh-skill-surface: the installed Harness lacks renderSkillContent/createUserMessage')
    }
    installed = { renderSkillContent: skill.renderSkillContent, createUserMessage: message.createUserMessage }
    return installed
  })()
  return pending
}

/**
 * Whether a skill may be injected for a model-originated handoff.
 * @param skill - a loaded skill definition.
 * @returns false only when the skill opted out of model invocation.
 */
export function modelInvocable(skill) {
  return skill?.invocation?.modelInvocable !== false
}
