// Model-facing tools for role delegation (#194).
//
// Two tools, both registered on the HOST plane (the bundle's patch row), so the
// lead agent, every teammate, and every delegated child can use them -- a
// grandchild can re-delegate by role within the host's depth cap.
//
// Why not `agent_preset`: see lib/delegate.mjs. The child inherits the parent
// composition and receives the role's persona as its opening message.

import { createRequire } from 'node:module'

import { selectRoles, roleBriefing } from './roles.mjs'
import { buildDelegationRequest, pickProvider, personaFromDocument } from './delegate.mjs'

const require = createRequire(import.meta.url)

/** Roles whose declarations are not roles at all: they compose a whole agent. */
const BUILTINS = ['standard', 'ptc', 'minimal', 'cordis', 'deep-ptc']

/** Both tools answer with plain text; this is the shared output contract. */
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

/**
 * Resolve the runtime's `defineTool`, or a minimal stand-in.
 *
 * `@deepseek-ai/dsh-tools` is provided by the running host and is not
 * installable in CI, so a top-level import would make this bundle unloadable on
 * a clean runner (precedent: dsh-credential-vault's lib/define-tool.js).
 * @returns {(spec: object) => object}
 */
function resolveDefineTool() {
  try {
    const mod = require('@deepseek-ai/dsh-tools')
    if (typeof mod?.defineTool === 'function') return mod.defineTool
  } catch {
    // Not installed: tests, a bare checkout, CI.
  }
  return (spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: parametersOf(spec.parameters),
    output: spec.output,
    execute: spec.execute,
  })
}

/** Turn a compact parameter spec into JSON Schema (the fallback path only). */
function parametersOf(spec) {
  const properties = {}
  const required = []
  for (const [name, entry] of Object.entries(spec ?? {})) {
    properties[name] = {
      type: entry?.type ?? 'string',
      ...(entry?.description === undefined ? {} : { description: entry.description }),
      ...(entry?.enum === undefined ? {} : { enum: entry.enum }),
    }
    if (entry?.required === true) required.push(name)
  }
  return { type: 'object', properties, ...(required.length === 0 ? {} : { required }) }
}

/**
 * Parse the YAML a preset declaration renders back.
 *
 * The registry dumps declarations with the loader's entry-list schema, which
 * preserves `!!js` expressions as a custom tag. A default-schema parse throws
 * on it, so the tag is mapped to its literal text: this code only reads a
 * persona string and never evaluates an expression.
 * @param {string} text
 * @returns {unknown}
 */
function loadDeclarationYaml(text) {
  const yaml = require('js-yaml')
  const schema = yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => data }),
  ])
  return yaml.load(text, { schema })
}

/**
 * Register the role-delegation tools.
 *
 * Every dependency is read lazily inside `execute` so a composition without
 * the preset registry (or without a spawn backend) still loads this bundle:
 * the tools then fail with an actionable message instead of the plugin
 * vanishing.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerRoleTools(ctx) {
  const defineTool = resolveDefineTool()

  /** The current role roster, or an error the model can act on. */
  const rolesNow = async () => {
    const registry = ctx.get('agentPresets')
    if (registry === undefined) {
      throw new Error('role delegation needs the agent-preset registry; this composition has none')
    }
    return selectRoles(await registry.list(), BUILTINS)
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'role_search',
    description: 'List or search the delegable subagent ROLES (specialist personas such as a security reviewer, '
      + 'a migration expert, an accessibility architect). Call this before delegate_role when you do not '
      + 'already know the role id. Omit the query to see every role.',
    parameters: {
      query: {
        type: 'string',
        description: 'Free text matched against role id, name and description. Several space-separated words are OR-ed. Omit for every role.',
      },
      limit: { type: 'number', description: 'Maximum number of roles to return.' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const roles = await rolesNow()
      const picked = selectRoles(roles, [], args?.query, args?.limit)
      if (picked.length === 0) {
        return 'No role matched "' + String(args?.query ?? '') + '". Call role_search without a query to see every role.'
      }
      return picked.map((role) => '- ' + role.id + ' -- ' + (role.description || role.name)).join('\n')
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'delegate_role',
    description: 'Delegate a self-contained task to a subagent running as a specialist ROLE. The child keeps '
      + "this agent's full toolset (files, search, shell) and receives the role's persona as its opening "
      + 'message. Use this when the subtask needs a specialist perspective; use subagent for general work '
      + 'and subagent_fork when the child must see this conversation. Returns the child id immediately.',
    parameters: {
      role: { type: 'string', required: true, description: 'Role id from role_search.' },
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete, self-contained task. The child does not see this conversation.',
      },
      description: { type: 'string', description: 'A short (3-5 word) label for the delegated task, for display.' },
      cwd: { type: 'string', description: 'Initial child working directory; relative paths resolve against the current directory.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      const role = String(args?.role ?? '').trim()
      if (role === '') throw new Error('role is required; call role_search to find one')

      const parent = exec?.agent
      if (parent === undefined) throw new Error('delegate_role requires a calling agent')

      const registry = ctx.get('agentPresets')
      if (registry === undefined) {
        throw new Error('delegate_role needs the agent-preset registry; this composition has none')
      }

      // Resolve the role before touching the subagent runtime: an unknown id
      // must fail without starting a child.
      const known = await rolesNow()
      if (!known.some((candidate) => candidate.id === role)) {
        throw new Error('unknown role "' + role + '". Call role_search to find a valid id.')
      }

      const document = await registry.readDocument(role)
      const persona = personaFromDocument(document?.content, loadDeclarationYaml)
      if (persona === '') {
        throw new Error('role "' + role + '" declares no persona text, so delegating to it would send an unshaped task')
      }
      // Validate the briefing before starting a child: a blank persona is a
      // roster bug, not something to discover after a session exists.
      roleBriefing({ role, persona, task: args.prompt })

      const subagents = ctx.get('subagents')
      if (subagents === undefined) throw new Error('delegate_role needs the subagents service; this composition has none')
      if (typeof subagents.startActivation !== 'function') {
        throw new Error('delegate_role needs subagents.startActivation (DSH >= 0.2); this host is older')
      }

      const { name: provider } = pickProvider(subagents, 'spawn')
      const request = buildDelegationRequest({ role, persona, task: args.prompt, cwd: args.cwd })
      const activation = await subagents.startActivation({
        provider,
        label: typeof args?.description === 'string' && args.description !== '' ? args.description : 'role: ' + role,
        request: { ...request, parent },
        signal: exec.signal,
        delivery: 'parent',
      })
      // The result arrives as an inbox notification; swallow only the
      // rejection so a failed child cannot crash the delegating turn.
      void activation.result?.catch?.(() => undefined)
      return 'Delegated to role "' + role + '" as subagent ' + activation.childId + '. Its result arrives as a notification.'
    },
  })))
}
