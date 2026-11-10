// Curated domain table for the skill nudge.
//
// Deliberately NOT a search index. A lexical sweep over 270 descriptions hits
// 123 entries for one ordinary sentence, and the English phrasing of the same
// request ranks prompt-optimizer first. Noise teaches the model to ignore the
// nudge, so each domain carries a hand-picked shortlist instead; the runtime
// drops any name the catalog does not actually have.

/** Domains worth interrupting for, with zh/en signals and a curated shortlist. */
export const DOMAINS = [
  {
    id: 'ui',
    label: 'UI/界面细节',
    keywords: ['页面', '界面', '样式', '配色', '间距', '字体', '视觉', '交互', '美化', '组件',
      'ui', 'ux', 'css', 'layout', 'spacing', 'typography', 'color', 'theme', 'screen', 'design', 'polish'],
    skills: ['make-interfaces-feel-better', 'design-system', 'frontend-design-direction', 'accessibility'],
  },
  {
    id: 'frontend',
    label: '前端组件',
    keywords: ['react', 'vue', 'nuxt', 'vite', 'jsx', 'tsx', 'hook'],
    skills: ['react-patterns', 'vue-patterns', 'frontend-patterns', 'react-performance'],
  },
  {
    id: 'api',
    label: '接口设计',
    keywords: ['接口', '端点', 'api', 'rest', 'graphql', 'endpoint'],
    skills: ['api-design', 'backend-patterns'],
  },
  {
    id: 'database',
    label: '数据库/迁移',
    keywords: ['数据库', '迁移', '索引', '事务', 'sql', 'migration', 'schema', 'postgres', 'mysql'],
    skills: ['database-migrations', 'postgres-patterns', 'mysql-patterns'],
  },
  {
    id: 'testing',
    label: '测试',
    keywords: ['测试', '覆盖率', '回归', '用例', 'test', 'coverage', 'e2e', 'fixture'],
    skills: ['tdd-workflow', 'test-coverage'],
  },
  {
    id: 'security',
    label: '安全/鉴权',
    keywords: ['安全', '鉴权', '认证', '授权', '权限', '注入', '密钥', 'auth', 'security', 'csrf', 'xss'],
    skills: ['security-review', 'agent-security-hardening'],
  },
  {
    id: 'ops',
    label: '构建/部署',
    keywords: ['部署', '镜像', '容器', '流水线', 'docker', 'kubernetes', 'k8s', 'ci', 'deploy'],
    skills: ['deployment-patterns', 'docker-patterns'],
  },
]

const ASCII = /^[a-z0-9]+$/

/** Whether one keyword occurs in the text; ASCII keywords respect word edges. */
function occurs(keyword, text) {
  if (!ASCII.test(keyword)) return text.includes(keyword)
  const pattern = new RegExp('(^|[^a-z0-9])' + keyword + '([^a-z0-9]|$)', 'u')
  return pattern.test(text)
}

/**
 * Domains whose signal is strong enough to interrupt for.
 * Two distinct keywords are required: one is too easy to hit by accident.
 * @param text - the user's own words for this turn.
 * @returns matching domains, strongest first.
 */
export function matchDomains(text) {
  if (typeof text !== 'string' || text.trim() === '') return []
  const lowered = text.toLowerCase()
  const matches = []
  for (const domain of DOMAINS) {
    const hits = domain.keywords.filter((keyword) => occurs(keyword.toLowerCase(), lowered))
    if (hits.length >= 2) matches.push({ domain, hits })
  }
  return matches.sort((left, right) => right.hits.length - left.hits.length)
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
  return '本轮涉及' + domain.label + ':用 ' + loader + ' 先看 ' + names.join('、') + ',再动手。'
}
