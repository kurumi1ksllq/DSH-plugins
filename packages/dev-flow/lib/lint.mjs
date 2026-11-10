/**
 * Contract linters for the two documents that shape the flow.
 *
 * `lintFlowDoc` guards the packaged procedure (`FLOW.md`): the sections must be
 * present exactly once, and the phrases that hand technical judgement back to
 * the user must stay out.
 *
 * `lintContract` guards the always-on text injected into the system prompt:
 * whatever else gets cut for length, these markers must survive, because they
 * are the only thing standing between "the agent decides" and "the user is
 * asked to referee a diff".
 *
 * Both return every violation with a `fix` hint, so a careless edit fails with
 * a reason instead of silently degrading the flow.
 */

/** Phrases that must not appear in FLOW.md. */
const FORBIDDEN_PHRASES = [
  ['用户点头', '决策归 agent;不要写成要用户点头才执行'],
  ['必须用户明示', '分级由 agent 判断并留证,不要求用户明示'],
  ['双保险', 'merge 闸的定位是降低误判,不是双保险'],
]

/**
 * Sections FLOW.md must carry exactly once (`## heading` or deeper).
 * Each maps to a one-line fix hint.
 */
export const LINT_RULES = [
  { id: 'scope', type: 'required-section', heading: '适用范围', fix: '加 "## 适用范围":任何导致仓库文件变化的请求都进流程,只读问答不进' },
  { id: 'touches', type: 'required-section', heading: '两次交互', fix: '加 "## 两次交互":意图确认 + 合并确认,其余自动' },
  { id: 'decisions', type: 'required-section', heading: '自决边界', fix: '加 "## 自决边界":分级/裁剪/CI/review/spec 变更都由 agent 决定并留证' },
  { id: 'precheck', type: 'required-section', heading: '前置自检', fix: '加 "## 前置自检":gh / git remote 检查与降级指引' },
  { id: 'tdd', type: 'required-section', heading: 'TDD', fix: '加 "## TDD":红-确认红对原因-绿-最小实现' },
  { id: 'flow-state', type: 'required-section', heading: '任务状态文件', fix: '加 "## 任务状态文件":每过一个节点写 docs/specs/.flow/<issue>.json' },
  { id: 'review', type: 'required-section', heading: '双轴 review', fix: '加 "## 双轴 review":固定模板 + agent 自行裁决发现' },
  { id: 'merge-gate', type: 'required-section', heading: 'merge 闸', fix: '加 "## merge 闸":具体 merge 口令,卡片点选「合并」等同授权' },
  { id: 'hard-rules', type: 'required-section', heading: '硬规则', fix: '加 "## 硬规则":禁改 main、禁测私有函数、节点写状态文件' },
]

/** Markers the injected contract must keep (see lib/contract.mjs). */
export const CONTRACT_REQUIRED = [
  ['两次', '契约必须写明只与用户交互两次'],
  ['意图', '必须保留第一次交互:复述意图'],
  ['合并', '必须保留第二次交互:是否合并'],
  ['自决', '必须写明技术判断归 agent'],
  ['分级', '必须写明分级由 agent 决定'],
  ['CI', '必须写明 CI 的处理方式'],
  ['review', '必须写明 review 的裁决归 agent'],
  ['禁止直接改 main', '必须保留 main 保护'],
  ['.flow/', '必须保留任务板状态文件路径'],
  ['FLOW.md', '必须指认规程全文的位置'],
  ['禁测私有函数', '必须保留「只测公开行为」这条'],
  ['破坏性操作', '必须保留危险操作先说明再执行的约束'],
]

/** The contract rides every turn, so it gets a budget in characters, not lines. */
export const CONTRACT_MAX_CHARS = 1600

/**
 * Lint the packaged procedure.
 * @param {unknown} text FLOW.md content.
 * @returns {{ok: boolean, violations: Array<{rule: string, message: string, fix: string}>}}
 */
export function lintFlowDoc(text) {
  const violations = []
  if (typeof text !== 'string') {
    return { ok: false, violations: [{ rule: 'document', message: '规程内容必须是字符串', fix: 'FLOW.md 应以 UTF-8 文本读取' }] }
  }

  for (const rule of LINT_RULES) {
    const re = new RegExp(`^#{2,4} ${rule.heading}`, 'gm')
    const count = (text.match(re) ?? []).length
    if (count === 0) violations.push({ rule: rule.id, message: `缺少章节「${rule.heading}」`, fix: rule.fix })
    else if (count > 1) violations.push({ rule: rule.id, message: `章节「${rule.heading}」出现 ${count} 次,应只出现一次`, fix: `合并重复的「${rule.heading}」章节` })
  }

  for (const [phrase, fix] of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) violations.push({ rule: 'forbidden-phrase', message: `出现被禁用的措辞「${phrase}」`, fix })
  }

  return { ok: violations.length === 0, violations }
}

/**
 * Lint the always-on contract text.
 * @param {unknown} text rendered contract.
 * @returns {{ok: boolean, violations: Array<{rule: string, message: string, fix: string}>}}
 */
export function lintContract(text) {
  const violations = []
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, violations: [{ rule: 'contract', message: '契约文本为空', fix: 'renderFlowContract 必须返回非空文本' }] }
  }
  for (const [marker, fix] of CONTRACT_REQUIRED) {
    if (!text.includes(marker)) violations.push({ rule: 'contract-marker', message: `契约缺少「${marker}」`, fix })
  }
  // Length is checked in characters, not lines: padding every line with a long
  // paragraph keeps the line count while multiplying what every turn pays.
  if (text.length > CONTRACT_MAX_CHARS) {
    violations.push({ rule: 'contract-length', message: `契约 ${text.length} 字符,超过 ${CONTRACT_MAX_CHARS} 上限`, fix: '把细节移回 FLOW.md,只留会改变行为的句子' })
  }
  // The injected text carries more weight than FLOW.md (it is read every turn),
  // so the phrases that hand judgement back to the user are banned here too.
  for (const [phrase, fix] of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) violations.push({ rule: 'forbidden-phrase', message: `契约出现被禁用的措辞「${phrase}」`, fix })
  }
  return { ok: violations.length === 0, violations }
}
