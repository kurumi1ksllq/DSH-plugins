// Delegation discipline and routing-table copy, zh/en same-structure dictionaries.
//
// The routing table names subagent presets that must exist in the live
// profile; the `allowedAgentPresets` whitelist in dsh-deep-ptc-mode's
// preset.json mirrors the same ids (spec issue-151 §验收 C). When
// ecc-agent-presets moves a preset out of the profile, update ROUTING
// entries and the whitelist together.

const ROUTING = [
  { id: 'planner', zh: '需求拆解、实现计划、任务分档', en: 'requirement breakdown, implementation planning, task sizing' },
  { id: 'architect', zh: '架构决策、技术选型、跨模块设计', en: 'architecture decisions, technology selection, cross-module design' },
  { id: 'code-reviewer', zh: '代码审查、惯例与测试质量', en: 'code review, conventions and test quality' },
  { id: 'security-reviewer', zh: '安全审查、凭证与注入风险', en: 'security review, credential and injection risks' },
  { id: 'build-error-resolver', zh: '构建错误、类型错误的快速修复', en: 'fast fixes for build and type errors' },
]

export function routingPresets() {
  return ROUTING.map((row) => row.id)
}

function routingLines(locale) {
  return ROUTING.map((row) => {
    const text = locale === 'zh' ? row.zh : row.en
    return `- \`${row.id}\` → ${text}`
  })
}

const COPY = {
  zh: {
    heading: '## 自动委派编排(对本会话所有成员生效,包括队友)',
    lanes: [
      '- 开工前三问:①能拆成 ≥2 个互不依赖、可独立验收的部分吗?②结论值得被第二个独立视角挑战吗?③有没有能同时跑的耗时操作(装依赖/跑测试/拉数据/全量扫描)?',
      '- 分档:单文件改动或单条命令 → 单线程直接做;1 个聚焦子任务且只需结果 → `subagent`(独立上下文)或 `subagent_fork`(需继承本会话上下文);≥3 个同类独立单元 → `workflow` 扇出;需要多轮交接、共享任务板 → 组队(`spawn_teammate` + 任务板);结论重要且不可回退 → 对抗验证(独立视角复核)。',
      '- 有疑问时往上一档走:宁可多一次委派,不要返工两次。连续 >8 个工具调用仍无可验收中间物 → 停手重新拆解。',
    ],
    routingHeading: '可委派的子 agent preset(按子任务内容选择 `agent_preset`):',
    routingNote: [
      '- 不确定选哪个时不传 `agent_preset`,子 agent 继承当前组合;preset id 拼写错误会在首次委派时报错,以本表为准。',
      '- 你作为队友(teammate)同样适用本节:接到 ≥3 个独立单元或需要独立视角的任务时,应当向下委派,不要单线程硬扛;在委派深度上限内(由 DSH subagent 深度闸与 maxDepth 设置执行)的孙代理委派是被授权的。',
    ],
  },
  en: {
    heading: '## Auto delegation protocol (applies to every member of this session, teammates included)',
    lanes: [
      '- Three questions before starting: (1) Can this split into >=2 independent, separately acceptable pieces? (2) Does the conclusion deserve an independent second opinion? (3) Are there concurrent long operations (installs, tests, data pulls, full scans)?',
      '- Lanes: single-file change or one command -> do it inline; one focused subtask where only the result matters -> `subagent` (fresh context) or `subagent_fork` (inherits this conversation); >=3 similar independent units -> `workflow` fan-out; multi-round handoffs or a shared task board -> form a team (`spawn_teammate` + task board); irreversible conclusions -> adversarial verification with an independent reviewer.',
      '- When in doubt, go one lane up: prefer one extra delegation over reworking twice. After >8 tool calls with no acceptable intermediate artifact, stop and re-decompose.',
    ],
    routingHeading: 'Delegable subagent presets (pick `agent_preset` by subtask content):',
    routingNote: [
      '- When unsure which to pick, omit `agent_preset`: the child joins the current composition. Misspelled ids error on first delegation; treat this table as the source of truth.',
      '- As a teammate you are equally covered by this section: when you receive >=3 independent units or a task needing an independent perspective, delegate downward instead of grinding inline; grandchild delegations within the configured depth cap (enforced by the DSH subagent depth gate and the maxDepth setting) are authorized.',
    ],
  },
}

export function renderDelegationText(locale) {
  const copy = COPY[locale] ?? COPY.zh
  const lines = [
    copy.heading,
    '',
    ...copy.lanes,
    '',
    copy.routingHeading,
    ...routingLines(locale),
    '',
    ...copy.routingNote,
  ]
  return lines.join('\n')
}
