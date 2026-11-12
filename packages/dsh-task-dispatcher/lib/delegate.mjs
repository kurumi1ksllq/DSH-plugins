// Delegation request assembly for `delegate_role` (#194).
//
// The one invariant this module exists to protect: the request NEVER carries
// `agentPreset`. Omission makes the host join the child to the parent's live
// composition (`applyChildComposition` -> `composeFrom`), so the child keeps
// every tool the parent has. Naming a preset instead mounts that preset's own
// child list, and for the 133 persona-only ECC presets that list is one row —
// measured on DSH 0.2.2-rc.1: 27 tools vs 57, with read/write/edit/glob/grep
// all gone and no way to delegate further.

import { buildChildPrompt } from './roles.mjs'

/**
 * Assemble the provider-agnostic part of a child start request.
 *
 * Deliberately returns a plain object with no host imports: the tool layer adds
 * `parent`, `signal` and the provider-specific fields, and the tests can assert
 * the invariant without a running harness.
 * @param {{role: string, persona: string, task: string, cwd?: string}} input
 * @returns {{prompt: Array<{type: 'text', text: string}>, cwd?: string}}
 */
export function buildDelegationRequest(input) {
  const request = { prompt: buildChildPrompt(input) }
  if (typeof input?.cwd === 'string' && input.cwd !== '') request.cwd = input.cwd
  return request
}

/**
 * Pick the delegation backend.
 *
 * `spawn` is the fresh-context backend and the only one that can carry an
 * independent role; `fork` inherits the conversation and is not a substitute.
 * If `spawn` is absent we take the first provider that does not inherit parent
 * context rather than hardcoding a name that a deployment may have renamed.
 * @param {{list: () => string[], getProvider: (name: string) => object|undefined}} subagents
 * @param {string} [preferred]
 * @returns {{name: string, provider: object}}
 * @throws when no usable backend is registered.
 */
export function pickProvider(subagents, preferred = 'spawn') {
  const names = typeof subagents?.list === 'function' ? subagents.list() : []
  const describe = (name) => (typeof subagents?.getProvider === 'function' ? subagents.getProvider(name) : undefined)

  const wanted = describe(preferred)
  if (wanted !== undefined && wanted.inheritsParentContext !== true) {
    return { name: preferred, provider: wanted }
  }
  for (const name of names) {
    const provider = describe(name)
    if (provider !== undefined && provider.inheritsParentContext !== true) return { name, provider }
  }
  throw new Error(
    'delegate_role needs a fresh-context subagent backend, but none is registered'
      + ' (available: ' + (names.join(', ') || 'none') + '). Enable the subagent spawn provider.',
  )
}

/**
 * Extract the persona text a registered preset declares.
 *
 * Reads the live registry instead of copying 133 persona documents into this
 * repository: `readDocument` renders the declaration's child list back as YAML
 * (`dsh-agent-preset-registry`), and the persona plugin's `prefix` is the text.
 * `!!js` tags appear in some declarations, so the schema tolerates them.
 * @param {string} document - YAML returned by `agentPresets.readDocument(id)`.
 * @param {(text: string) => unknown} loadYaml - parser injection (keeps this module testable).
 * @returns {string} the persona prefix, or '' when the document carries none.
 */
export function personaFromDocument(document, loadYaml) {
  let rows
  try {
    rows = loadYaml(String(document ?? ''))
  } catch (error) {
    throw new Error('cannot read the role definition as YAML: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (!Array.isArray(rows)) return ''
  for (const row of rows) {
    if (typeof row?.name !== 'string' || !/dsh-persona$/.test(row.name)) continue
    const prefix = row?.config?.prefix
    if (typeof prefix === 'string' && prefix.trim() !== '') return prefix
  }
  return ''
}

