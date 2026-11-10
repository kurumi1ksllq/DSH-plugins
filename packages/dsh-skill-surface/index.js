// dsh-skill-surface — host entry.
//
// Two responsibilities, and one hard constraint:
//   1. a CONSTANT systemPrompt context (order 21100) that appears ONLY for
//      agents with no official `skill` tool.
//   2. a `skill_get` loader for those same agents: list without a name, load a
//      body with one.
//   3. HARD CONSTRAINT: never publish a skill catalog message. The official
//      publisher treats a shadowed instance as "publish an empty replacement"
//      (dsh-tool-skill:935-941), and #159 proved that erases a live catalog.
//
// Failure posture: one throw inside a step listener ends the child's turn with
// no model reply, so the handoff path degrades to "inject nothing".

import { handoffNames, injectedSkills } from './lib/handoff.mjs'
import { hostApi } from './lib/host-api.mjs'
import { LOADER, hintText, indexLine } from './lib/catalog-hint.mjs'
import { renderProtocol } from './lib/protocol.mjs'

export const name = 'dsh-skill-surface'

const SECTION_NAME = 'dsh:skill-surface-handoff'
const SECTION_ORDER = 20100
const HINT_NAME = 'dsh:skill-surface-fallback-hint'
const HINT_ORDER = 21100
/** Total injected body ceiling for one handoff; six huge SKILL.md files must not flood a child. */
export const HANDOFF_MAX_CHARS = 60000
/** Longest index line, and how many skills the fallback listing prints before summarizing. */
const INDEX_MAX_DESCRIPTION = 120
const INDEX_MAX_ROWS = 200

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

/** Whether this agent already has an official skill loader; if so we say nothing. */
function hasOfficialLoader(scope, agent) {
  if (agent === undefined) return true
  try {
    return scope.tools.get('skill', agent) !== undefined
  } catch {
    return true
  }
}

function lookupFor(scope, exec) {
  return (async () => {
    let cwd
    try {
      cwd = await scope.workingDirectory.ensure(exec.agent, exec.signal)
    } catch {
      cwd = undefined
    }
    return { scope: exec.agent, cwd, signal: exec.signal }
  })()
}

export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['systemPrompt', 'tools'], (scope) => {
    scope.effect(
      () => scope.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: () => renderProtocol('zh') }),
      'skill-surface handoff protocol',
    )
    scope.effect(
      () => scope.systemPrompt.context({
        name: HINT_NAME,
        order: HINT_ORDER,
        text: (context) => (hasOfficialLoader(scope, context?.scope) ? '' : hintText()),
      }),
      'skill-surface fallback hint',
    )
  })
  ctx.inject(['skills', 'workingDirectory', 'tools'], (scope) => {
    scope.effect(() => scope.on('agent/pre-step', handoffListener(scope)), 'skill-surface handoff injection')
    scope.effect(() => scope.tools.register({
      name: LOADER,
      description: 'Fallback skill access when this session has no official skill tool: call without a name to list available skills, or with a name to load that skill body. When a skill tool exists, prefer it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string', description: 'Exact skill name from the listing.' } },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args, exec) {
        const lookup = await lookupFor(scope, exec)
        const api = await hostApi()
        if (typeof args?.name !== 'string' || args.name === '') {
          const snapshot = await scope.skills.snapshot(lookup)
          const visible = snapshot.skills.filter((skill) => api.isModelInvocable(skill))
          const rows = visible.slice(0, INDEX_MAX_ROWS).map((skill) => indexLine(skill, INDEX_MAX_DESCRIPTION))
          const more = visible.length > rows.length ? '\n…还有 ' + (visible.length - rows.length) + ' 个,用更精确的任务描述缩小范围。' : ''
          return { text: ['可用技能 ' + visible.length + ' 个:', '', ...rows].join('\n') + more }
        }
        const skill = await scope.skills.get(args.name, lookup)
        if (skill === undefined) throw new Error(`unknown skill "` + args.name + '"; call ' + LOADER + ' without a name to list them')
        if (!api.isModelInvocable(skill)) throw new Error(`skill "` + args.name + '" is not available for model invocation')
        return { text: api.renderSkillContent(skill) }
      },
    }), 'skill-surface fallback loader')
  })
}
