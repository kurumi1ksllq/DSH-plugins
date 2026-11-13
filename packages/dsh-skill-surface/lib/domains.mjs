// Curated domain table for the skill nudge.
//
// Deliberately NOT a search index. A lexical sweep over 270 descriptions hits
// 123 entries for one ordinary sentence, and the English phrasing of the same
// request ranks prompt-optimizer first. Noise teaches the model to ignore the
// nudge, so each domain carries a hand-picked shortlist instead; the runtime
// drops any name the catalog does not actually have.

/** Prefix every nudge line starts with; the echo guard reads it from here. */
export const NUDGE_PREFIX = '本轮涉及'

/** Suffix closing every nudge line. */
export const NUDGE_SUFFIX = ',再动手。'

/** Whether a text already carries a rendered nudge line. */
export function looksLikeNudge(text) {
  return typeof text === 'string' && text.includes(NUDGE_PREFIX) && text.includes(NUDGE_SUFFIX)
}

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
    // Bare '注入' is a keyword, not a strong signal: in this repository the word
    // far more often means a NON-security kind of injection ("skills: a,b 点名注入",
    // "ctx.inject", "prompt 注入"). Measured on 49 historical delegations that
    // contain it, only 2 were about an attack surface (issue-201). The attack
    // PHRASES below stay strong so they still work on their own — with AND
    // without the space, because Chinese writes 'SQL注入' more often than 'SQL 注入'.
    strong: ['鉴权', '密钥', 'sql 注入', 'sql注入', '命令注入', '注入攻击', '注入漏洞', 'xss 注入', 'xss注入'],
    keywords: ['安全', '认证', '授权', '权限', 'auth', 'security', 'csrf', 'xss', '注入'],
    // Each entry mutes only the words it disambiguates; the rest of the sentence
    // keeps counting, so a genuine attack next to ctx.inject is still caught.
    exclude: [
      { phrase: 'ctx.inject', mutes: ['注入'] },
      { phrase: 'prompt 注入', mutes: ['注入'] },
      { phrase: 'prompt注入', mutes: ['注入'] },
      { phrase: '提示注入', mutes: ['注入'] },
      { phrase: '提示词注入', mutes: ['注入'] },
      { phrase: '点名注入', mutes: ['注入'] },
      { phrase: '依赖注入', mutes: ['注入'] },
      { phrase: '注入到', mutes: ['注入'] },
    ],
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

/**
 * Words this sentence is NOT really about.
 *
 * `exclude` names phrases whose presence makes one ambiguous keyword mean
 * something else: 'skills: a,b 点名注入' is a delegation hint, not an attack.
 * Only the word that the phrase disambiguates is discounted — everything else in
 * the sentence still counts, so '修复提示注入漏洞,顺便加固鉴权' keeps 鉴权.
 * @param domain - one DOMAINS entry.
 * @param sentence - a lowercased sentence.
 * @returns the keywords to ignore for this sentence.
 */
function mutedWords(domain, sentence) {
  const muted = new Set()
  for (const entry of domain.exclude ?? []) {
    const phrase = typeof entry === 'string' ? entry : entry.phrase
    if (!occurs(phrase.toLowerCase(), sentence)) continue
    const mutes = typeof entry === 'string' ? [] : entry.mutes ?? []
    for (const word of mutes) muted.add(word.toLowerCase())
  }
  return muted
}

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
  const sentences = lowered.split(/[。!?；\n]/u).filter((part) => part.trim() !== '')
  const matches = []
  for (const domain of DOMAINS) {
    // Score per sentence: two hints scattered across a long paste are not a
    // request. The best sentence decides.
    let best = { hits: 0, strong: 0 }
    for (const sentence of sentences) {
      // Ambiguity is resolved WORD by WORD, never by dropping the sentence: a
      // sentence can legitimately mention ctx.inject AND a real attack surface,
      // and discarding it silently lost every security signal in that sentence
      // (review of #202). Only the ambiguous word itself is discounted.
      const muted = mutedWords(domain, sentence)
      const strong = (domain.strong ?? []).filter((word) => !muted.has(word.toLowerCase()) && occurs(word.toLowerCase(), sentence)).length
      const weak = domain.keywords.filter((word) => !muted.has(word.toLowerCase()) && occurs(word.toLowerCase(), sentence)).length
      const hits = strong + weak
      if (strong > best.strong || (strong === best.strong && hits > best.hits)) best = { hits, strong }
    }
    if (best.strong === 0 && best.hits < 2) continue
    matches.push({ domain, hits: best.hits, strong: best.strong > 0 })
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
  return NUDGE_PREFIX + domain.label + ':用 ' + loader + ' 先看 ' + names.slice(0, MAX_NAMES).join('、') + NUDGE_SUFFIX
}
