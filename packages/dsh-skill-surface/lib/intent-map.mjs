// A small, curated Chinese-intent → skill-name table.
//
// WHY THIS EXISTS (measured 2026-11-14, 418 logged sessions):
//   - Skill descriptions are English; users ask in Chinese.
//   - The live 272-entry catalog returned ZERO lexical hits for 跑测试, 单元测试,
//     样式, 鉴权, 数据库迁移, 部署 and 代码安全审查.
//   - A BM25 reimplementation failed the same way and ranked
//     `openclaw-persona-forge` for 部署到生产环境.
//
// WHY IT IS NOT A SEARCH ENGINE AND NOT AN AUTO-INJECTOR:
//   No keyword table can cover 272 English-described skills from Chinese input,
//   so this table is deliberately small and honest about its reach. It is a
//   fallback the MODEL may consult; the model still decides whether to load.
//   The per-turn nudge in ./domains.mjs remains the always-on path.
//
// Every returned name must exist in the live catalog, so a stale row can never
// name a skill this install does not ship.

/** Intents worth mapping. Order inside a row is preference order. */
export const INTENTS = [
  { id: 'testing', words: ['测试', '单测', '用例', '覆盖率', '回归', 'tdd', 'test'], skills: ['tdd-workflow', 'test-coverage', 'python-testing', 'react-testing'] },
  { id: 'security', words: ['鉴权', '认证', '授权', '安全', '密钥', '漏洞', '注入', 'xss', 'csrf', 'security', 'auth'], skills: ['security-review', 'agent-security-hardening'] },
  { id: 'ui', words: ['样式', '美化', '配色', '圆角', '间距', '字体', '界面', '布局', '设计稿', 'css', 'ui', 'ux'], skills: ['make-interfaces-feel-better', 'design-system', 'frontend-design-direction', 'accessibility'] },
  // Families are mutually exclusive: suggesting react-patterns for a Vue task is
  // exactly the noise that gets a hint ignored (domains.mjs learned this first).
  { id: 'frontend', words: ['react', 'vue', 'nuxt', 'vite', 'next', 'jsx', 'tsx', '组件', '前端'],
    stacks: {
      react: ['react-patterns', 'react-performance', 'frontend-patterns'],
      vue: ['vue-patterns', 'frontend-patterns'],
      generic: ['frontend-patterns'],
    } },
  { id: 'database', words: ['数据库', '迁移', '索引', '事务', 'sql', 'postgres', 'mysql', 'schema'], skills: ['database-migrations', 'postgres-patterns', 'mysql-patterns'] },
  { id: 'api', words: ['接口', '端点', 'api', 'rest', 'graphql'], skills: ['api-design', 'backend-patterns'] },
  { id: 'ops', words: ['部署', '镜像', '容器', '流水线', 'docker', 'k8s', 'kubernetes', 'ci', 'deploy'], skills: ['deployment-patterns', 'docker-patterns'] },
  { id: 'review', words: ['审查', '评审', '代码审查', 'review', 'refactor', '重构'], skills: ['code-reviewer', 'refactoring-patterns', 'coding-standards'] },
]

/** Most names one fallback answer may carry. */
export const MAX_CANDIDATES = 5

/** Which frontend family a request names; defaults to the generic one. */
function family(lowered) {
  if (occurs('react', lowered) || occurs('jsx', lowered) || occurs('tsx', lowered) || occurs('next', lowered)) return 'react'
  if (occurs('vue', lowered) || occurs('nuxt', lowered)) return 'vue'
  return 'generic'
}

/** Whether one word occurs; ASCII words respect word edges like ./domains.mjs. */
function occurs(word, text) {
  const needle = String(word).toLowerCase()
  if (!/^[a-z0-9.]+$/u.test(needle)) return text.includes(needle)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'u').test(text)
}

/**
 * Candidate skill names for a request, in preference order.
 * @param text - the user's words.
 * @param available - names the live catalog actually has.
 * @returns at most MAX_CANDIDATES names, all present in `available`.
 */
export function intentCandidates(text, available) {
  if (typeof text !== 'string' || text.trim() === '') return []
  const have = available instanceof Set ? available : new Set(available ?? [])
  const lowered = text.toLowerCase()
  const out = []
  for (const intent of INTENTS) {
    if (!intent.words.some(word => occurs(word, lowered))) continue
    // A stack-aware intent picks one family, so a Vue task never opens with React.
    const skills = intent.stacks === undefined ? intent.skills
      : intent.stacks[family(lowered)] ?? intent.stacks.generic
    for (const name of skills) {
      if (!have.has(name) || out.includes(name)) continue
      out.push(name)
      if (out.length >= MAX_CANDIDATES) return out
    }
  }
  return out
}
