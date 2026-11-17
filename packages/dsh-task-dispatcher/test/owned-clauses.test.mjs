import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderDelegationText } from '../lib/delegation-text.mjs'

// ---------------------------------------------------------------------------
// #211: the plugin must carry its own prompts.
//
// The operator's constraint: 'all prompt injection must live inside the plugin,
// not in a global AGENTS.md, because a global file means the plugin stops
// working on any other machine.' Measured before this change: the global
// ~/.dsh/AGENTS.md carried a second copy of the delegation lanes AND the only
// copy of the retrieval discipline, the quality red lines and the efficiency
// rules. Two sources for one rule set drift -- the global copy still told the
// model to pick `agent_preset` two commits after this package documented the
// removal -- and nothing the operator installs on a new machine would restore
// the rules that only existed globally.
//
// Each assertion below names ONE clause that used to live only in the global
// file. Deleting that clause from lib/delegation-text.mjs turns the test red,
// which is the point: the plugin, not the operator's dotfiles, is the source.
// ---------------------------------------------------------------------------

/** Every clause the plugin is responsible for, with a phrase that proves it. */
const OWNED_CLAUSES = [
  // --- retrieval discipline (was global-only) ---
  ['检索:零命中不等于不存在', '零命中'],
  ['检索:出处须双源交叉', '双源'],
  ['检索:易失证据先落盘', '落盘'],
  // --- quality red lines (were global-only) ---
  ['质量:子任务自包含', '自包含'],
  ['质量:汇总核对冲突重复遗漏', '冲突、重复、遗漏'],
  ['质量:未验证必须标注', '未验证'],
  ['质量:委派失败要兜底', '兜底'],
  // --- efficiency (was global-only) ---
  ['效率:先读后写', '先读后写'],
  ['效率:独立调用并发发出', '并发'],
  // --- destructive-operation gate (already present, kept pinned) ---
  ['安全:破坏性操作先确认', 'rm -rf'],
  // These two lived only in a global AGENTS.md before #214; a machine that
  // installs the bundle without that file would lose them.
  ['安全:禁止 --no-verify / 跳过 hook', 'no-verify'],
  ['安全:dev-server 端口与 PID 落盘', 'dev-server'],
  // --- tool probing (issue-216: a child probed globalThis.tools, got undefined,
  // and reported 'no skill tool in this session') ---
  ['探测:不用 globalThis(精确到 .tools)', 'globalThis.tools'],
  ['探测:必须用作用域内 tools 实测', '作用域内'],
  // --- skill surface (issue-218: a lead misread skill-nudge lines as persona
  // leakage and wrote "don't call skill" into every delegation prompt) ---
  ['技能:加载技能不是探索宿主', '加载技能不是探索宿主'],
  ['技能:委派禁写连坐令', '连坐'],
  ['技能:nudge 到达须裁决', 'skill-nudge'],
]

test('the plugin carries every clause it depends on', () => {
  const text = renderDelegationText('zh')
  const missing = OWNED_CLAUSES.filter(([, phrase]) => !text.includes(phrase)).map(([name]) => name)
  assert.deepEqual(
    missing,
    [],
    'these clauses must be injected by the plugin itself, not left to a global AGENTS.md: '
      + missing.join('; '),
  )
})

test('the English rendering carries the same clauses', () => {
  // zh/en are same-structure (contract style of governor-copy). A clause that
  // exists in only one locale is half a rule set.
  const text = renderDelegationText('en')
  const englishClauses = [
    ['zero hits', /zero hits|no hits/i],
    ['cross-check', /cross-check|second source/i],
    ['self-contained', /self-contained/i],
    ['unverified', /unverified/i],
    ['fallback', /fall back|fallback/i],
    ['read before write', /read .*before .*writ/i],
    ['no --no-verify', /no-verify/i],
    ['dev-server port', /dev-server/i],
    ['probe via in-scope tools, not globalThis', /globalThis\.tools/i],
    ['in-scope positive instruction present', /in-scope/i],
    ['loading a skill is not host exploration', /not host exploration/i],
    ['no blanket skill ban in delegation prompts', /blanket/i],
    ['skill-nudge reminder demands a ruling', /skill-nudge/i],
  ]
  const missing = englishClauses.filter(([, pattern]) => !pattern.test(text)).map(([name]) => name)
  assert.deepEqual(missing, [], 'the en rendering is missing: ' + missing.join('; '))
})

test('the injected text is self-sufficient: it does not defer to an external file', () => {
  // A clause that says 'see ~/.dsh/AGENTS.md' is not owned by the plugin.
  for (const locale of ['zh', 'en']) {
    const text = renderDelegationText(locale)
    assert.doesNotMatch(text, /AGENTS\.md/, locale + ': the injected text must not point at an external rules file')
    assert.doesNotMatch(text, /~\/\.dsh/, locale + ': the injected text must not depend on a machine-local path')
  }
})
