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
      '- 开工第一件事:把三问的答案落到某个载体上——本会话有 `todo_write` 就用它写进首个任务列表(能否拆 / 值不值得第二视角 / 能不能并行);没有该工具时,写进第一条回复。没写这三条不算开工。',
      '- 分档:单文件改动或单条命令 → 单线程直接做;1 个聚焦子任务且只需结果 → `subagent`(独立上下文)或 `subagent_fork`(需继承本会话上下文);≥3 个同类独立单元 → 扇出:有 `workflow` 工具时用它的 pipeline/parallel 一次铺开,没有该工具时(如 deep-ptc 组合)改用 N 个自包含的 `subagent` 并行发出,效果等价;需要多轮交接、共享任务板 → 组队(`spawn_teammate` + 任务板);结论重要且不可回退 → 对抗验证(独立视角复核)。',
      '- 有疑问时往上一档走:宁可多一次委派,不要返工两次。同类文件改到第 3 个、或连续 >8 个工具调用仍无可验收中间物 → 停手重新拆解:剩下的能不能并行派出去?',
      '- 派出去就别重复派:同一份工作不要同时用 `subagent` 和 teammate,先定档再发。已经派出的 `subagent` 不会出现在 `list_agents`/`wait_agent` 里——它们的结果以 inbox 通知自动到达,不要据此判定「子代理已死」并另起一套。',
      '- 等待与轮询(只补 persona 没写的上限):轮询外部状态时,同一命令同样参数的重试上限沿用 ⑧ 的 2 次,间隔不超过 5 秒——更长的前台等待会被暂停守卫拒绝,请改用 `job_output` 读后台 job。独立的只读调用用 `Promise.all` 并行发出。',
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
      '- First action: land the three questions on a carrier. If this session has `todo_write`, put the answers in the first task list (can it split / does it deserve a second opinion / can it run concurrently); otherwise write them in your first reply. Without that, work has not started.',
      '- Lanes: single-file change or one command -> do it inline; one focused subtask where only the result matters -> `subagent` (fresh context) or `subagent_fork` (inherits this conversation); >=3 similar independent units -> fan out: use the `workflow` tool (pipeline/parallel) when it is available, and without it (e.g. the deep-ptc composition) send N self-contained `subagent` calls in parallel instead - equivalent; multi-round handoffs or a shared task board -> form a team (`spawn_teammate` + task board); irreversible conclusions -> adversarial verification with an independent reviewer.',
      '- When in doubt, go one lane up: prefer one extra delegation over reworking twice. At the third same-kind file, or after >8 tool calls with no acceptable intermediate artifact, stop and re-decompose: can the rest be delegated in parallel?',
      '- Do not delegate the same work twice: never run one job through both `subagent` and a teammate; pick the lane first. A `subagent` you already launched does not appear in `list_agents`/`wait_agent` - its result arrives as an inbox notification. Do not read that absence as "the subagent died" and start a second set.',
      '- Waiting and polling (only the caps persona lacks): keep the same-argument retry cap at 2 (rule 8) and the interval at 5 seconds or less - a longer foreground wait is refused by the pause guard, so read a background job with `job_output` instead. Issue independent read-only calls with `Promise.all`.',
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
