// dsh-skill-surface — host entry.
//
// What this bundle adds, and what it refuses to add:
//   1. a CONSTANT systemPrompt context (order 21100) that appears ONLY for
//      agents with no official `skill` tool;
//   2. a `skill_get` loader for those same agents, gated with `when` so an agent
//      that already has an official loader never sees an extra tool;
//   3. the `skills: a, b` delegation handoff.
// It publishes NO skill catalog message: the official publisher treats a shadowed
// instance as "publish an empty replacement" (dsh-tool-skill/lib/index.js:935-941
// in upstream 0.2.2-rc.1), and #159 proved that erases a live catalog.
//
// Each concern lives in its OWN `ctx.inject` block: a throw while registering one
// of them rolls back the effects registered earlier in the same callback, so they
// must not share a callback.
//
// Failure posture: one throw inside a step listener ends the child's turn with no
// model reply, so the handoff path degrades to "inject nothing".

import { handoffNames, injectedSkills } from './lib/handoff.mjs'
import { hostApi } from './lib/host-api.mjs'
import { LOADER, hintText, indexLine } from './lib/catalog-hint.mjs'
import { renderProtocol } from './lib/protocol.mjs'

export const name = 'dsh-skill-surface'

const SECTION_NAME = 'dsh:skill-surface-handoff'
const SECTION_ORDER = 20100
const HINT_NAME = 'dsh:skill-surface-fallback-hint'
const HINT_ORDER = 21100
/** Total injected body ceiling for one handoff or one skill_get, in characters. */
export const HANDOFF_MAX_CHARS = 60000
/** Longest index line, and how many skills the listing describes before naming the rest. */
const INDEX_MAX_DESCRIPTION = 120
const INDEX_MAX_ROWS = 200

/** Case-insensitive name/description match for the listing filter. */
function queryMatches(skill, query) {
  if (typeof query !== 'string' || query.trim() === '') return true
  const needle = query.trim().toLowerCase()
  return (String(skill.name) + ' ' + String(skill.description ?? '')).toLowerCase().includes(needle)
}

/** Whether this agent already has an official skill loader; if so we stay silent. */
function hasOfficialLoader(scope, agent) {
  if (agent === undefined) return true
  try {
    return scope.tools.get('skill', agent) !== undefined
  } catch {
    return true
  }
}

/**
 * Lookup context for the registry.
 *
 * Deliberately NOT swallowed: a workspace that cannot be resolved must surface as
 * a tool error, because resolving against an unknown directory would silently miss
 * every workspace-scoped skill.
 */
async function lookupFor(scope, exec) {
  const cwd = await scope.workingDirectory.ensure(exec.agent, exec.signal)
  return { scope: exec.agent, cwd, signal: exec.signal }
}

/** Cap one body so the fallback loader cannot bypass the handoff budget. */
function capped(text) {
  if (text.length <= HANDOFF_MAX_CHARS) return text
  return text.slice(0, HANDOFF_MAX_CHARS) + '\n\n[skill-surface: body truncated at ' + HANDOFF_MAX_CHARS + ' characters]'
}

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
      // A missing host module, an unreadable workspace or a hostile skill provider
      // must cost the injection, never the child's turn. Warn once so an operator
      // can see it instead of guessing why nothing was injected.
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

function listing(scope, lookup, api, args) {
  return scope.skills.snapshot(lookup).then((snapshot) => {
    const matched = snapshot.skills
      .filter((skill) => api.isModelInvocable(skill))
      .filter((skill) => queryMatches(skill, args?.query))
    if (matched.length === 0) {
      return { text: '没有匹配的技能。换个说法再列一次,或直接按任务本身做。' }
    }
    const rows = matched.slice(0, INDEX_MAX_ROWS).map((skill) => indexLine(skill, INDEX_MAX_DESCRIPTION))
    // Nothing may be invisible: whatever exceeds the described rows is still named.
    const rest = matched.slice(INDEX_MAX_ROWS).map((skill) => skill.name)
    const tail = rest.length === 0 ? [] : ['', '其余 ' + rest.length + ' 个(只列名字,请按名字精确取): ' + rest.join(', ')]
    return { text: ['可用技能 ' + matched.length + ' 个:', '', ...rows, ...tail].join('\n') }
  })
}

const LOADER_BASE = {
  name: LOADER,
  description: 'Fallback skill access when this session has no official skill tool: call without a name to list available skills (optionally filtered with query), or with a name to load that skill body. When a skill tool exists, prefer it.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: 'Exact skill name from the listing; omit to list.' },
      query: { type: 'string', description: 'Optional keyword filter for the listing (name or description).' },
    },
  },
  // Raw JSON Schema as accepted by ctx.tools.register: a property must NOT carry
  // `required: true` (the host rejects that), so the object lists its own keys.
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
}

function loaderHandle(scope) {
  return {
    async execute(args, exec) {
      const lookup = await lookupFor(scope, exec)
      const api = await hostApi()
      if (typeof args?.name !== 'string' || args.name === '') {
        return listing(scope, lookup, api, args)
      }
      const skill = await scope.skills.get(args.name, lookup)
      if (skill === undefined) {
        throw new Error('unknown skill "' + args.name + '"; call ' + LOADER + ' without a name to list them')
      }
      if (!api.isModelInvocable(skill)) {
        throw new Error('skill "' + args.name + '" is not available for model invocation')
      }
      return { text: capped(api.renderSkillContent(skill)) }
    },
    presentCall(args) {
      const named = typeof args?.name === 'string' && args.name !== ''
      return { card: 'generic', title: named ? 'Load skill ' + args.name : 'List skills', kind: 'read', rawInput: named ? args.name : '' }
    },
  }
}

export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  // 1. protocol + hint (never a catalog message)
  ctx.inject(['systemPrompt', 'tools'], (scope) => {
    scope.effect(
      () => scope.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: () => renderProtocol('zh') }),
      'skill-surface handoff protocol',
    )
    scope.effect(
      () => scope.systemPrompt.context({
        name: HINT_NAME,
        order: HINT_ORDER,
        text: (context) => (hasOfficialLoader(scope, context?.scope) ? '' : hintText('zh')),
      }),
      'skill-surface fallback hint',
    )
  })
  // 2. handoff injection — its own block so a failure elsewhere cannot roll it back
  ctx.inject(['skills', 'workingDirectory'], (scope) => {
    scope.effect(() => scope.on('agent/pre-step', handoffListener(scope)), 'skill-surface handoff injection')
  })
  // 3. fallback loader, hidden from agents that already have the official one
  ctx.inject(['skills', 'workingDirectory', 'tools'], (scope) => {
    scope.effect(
      () => scope.tools.register({ ...LOADER_BASE, ...loaderHandle(scope) }, {
        when: ({ agent }) => !hasOfficialLoader(scope, agent),
      }),
      'skill-surface fallback loader',
    )
  })
}
