// Role catalog: treat the registered agent presets as a roster of delegable
// subagent ROLES.
//
// Why this exists (#194): a preset is a whole agent composition, not a persona
// label. Naming one in a delegation replaces the child's entire tool set —
// measured on DSH 0.2.2-rc.1, an `agent_preset: planner` child had 27 tools and
// none of read/write/edit/glob/grep, while an inherited child had 57. The 133
// ECC presets are persona-only shells, so "delegate to preset X" produced a
// tool-less agent that could not do the work.
//
// This module keeps the role *identity* (id/name/description) and the role
// *text* (the persona the registry holds) but never asks the host to compose a
// child from a preset. Delegation inherits the parent composition and carries
// the persona in the task message — see lib/delegate.mjs.

/** Built-in compositions that are not roles: they compose a whole agent. */
export const BUILTIN_PRESETS = ['standard', 'ptc', 'minimal', 'cordis', 'deep-ptc']

/** Longest role briefing we forward, in characters. Personas reach 28k. */
const MAX_PERSONA_CHARS = 60_000

/**
 * Normalize one roster row. The registry publishes id/name/description and
 * omits the last two when the declaration did not carry them.
 * @param {object} row
 * @returns {{id: string, name: string, description: string}|null}
 */
function roleOf(row) {
  const id = typeof row?.id === 'string' ? row.id.trim() : ''
  if (id === '') return null
  return {
    id,
    name: typeof row.name === 'string' && row.name !== '' ? row.name : id,
    description: typeof row.description === 'string' ? row.description : '',
  }
}

/**
 * Pick the delegable roles out of a roster.
 *
 * A row is a role unless it is one of the built-in full compositions. Matching
 * is case-insensitive and ORs the whitespace-separated query terms across id,
 * name and description, so "安全" and "WCAG planner" both behave.
 * @param {ReadonlyArray<object>} roster - rows from `agentPresets.list()`.
 * @param {ReadonlyArray<string>} builtins - ids to exclude.
 * @param {string} [query] - free-text filter; blank means "every role".
 * @param {number} [limit] - cap on the answer; a non-positive value is unset.
 * @returns {Array<{id: string, name: string, description: string}>}
 */
export function selectRoles(roster, builtins, query, limit) {
  const excluded = new Set((builtins ?? []).map((id) => String(id).trim().toLowerCase()))
  const terms = String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '')

  const roles = []
  for (const row of roster ?? []) {
    const role = roleOf(row)
    if (role === null || excluded.has(role.id.toLowerCase())) continue
    if (terms.length > 0) {
      const haystack = (role.id + ' ' + role.name + ' ' + role.description).toLowerCase()
      if (!terms.some((term) => haystack.includes(term))) continue
    }
    roles.push(role)
  }

  const cap = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined
  return cap === undefined ? roles : roles.slice(0, cap)
}

/**
 * Wrap one role's persona and the caller's task into the child's opening
 * message.
 *
 * The framing matters: the child inherits the parent's full composition, and a
 * model that is told only "you are X" while holding 57 tools will sometimes
 * announce that it has no tools. So the briefing states both the role and the
 * fact that the toolset is intact.
 * @param {{role: string, persona: string, task: string}} input
 * @returns {string}
 * @throws when the persona is blank — a role with no text is a roster bug, and
 *   sending a bare task would silently drop the specialization.
 */
export function roleBriefing(input) {
  const role = String(input?.role ?? '').trim()
  const persona = String(input?.persona ?? '').trim()
  const task = String(input?.task ?? '')
  if (persona === '') throw new Error('role briefing requires a non-empty persona for role "' + role + '"')
  const clipped = persona.length > MAX_PERSONA_CHARS ? persona.slice(0, MAX_PERSONA_CHARS) + '\n…(truncated)' : persona
  return [
    '## 你的角色',
    '',
    '你被委派为 **' + role + '**。以下是该角色的完整职责说明,请按它行事:',
    '',
    clipped,
    '',
    '## 工作方式',
    '',
    '- 你继承了委派方**完整的工具组合**(读写文件、搜索、执行命令等都在),不要声称自己没有工具。',
    '- 只做下面这一件事;完成后直接给出结果,不需要复述角色说明。',
    '- 需要更大权限的操作会被拒绝,遇到就说明限制,不要反复重试。',
    '',
    '## 任务',
    '',
    task,
  ].join('\n')
}

/**
 * Build the content blocks a child receives as its opening message.
 * @param {{role: string, persona: string, task: string}} input
 * @returns {Array<{type: 'text', text: string}>}
 */
export function buildChildPrompt(input) {
  return [{ type: 'text', text: roleBriefing(input) }]
}

