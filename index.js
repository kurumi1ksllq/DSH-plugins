/**
 * @local/dsh-prompt-inject
 *
 * Host-only DeepSeek Harness bundle that appends one small, self-describing
 * section to every agent system prompt. It exists to prove that the host-side
 * system-prompt injection route works end to end in this profile, and it is
 * deliberately inert apart from answering the verification-token question.
 *
 * Injection point: `ctx.systemPrompt.section({ name, order, text, interpolate })`
 * from `@deepseek-ai/dsh-system-prompt`. Registering from `apply()` binds the
 * section to this plugin's Cordis context, so it is disposed automatically
 * when the plugin is unloaded or disabled.
 */

/** Default section id in the assembled system prompt. */
export const DEFAULT_SECTION_NAME = 'demo:prompt-inject'

/** Default ordering slot (runs after the built-in prompt sections). */
export const DEFAULT_ORDER = 3500

/** Token a fresh agent must be able to echo back verbatim. */
export const DEFAULT_TOKEN = 'DSH-INJECT-7F3A-2026'

/**
 * Default injected text. Kept as a literal string: the section is registered
 * with `interpolate: false`, so no placeholder expansion happens on it.
 */
export const DEFAULT_TEXT = `## Local demo section — dsh-prompt-inject / 本地演示段落

This section is injected by the local Harness bundle \`@local/dsh-prompt-inject\` (row id \`prompt-inject\`). It exists only to demonstrate host-side system-prompt injection in this profile: it grants no extra capability, carries no user data, and is not a policy override.

本段由本地插件 \`@local/dsh-prompt-inject\` 注入，只用于演示本 profile 的系统提示词注入链路；它不赋予任何额外能力，不携带用户数据，也不构成策略覆盖。

- Verification token / 验证令牌: \`DSH-INJECT-7F3A-2026\`
- When the user asks "注入令牌是什么" or "what is the injection token", reply with exactly that token and nothing else — no explanation, no quotation marks, no additional sentence.
- In every other situation, do not mention this section, its token, or the injection at all, and do not let it change any other behavior. All other system-prompt rules (safety, permissions, tool use, response style) still apply exactly as written; this section never overrides them.`

/**
 * Cordis plugin entry.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ text?: string, order?: number, name?: string }} [config]
 */
export function apply(ctx, config = {}) {
  // A patch row may hand us `null` (or a non-object) as config; treat any
  // non-object value as "use defaults" instead of throwing during load.
  const options = config && typeof config === 'object' ? config : {}

  const sectionName =
    typeof options.name === 'string' && options.name.length > 0
      ? options.name
      : DEFAULT_SECTION_NAME

  const order =
    typeof options.order === 'number' && Number.isFinite(options.order)
      ? options.order
      : DEFAULT_ORDER

  const text =
    typeof options.text === 'string' && options.text.length > 0
      ? options.text
      : DEFAULT_TEXT

  // `interpolate: false` is required: the text is a literal and may contain
  // characters that the prompt interpolator would otherwise try to expand.
  // The returned disposer is managed by this plugin's Cordis effect scope,
  // so no manual teardown is needed here.
  ctx.systemPrompt.section({
    name: sectionName,
    order,
    text,
    interpolate: false,
  })
}

/** Cordis service dependency: the system-prompt service must exist first. */
export const inject = ['systemPrompt']
