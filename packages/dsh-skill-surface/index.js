// dsh-skill-surface — host entry.
//
// Two responsibilities, both deliberately small:
//   1. a CONSTANT systemPrompt section (order 20100) stating the `skills: a, b`
//      delegation handoff. Section 20000 is the exec-discipline block; sections
//      and contexts are separate registries, so this never claims adjacency to
//      the delegation context at 21000.
//   2. an `agent/pre-step` listener that turns that handoff line into official
//      `<skill_content>` injections for the receiving agent.
//
// The catalog and loader themselves are NOT implemented here: cordis.patch.yml
// re-mounts the official packages into the global layer.
//
// Failure posture: a step listener runs inside the request waterfall, where a
// throw ends the child's turn with no model reply. Every path here therefore
// degrades to "inject nothing" instead of throwing.

import { handoffNames, injectedSkills } from './lib/handoff.mjs'
import { hostApi } from './lib/host-api.mjs'
import { renderProtocol } from './lib/protocol.mjs'

export const name = 'dsh-skill-surface'

const SECTION_NAME = 'dsh:skill-surface-handoff'
const SECTION_ORDER = 20100
/** Total injected body ceiling for one handoff; six huge SKILL.md files must not flood a child. */
export const HANDOFF_MAX_CHARS = 60000

async function injectHandoff(scope, { agent, messages, signal }) {
  const requested = handoffNames(messages)
  if (requested.length === 0) return undefined

  const injected = injectedSkills(agent)
  const wanted = requested.filter((skillName) => !injected.has(skillName))
  if (wanted.length === 0) return undefined

  const api = await hostApi()
  const cwd = await scope.workingDirectory.ensure(agent, signal)

  const additions = []
  let budget = HANDOFF_MAX_CHARS
  for (const skillName of wanted) {
    if (signal?.aborted) break
    const skill = await scope.skills.get(skillName, { scope: agent, cwd, signal })
    if (skill === undefined || !api.isModelInvocable(skill)) continue
    const text = api.renderSkillContent(skill)
    if (text.length > budget) break
    budget -= text.length
    injected.add(skillName)
    additions.push(api.createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'skill-invocation', name: skillName, form: 'instructions' },
    }))
  }
  return additions.length === 0 ? undefined : additions
}

function handoffListener(scope) {
  let warned = false
  return async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    let additions
    try {
      additions = await injectHandoff(scope, { agent, messages, signal })
    } catch (error) {
      // A missing host module, an unreadable workspace or a hostile skill
      // provider must cost the injection, never the child's turn. Warn once so
      // an operator can see it instead of guessing why nothing was injected.
      if (!warned) {
        warned = true
        scope.logger?.warn?.('skill-surface: handoff injection unavailable (%s)', error?.message ?? String(error))
      }
      return decision
    }
    if (additions === undefined || signal?.aborted) return decision
    return { ...decision, messages: [...decision.messages, ...additions] }
  }
}

export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(
      () => scope.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: () => renderProtocol('zh') }),
      'skill-surface handoff protocol',
    )
  })
  ctx.inject(['skills', 'workingDirectory'], (scope) => {
    scope.effect(() => scope.on('agent/pre-step', handoffListener(scope)), 'skill-surface handoff injection')
  })
}
