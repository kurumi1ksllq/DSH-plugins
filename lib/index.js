/**
 * dsh-ctx-guard — engine-side context budget gate plus a `/handoff` command.
 * Spec: context-budget-plan-2026-10-28.md §3.2.
 *
 *   R1 `write.content`      > maxWriteChars   -> deny
 *   R2 `edit.new_string`    > maxEditChars    -> deny
 *   R3 shell `command`      > maxCommandChars -> deny
 *   R4 total tokens >= warnTokens             -> log only
 *   R5 total tokens >  freezeTokens           -> deny context-expanding tools
 *   R6 tokens >= compactTokens inside R5      -> try one pressure compaction first
 * R5 stays a denylist on purpose: `present`, `ask_user_question`, `todo_write`
 * and the team tools are how a frozen session still delivers.
 */
import { existsSync } from 'node:fs'
import { handoff } from './handoff.js'

export const name = 'ctx-guard'
export const inject = ['tools', 'tokenMeter', 'commands']

const DEFAULTS = {
  maxWriteChars: 8000,
  maxEditChars: 4000,
  maxCommandChars: 2000,
  warnTokens: 120000,
  freezeTokens: 140000,
  // This profile's compaction line after plan A: 0.3 x 512000 window. Update
  // it if thresholdRatio or the routed model's context window changes.
  compactTokens: 153600,
}

/** Tools that enlarge the prefix. Everything else stays callable. */
const FROZEN = new Set(['write', 'skill', 'web_fetch', 'bsk_inspect'])

const deny = (reason) => ({ kind: 'deny', reason })

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config !== null && typeof config === 'object' ? config : {}) }
  const lastWarn = new Map()

  const tokensOf = (agent) => {
    if (agent === undefined || agent.session === undefined) return 0
    try {
      return ctx.tokenMeter.measure(agent.session).totalTokens
    } catch {
      return 0
    }
  }

  ctx.on('agent/pre-step', ({ agent }, next) => {
    const tokens = tokensOf(agent)
    const key = agent?.session?.id ?? agent?.id
    const last = lastWarn.get(key)
    if (tokens >= cfg.warnTokens && (last === undefined || tokens - last >= 10000)) {
      lastWarn.set(key, tokens)
      ctx.logger.warn(`ctx-guard: ${tokens} tokens (warn ${cfg.warnTokens}, freeze ${cfg.freezeTokens})`)
    }
    return next()
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const args = exec.arguments !== null && typeof exec.arguments === 'object' ? exec.arguments : {}
    const size = (key) => (typeof args[key] === 'string' ? args[key].length : 0)

    if (exec.name === 'write' && size('content') > cfg.maxWriteChars) {
      return deny(`write 单次 ${size('content')} 字符 > ${cfg.maxWriteChars}：改用 edit 增量修改，或拆成多个文件`)
    }
    if (exec.name === 'edit' && size('new_string') > cfg.maxEditChars) {
      return deny(`edit 单次 ${size('new_string')} 字符 > ${cfg.maxEditChars}：分多次 edit`)
    }
    if ((exec.name === 'bash' || exec.name === 'pwsh') && size('command') > cfg.maxCommandChars) {
      return deny(`命令 ${size('command')} 字符 > ${cfg.maxCommandChars}：写成脚本文件再执行`)
    }

    const tokens = tokensOf(exec.agent)
    if (tokens > cfg.freezeTokens) {
      if (tokens >= cfg.compactTokens) await compactOnce(ctx, exec)
      if (FROZEN.has(exec.name)) {
        // Overwriting an existing file is the tail of an edit, not new context.
        if (exec.name === 'write' && typeof args.file_path === 'string' && existsSync(args.file_path)) return next()
        return deny(
          `上下文 ${tokens} tokens 已超过冻结线 ${cfg.freezeTokens}：停止扩张，先交付或用 edit 收尾；` +
            `需要更多上下文请 /handoff 开新会话`,
        )
      }
    }
    return next()
  })

  ctx.commands.register({
    definitionId: '@local/dsh-handoff',
    name: 'handoff',
    description: 'Write a handoff document under .dsh/handoff plus a paste-ready continuation prompt',
    input: { hint: 'optional title' },
    handler: (invocation) => handoff(ctx, invocation, invocation.rawInput.trim() || undefined),
  })
}

/** R6 fallback: one pressure compaction before the deny verdict. */
async function compactOnce(ctx, exec) {
  const compaction = ctx.get('compaction')
  if (compaction === undefined || exec.agent === undefined) return
  try {
    await compaction.compactIfNeeded(exec.agent, 'pressure', exec.signal)
  } catch (error) {
    ctx.logger.warn(`ctx-guard: forced compaction failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
