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
import { looksLikeNudge, matchDomains, nudgeLine, shortlist } from './lib/domains.mjs'
import { hostApi } from './lib/host-api.mjs'
import { LOADER, hintText, indexLine } from './lib/catalog-hint.mjs'
import { renderProtocol } from './lib/protocol.mjs'
import { intentCandidates } from './lib/intent-map.mjs'

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
  // The guard belongs HERE, not only in bodyFor(). workingDirectory.ensure reads
  // agent.session on its first line (dsh-working-directory/lib/index.js:91-93),
  // so an unguarded call throws before the loader ever reaches the bookkeeping —
  // #204 was only half fixed while this line stayed unconditional. The official
  // skill tool guards the same call (dsh-tool-skill/lib/index.js:869).
  const cwd = exec.agent === undefined ? undefined : await scope.workingDirectory.ensure(exec.agent, exec.signal)
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

const NO_MATCH = '没有匹配的技能。换个说法再列一次,或直接按任务本身做。'

/** Skills a listing query matches, model-invocable only, in snapshot order. */
function matchedSkills(snapshot, api, query) {
  return snapshot.skills
    .filter((skill) => api.isModelInvocable(skill))
    .filter((skill) => queryMatches(skill, query))
}

/**
 * One skill's body, exactly as the `name` path returns it.
 *
 * A query that narrows to a single skill is an attempt to load that skill: the
 * model has already named what it wants, so answering with a one-row index makes
 * it spend another step to ask again — and observed sessions simply stopped
 * there instead (issue-201). The cap and the injected-skills record are shared
 * with the name path so the two cannot diverge.
 */
function bodyFor(skill, agent, api) {
  // The record only suppresses a later nudge, and a nudge is keyed by the agent
  // whose conversation it would repeat in. An assembly that runs this tool with
  // no agent has no such conversation, so skipping the record is correct —
  // whereas calling injectedSkills(undefined) threw "Invalid value used as weak
  // map key" and cost the body itself (#204). The official skill tool tolerates
  // the same shape (dsh-tool-skill/lib/index.js:869).
  if (agent !== undefined) injectedSkills(agent).add(skill.name)
  return { text: capped(api.renderSkillContent(skill)) }
}

function listing(scope, lookup, api, args, agent) {
  return scope.skills.snapshot(lookup).then(async (snapshot) => {
    const matched = matchedSkills(snapshot, api, args?.query)
    if (matched.length === 0) {
      // Lexical matching cannot cross from a Chinese request to an English skill
      // description: measured zero hits for 跑测试/鉴权/数据库迁移 on the live
      // 272-entry catalog (issue-206). The curated table is a fallback, not a
      // search engine — every name it offers must exist in THIS snapshot, so a
      // stale row can never name a skill the install does not ship.
      const available = new Set(snapshot.skills.filter((skill) => api.isModelInvocable(skill)).map((skill) => skill.name))
      const guesses = intentCandidates(args?.query, available)
      if (guesses.length === 0) return { text: NO_MATCH }
      return { text: ['没有直接匹配的技能。以下可能相关(按名字精确取):', '', ...guesses.map((name) => '- ' + name)].join('\n') }
    }
    const asked = typeof args?.query === 'string' && args.query.trim() !== ''
    // A single hit IS the answer: return the body, not a one-row index — but a
    // snapshot row is a SkillSummary and carries NO content (dsh-skill
    // toSummary drops it). The body only exists behind skills.get(), so re-fetch
    // it exactly like the name path instead of rendering the summary.
    if (asked && matched.length === 1) {
      const full = await scope.skills.get(matched[0].name, lookup)
      if (full === undefined || !api.isModelInvocable(full)) return { text: NO_MATCH }
      return bodyFor(full, agent, api)
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
        return listing(scope, lookup, api, args, exec.agent)
      }
      const skill = await scope.skills.get(args.name, lookup)
      if (skill === undefined) {
        throw new Error('unknown skill "' + args.name + '"; call ' + LOADER + ' without a name to list them')
      }
      if (!api.isModelInvocable(skill)) {
        throw new Error('skill "' + args.name + '" is not available for model invocation')
      }
      return bodyFor(skill, exec.agent, api)
    },
    // The title is the only thing a session log shows, so it must name the branch
    // execute() will actually take — including the single-hit case #201 made
    // return a BODY rather than a listing. A pure pending-state presenter cannot
    // see the catalog (dsh-tools schema.d.ts:227-232), so it cannot know whether
    // a query will hit one skill or many; "Search skills" is true either way.
    // The whitespace test matches execute(), which treats a blank query as a list.
    presentCall(args) {
      // A card title is a header/log line and the host asks for it to stay short
      // (dsh-tools/lib/types/presentation.d.ts:49-52). The ceiling and the newline
      // collapse are applied to EVERY branch, not just the query one: a name is
      // model-supplied text too, so an unclamped name could push a 300-character
      // header into the log, or embed a newline and forge a fake log line.
      // rawInput stays verbatim in every branch — it is the detail view, not the
      // header, and rewriting the user's own input there would be a lie.
      const heading = (text) => clampLine(String(text).replace(/\s+/gu, ' '))
      const named = typeof args?.name === 'string' && args.name !== ''
      if (named) return { card: 'generic', title: heading('Load skill ' + args.name), kind: 'read', rawInput: args.name }
      const asked = typeof args?.query === 'string' && args.query.trim() !== ''
      if (asked) return { card: 'generic', title: heading('Search skills: ' + args.query.trim()), kind: 'read', rawInput: args.query }
      return { card: 'generic', title: 'List skills', kind: 'read', rawInput: '' }
    },
  }
}

/** Per-agent record of the turn we last nudged, so one turn speaks once. */
const nudgedTurn = new WeakMap()
let nudgeWarned = false

/** Hard ceiling for one nudge line, enforced in code rather than by convention. */
const NUDGE_MAX_CHARS = 120

function clampLine(line) {
  return line.length <= NUDGE_MAX_CHARS ? line : line.slice(0, NUDGE_MAX_CHARS - 1) + '…'
}

/** The text the user themselves typed in this step batch. */
function userText(messages) {
  const parts = []
  for (const message of messages ?? []) {
    const source = message?.source
    // The task itself counts, and it is a plain user message even for a
    // delegated child: the host submits the child's prompt with
    // source.kind === 'user' and no form (verified on 407 logged sessions, issue-201).
    // 'relay' stays accepted because a mid-conversation handoff does carry it.
    if (source?.kind !== 'user' && source?.form !== 'relay') continue
    for (const block of message.content ?? []) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      // A relayed report may quote this very line. Drop that block only:
      // the same batch can still carry the real request.
      if (looksLikeNudge(block.text)) continue
      parts.push(block.text)
    }
  }
  return parts.join(String.fromCharCode(10))
}

/**
 * Name the skills this turn probably needs, once.
 * @param scope - the plugin scope carrying the registry.
 * @param payload - the pre-step payload.
 * @returns the message to inject, or undefined.
 */
async function nudgeFor(scope, { agent, messages, turn, signal }) {
  const text = userText(messages)
  if (text === '') return undefined

  const matches = matchDomains(text)
  if (matches.length === 0) return undefined
  if (nudgedTurn.get(agent) === turn) return undefined

  const api = await hostApi()
  const cwd = await scope.workingDirectory.ensure(agent, signal)
  const snapshot = await scope.skills.snapshot({ scope: agent, cwd, signal })
  const available = new Set(snapshot.skills.filter((skill) => api.isModelInvocable(skill)).map((skill) => skill.name))
  const already = injectedSkills(agent)

  for (const match of matches) {
    const names = shortlist(match, text).filter((name) => available.has(name))
    if (names.length === 0) continue
    // Another domain may still deserve its own line: skip, do not abort.
    if (names.some((name) => already.has(name))) continue
    const loader = hasOfficialLoader(scope, agent) ? '`skill`' : '`skill_get`'
    const line = clampLine(nudgeLine(match.domain, names, loader))
    if (line === '') continue
    nudgedTurn.set(agent, turn)
    return api.createUserMessage({
      content: [{ type: 'text', text: line }],
      // A notice-form context must carry a summary, or renderers drop the row.
      source: { kind: 'skill-nudge', form: 'notice', summary: match.domain.label },
    })
  }
  return undefined
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
  // 4. one-line nudge naming the skills this turn probably needs (all agents)
  ctx.inject(['skills', 'workingDirectory', 'tools'], (scope) => {
    scope.effect(() => scope.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      let message
      try {
        message = await nudgeFor(scope, payload)
      } catch (error) {
        if (!nudgeWarned) {
          nudgeWarned = true
          scope.logger?.warn?.(String(error?.message ?? error))
        }
        return decision
      }
      if (message === undefined || payload.signal?.aborted) return decision
      return { ...decision, messages: [...decision.messages, message] }
    }), 'skill-surface domain nudge')
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
