/**
 * Static knowledge the runtime cannot answer on its own.
 *
 * `ctx.tools.schemas()` gives tool names but no registrant, so ownership is
 * inferred: `mcp__<server>__*` is unambiguous, first-party tools come from this
 * list, and anything else is attributed to a plugin package by scanning that
 * package's shipped JS for the tool name (see `buildPluginToolIndex` in
 * index.js).
 */

/**
 * First-party tools shipped inside the DSH app (owner: deepseek-harness).
 *
 * A name belongs here only when the app itself registers it. Tools that a
 * *plugin* registers do not: listing `lsp_*` (dsh-lsp-actions) or
 * `doublecheck_*` (dsh-doublecheck) here made the panel call plugin tools
 * "内置" and also hid them from the plugin scan, which skips builtin names.
 */
export const BUILTIN_TOOLS = [
  'read', 'write', 'edit', 'grep', 'glob', 'pwsh', 'bash', 'run_code',
  'skill', 'create_skill', 'todo_write', 'ask_user_question', 'present',
  'web_fetch', 'web_search', 'read_image',
  'job_output', 'job_list', 'job_kill',
  'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'terminal_close', 'terminal_list',
  'working_directory', 'load_workspace_dependencies', 'create_worktree',
  'subagent', 'subagent_fork', 'list_agents', 'wait_agent', 'send_message', 'interrupt_agent', 'spawn_teammate',
  'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  'workflow', 'ralph',
  'goal_get', 'goal_create', 'goal_update', 'get_goal', 'create_goal', 'update_goal',
  'schedule_create', 'schedule_list', 'schedule_delete', 'schedule_update',
  'session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read',
  'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
  'exit_plan_mode',
]

/**
 * Commands that appear in skill bodies but are never registered tools.
 * Deliberately narrow: generic words like `python` or `node` also appear as
 * prose and produce nothing but noise.
 */
export const CLI_NAMES = ['officecli', 'vmrun', 'comfyui', 'ffmpeg', 'yt-dlp', 'winget', 'zstd']

/**
 * Split `mcp__<server>__<tool>` into its namespace.
 * @param {string} toolName
 * @returns {string|null}
 */
export function mcpServerOf(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null
  const rest = toolName.slice(5)
  const at = rest.indexOf('__')
  return at === -1 ? rest : rest.slice(0, at)
}

/**
 * Which tools does `dsh-tool-search` currently hide behind the bridge?
 *
 * The bridge is a system-prompt transform, so `ctx.tools.schemas()` cannot
 * report it; the plugin's own config can. Mirrors its rule: everything outside
 * `core` and the bridge tools is deferred once the catalog is large enough.
 * @param {{toolNames?: string[], toolSearch?: object|null}} input
 * @returns {Set<string>} deferred tool names.
 */
export function detectDeferred({ toolNames = [], toolSearch = null }) {
  const deferred = new Set()
  if (toolSearch === null || typeof toolSearch !== 'object') return deferred
  // `enabled` accepts 'auto' | 'on' | 'off', and a bare boolean in older patches.
  if (toolSearch.enabled === 'off' || toolSearch.enabled === false) return deferred
  const minCatalogSize = typeof toolSearch.minCatalogSize === 'number' ? toolSearch.minCatalogSize : 12
  if (toolNames.length < minCatalogSize) return deferred
  const core = new Set(Array.isArray(toolSearch.core) ? toolSearch.core : ['todo_write'])
  const bridges = new Set(
    Array.isArray(toolSearch.bridgeNames) ? toolSearch.bridgeNames : ['tool_search', 'tool_describe', 'tool_call'],
  )
  for (const name of toolNames) {
    if (typeof name !== 'string') continue
    if (core.has(name) || bridges.has(name)) continue
    deferred.add(name)
  }
  return deferred
}
