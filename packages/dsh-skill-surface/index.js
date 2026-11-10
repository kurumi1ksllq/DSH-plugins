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

import { HANDOFF_MAX, handoffNames, injectedSkills } from './lib/handoff.mjs'
import { hostApi, modelInvocable } from './lib/host-api.mjs'
import { renderProtocol } from './lib/protocol.mjs'

export const name = 'dsh-skill-surface'

const SECTION_NAME = 'dsh:skill-surface-handoff'
const SECTION_ORDER = 20100

function handoffListener(scope) {
  return async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const requested = handoffNames(messages)
    if (requested.length === 0) return decision

    const injected = injectedSkills(agent)
    const wanted = requested.filter((skillName) => !injected.has(skillName)).slice(0, HANDOFF_MAX)
    if (wanted.length === 0) return decision

    const api = await hostApi()
    let cwd
    try {
      cwd = await scope.workingDirectory.ensure(agent, signal)
    } catch {
      cwd = undefined
    }

    const additions = []
    for (const skillName of wanted) {
      if (signal?.aborted) break
      const skill = await scope.skills.get(skillName, { scope: agent, cwd, signal })
      if (skill === undefined || !modelInvocable(skill)) continue
      injected.add(skillName)
      additions.push(api.createUserMessage({
        content: [{ type: 'text', text: api.renderSkillContent(skill) }],
        source: { kind: 'skill-invocation', name: skillName, form: 'instructions' },
      }))
    }
    if (additions.length === 0) return decision
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
