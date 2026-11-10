// Curated domain table for the skill nudge.
//
// Deliberately NOT a search index. A lexical sweep over 270 descriptions hits
// 123 entries for one ordinary sentence, and the English phrasing of the same
// request ranks prompt-optimizer first. Noise teaches the model to ignore the
// nudge, so each domain carries a hand-picked shortlist instead; the runtime
// drops any name the catalog does not actually have.

/** Most names one nudge may carry: a hint, not a reading list. */
export const MAX_NAMES = 3

/**
 * Domains worth interrupting for.
 *
 * `strong` holds words that identify the domain on their own (someone asking for
 * '配色' or '圆角' wants UI work); every other keyword needs a second signal from
 * the same domain before the nudge fires.
 */
export const DOMAINS = [
  {
    id: 'ui',
    label: 'UI/界面细节',
    strong: ['配色', '颜色', '美化', '圆角', '阴影', '边距', '空行', '视觉', '设计稿', '间距', '字体', '样式'],
    keywords: ['页面', '界面', '布局', '颜色', '按钮', '组件', '太挤', '对齐', '留白',
      'ui', 'ux', 'css', 'layout', 'spacing', 'typography', 'color', 'theme', 'screen', 'design', 'polish'],
    skills: ['make-interfaces-feel-better', 'design-system', 'frontend-design-direction', 'accessibility'],
  },
  {
    id: 'frontend',
    label: '前端组件',
    strong: ['jsx', 'tsx', 'hooks'],
    keywords: ['react', 'vue', 'nuxt', 'vite', 'next.js', 'nextjs'],
    // Families are mutually exclusive: suggesting vue-patterns for a React task
    // is exactly the kind of noise that gets nudges ignored.
    stacks: {
      react: ['react-patterns', 'react-performance', 'frontend-patterns'],
      vue: ['vue-patterns', 'frontend-patterns'],
      generic: ['frontend-patterns'],
    },
    skills: ['react-patterns', 'vue-patterns', 'frontend-patterns', 'react-performance'],
  },
  {
    id: 'api',
    label: '接口设计',
    strong: ['端点'],
    keywords: ['接口', 'api', 'rest', 'graphql', 'endpoint'],
    skills: ['api-design', 'backend-patterns'],
  },
  {
    id: 'database',
    label: '数据库/迁移',
    strong: ['迁移', '索引', '事务'],
    keywords: ['数据库', 'sql', 'migration', 'schema', 'postgres', 'mysql'],
    skills: ['database-migrations', 'postgres-patterns', 'mysql-patterns'],
  },
  {
    id: 'testing',
    label: '测试',
    strong: ['覆盖率'],
    keywords: ['测试', '回归', '用例', 'test', 'coverage', 'e2e', 'fixture'],
    skills: ['tdd-workflow', 'test-coverage'],
  },
  {
    id: 'security',
    label: '安全/鉴权',
    strong: ['鉴权', '密钥', '注入'],
    keywords: ['安全', '认证', '授权', '权限', 'auth', 'security', 'csrf', 'xss'],
    skills: ['security-review', 'agent-security-hardening'],
  },
  {
    id: 'ops',
    label: '构建/部署',
    strong: ['部署', '镜像', '流水线'],
    keywords: ['容器', 'docker', 'kubernetes', 'k8s', 'ci', 'deploy'],
    skills: ['deployment-patterns', 'docker-patterns'],
  },
]

const ASCII = /^[a-z0-9.]+$/

/** Whether one keyword occurs in the text; ASCII keywords respect word edges. */
function occurs(keyword, text) {
  if (!ASCII.test(keyword)) return text.includes(keyword)
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'u').test(text)
}

/**
 * Domains whose signal is strong enough to interrupt for.
 * @param text - the user's own words for this turn.
 * @returns matching domains, strongest first, with their hit count.
 */
export function matchDomains(text) {
  if (typeof text !== 'string' || text.trim() === '') return []
  const lowered = text.toLowerCase()
  const matches = []
  for (const domain of DOMAINS) {
    const strong = (domain.strong ?? []).filter((word) => occurs(word.toLowerCase(), lowered))
    const weak = domain.keywords.filter((word) => occurs(word.toLowerCase(), lowered))
    const hits = strong.length + weak.length
    // One strong word identifies the domain; otherwise two signals are required.
    if (strong.length === 0 && weak.length < 2) continue
    matches.push({ domain, hits, strong: strong.length > 0 })
  }
  return matches.sort((left, right) => Number(right.strong) - Number(left.strong) || right.hits - left.hits)
}

/**
 * Shortlist for one domain, capped and stack-aware.
 * @param match - a matchDomains() entry.
 * @param text - the user's words, used to pick a frontend family.
 * @returns at most MAX_NAMES names, in preference order.
 */
export function shortlist(match, text) {
  const lowered = typeof text === 'string' ? text.toLowerCase() : ''
  let names = match.domain.skills ?? []
  if (match.domain.stacks !== undefined) {
    const family = lowered.includes('react') || lowered.includes('jsx') || lowered.includes('tsx') ? 'react'
      : lowered.includes('vue') || lowered.includes('nuxt') ? 'vue'
        : 'generic'
    names = match.domain.stacks[family] ?? match.domain.stacks.generic
  }
  return names.slice(0, MAX_NAMES)
}

/**
 * One nudge line, or '' when there is nothing worth saying.
 * @param domain - the matched domain.
 * @param names - shortlist names that exist in the catalog.
 * @param loader - the tool this agent can call.
 * @returns the model-facing line.
 */
export function nudgeLine(domain, names, loader) {
  if (names.length === 0) return ''
  return '本轮涉及' + domain.label + ':用 ' + loader + ' 先看 ' + names.slice(0, MAX_NAMES).join('、') + ',再动手。'
}
