/**
 * Contract linter for the dev-flow SKILL.md.
 *
 * The skill is a prose document, so the strongest TDD hold on it is a
 * structural lint: frontmatter with a description that carries the trigger
 * words, the required sections present exactly once, and the phrases the
 * issue review explicitly banned (e.g. 双保险) absent. `lintSkill` returns
 * every violation, each with a `fix` hint, so an edit that breaks the
 * contract fails with a readable reason instead of silently degrading the
 * skill's routing or gates.
 */

/** Phrases that must not appear anywhere in the skill (review round 2). */
const FORBIDDEN_PHRASES = ['双保险']

/**
 * Sections that must exist as `## <heading>` (or deeper) exactly once.
 * Each maps to a one-line fix hint.
 */
export const LINT_RULES = [
  { id: 'frontmatter', type: 'meta' },
  { id: 'triggers', type: 'meta' },
  { id: 'scope', type: 'required-section', heading: '适用范围', fix: '加 "## 适用范围" 章节：任何导致文件内容变化的请求（含"只改一行"）必须进流程' },
  { id: 'stop-points', type: 'required-section', heading: '停点', fix: '加 "## 停点" 章节：停点1 意图+路径 / 停点2 方案确认 / 停点3 review+merge' },
  { id: 'hard-rules', type: 'required-section', heading: '硬规则', fix: '加 "## 硬规则" 章节：trivial 硬标准、裁剪声明、禁改 main、禁测私有函数' },
  { id: 'precheck', type: 'required-section', heading: '前置自检', fix: '加 "## 前置自检" 章节：gh --version / gh auth status / git remote -v 与降级指引' },
  { id: 'ci-three-states', type: 'required-section', heading: 'CI 三态', fix: '加 "## CI 三态" 章节：无 CI / 绿 / 红（自修≤2轮）' },
  { id: 'merge-gate', type: 'required-section', heading: 'merge 闸', fix: '加 "## merge 闸" 章节：具体 merge 口令，"嗯/好/继续"不算' },
  { id: 'tdd', type: 'required-section', heading: 'TDD', fix: '加 "## TDD" 章节：红-确认红对原因-绿-最小实现循环' },
  { id: 'flow-state', type: 'required-section', heading: '任务状态文件', fix: '加 "## 任务状态文件" 章节：每过一个节点写 docs/specs/.flow/<issue>.json，让任务板能显示 TDD/CI/review 的真实进度' },
]

/** Words that must appear in the description for routing to fire. */
export const REQUIRED_TRIGGERS = ['dev-flow', 'issue', 'PR', 'merge']

/**
 * Lint a SKILL.md document.
 * @param {string} text full file content.
 * @returns {{ok: boolean, violations: Array<{rule: string, message: string, fix: string}>}}
 */
export function lintSkill(text) {
  const violations = []
  if (typeof text !== 'string') {
    return { ok: false, violations: [{ rule: 'frontmatter', message: 'skill 内容必须是字符串', fix: 'SKILL.md 应以 UTF-8 文本读取' }] }
  }

  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (fm === null) {
    violations.push({ rule: 'frontmatter', message: '缺少 YAML frontmatter', fix: '文件必须以 --- 包裹的 frontmatter 开头，含 name 与 description' })
  } else {
    const frontmatter = fm[1]
    if (!/^name:\s*dev-flow\s*$/m.test(frontmatter)) {
      violations.push({ rule: 'frontmatter', message: 'frontmatter 缺少 name: dev-flow', fix: 'name 字段必须精确为 dev-flow' })
    }
    const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1] ?? ''
    const missing = REQUIRED_TRIGGERS.filter((word) => !description.includes(word))
    if (missing.length > 0) {
      violations.push({ rule: 'triggers', message: `description 缺少触发词: ${missing.join(', ')}`, fix: `description 需包含 ${REQUIRED_TRIGGERS.join('、')}，保证路由命中` })
    }
  }

  // Required sections: exactly one heading each, at any level ≥ 2.
  for (const rule of LINT_RULES) {
    if (rule.type !== 'required-section') continue
    // CI 三态 and merge 闸 live as #### subsections of 停点3; accept any
    // heading level ≥2 but count a heading plus its subsection form once.
    const re = new RegExp(`^#{2,4} ${rule.heading}`, 'm')
    const count = (text.match(re) ?? []).length
    if (count === 0) {
      violations.push({ rule: rule.id, message: `缺少章节「${rule.heading}」`, fix: rule.fix })
    } else if (count > 1) {
      violations.push({ rule: rule.id, message: `章节「${rule.heading}」出现 ${count} 次，应只出现一次`, fix: `合并重复的「${rule.heading}」章节` })
    }
  }

  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) {
      violations.push({ rule: 'forbidden-phrase', message: `出现被禁用的措辞「${phrase}」`, fix: `merge 闸的定位是"降低误判"，不是"${phrase}"；删改该措辞` })
    }
  }

  return { ok: violations.length === 0, violations }
}
