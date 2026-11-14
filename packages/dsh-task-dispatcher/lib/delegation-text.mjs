// Delegation discipline and role-table copy, zh/en same-structure dictionaries.
//
// #207: this file used to carry a routing table telling the model to pick an
// `agent_preset` for the child. That path is measured to produce a shell: on
// this deployment subagent({agent_preset:'code-reviewer'}) returned a child with
// 28 tools and NO read/write/edit/glob/grep, while an inherited child had 56 and
// delegate_role's child had both the full toolset and the persona. The table
// therefore advertised the one route that cannot do the work, and the model
// followed it -- the "delegation does nothing" report.
//
// The surviving route is role_search + delegate_role (lib/role-tools.mjs): the
// child inherits the parent composition and receives the role's persona as its
// opening message, so "a different preset per child" is real without paying the
// shell-child price.
//
// The examples below are ids the shipped ecc-agent-presets bundle really
// declares; test/role-routing.test.mjs reads that bundle and fails if one drifts.

/** Roles named as examples. Ids verified against ecc-agent-presets/cordis.patch.yml. */
const ROLE_EXAMPLES = [
  { id: 'python-reviewer', zh: 'Python 专项审查', en: 'Python-specific review' },
  { id: 'a11y-architect', zh: '无障碍审查与 WCAG 2.2 落地', en: 'accessibility review and WCAG 2.2 implementation' },
  { id: 'django-reviewer', zh: 'Django 专项审查', en: 'Django-specific review' },
  { id: 'typescript-reviewer', zh: 'TypeScript 类型与工程审查', en: 'TypeScript typing and engineering review' },
  { id: 'database-reviewer', zh: '数据库 schema 与查询审查', en: 'database schema and query review' },
  { id: 'e2e-runner', zh: '端到端测试的编写与运行', en: 'writing and running end-to-end tests' },
  { id: 'refactor-cleaner', zh: '死代码清理与重构', en: 'dead-code removal and refactoring' },
  { id: 'cloud-security-architect', zh: '云安全与凭证/注入风险', en: 'cloud security, credential and injection risk' },
]

function roleLines(locale) {
  return ROLE_EXAMPLES.map((row) => {
    const text = locale === 'zh' ? row.zh : row.en
    return '- `' + row.id + '` → ' + text
  })
}

const COPY = {
  zh: {
    heading: '## 自动委派编排(对本会话所有成员生效,包括队友)',
    lanes: [
      '- 开工第一件事:把三问的答案落到某个载体上——本会话有 `todo_write` 就用它写进首个任务列表(能否拆 / 值不值得第二视角 / 能不能并行);没有该工具时,写进第一条回复。没写这三条不算开工。',
      '- 分档(先数,再决定,不许凭感觉):单文件改动或单条命令 → 单线程直接做;1 个聚焦子任务且只需结果 → `subagent`(独立上下文)或 `subagent_fork`(需继承本会话上下文)。**命中以下任一可数条件就必须拆**:要改 ≥3 个文件 → 拆;要动 ≥2 个包或模块 → 拆;要跑 ≥2 个互不依赖的验证(两套测试、两个仓库的检查)→ 并行。拆法:有 `workflow` 工具时用它的 pipeline/parallel 一次铺开,没有该工具时(如 deep-ptc 组合)改用 N 个自包含的 `subagent` 并行发出,效果等价;需要多轮交接、共享任务板 → 组队(`spawn_teammate` + 任务板);结论重要且不可回退 → 对抗验证(独立视角复核)。',
      '- 有疑问时往上一档走:宁可多一次委派,不要返工两次。同类文件改到第 3 个、或连续 >8 个工具调用仍无可验收中间物 → 停手重新拆解:剩下的能不能并行派出去?',
      '- **堵掉逃生口**:「我先读一遍看看」「先摸清情况再动手」不构成跳过拆解的理由——**广度探索**(摸清仓库结构、找候选实现、调研外部资料)可以分出去,让子 agent 各查一块并回报要点;但**你即将修改或审查的文件必须亲自己读全**——只拿子 agent 的摘要去改/审,就没有依据核对冲突、重复与遗漏。**例外只在未命中上面任何一条可数条件时成立**:任务只有一个可验收产出、且全部改动落在一个文件内,此时才可单线程;命中任一条就一律按可数条件执行,不得援引例外。',
      '- 工具覆盖面(persona 未说的事实):`list_agents`/`wait_agent` **看不见已派出的 `subagent`**,它们的结果以 inbox 通知自动到达——不要把这种「查不到」当成「子代理已死」。选档时先定:同一份工作只走一条通道(`subagent` 或 teammate)。',
      '- **角色化委派是给子 agent 换专才视角的唯一通路**:子任务需要某个领域的专才(安全审查、无障碍、某框架惯例、数据库、迁移)时,先 `role_search({query})` 找 id(中英文都可:安全→security、无障碍→a11y),再用 `delegate_role({role, prompt, description})` 派出。子 agent 继承你**完整的工具组合**(读写文件、搜索、shell 都在)并收到该角色的完整职责说明,也能继续往下派。**不要指望用 `subagent` 换角色**——那条路派出来的是空壳(无文件工具、无人格),本部署已把该参数移除。',
      '- **扇出不改变授权**:子 agent 跑在同一个文件系统上,破坏性操作(`rm -rf`、删除数据、数据库 drop/truncate、force-push、重启宿主进程)**仍然**要先向用户说明并获得确认,由你(委派方)负责把住这道关,不能因为「已经派出去了」就默认子 agent 有权执行。',
      '- 等待与轮询(只补 persona 没写的上限):轮询外部状态时,同一命令同样参数的重试上限沿用 ⑧ 的 2 次,间隔不超过 5 秒——更长的前台等待会被暂停守卫拒绝。有 `job_output` 时改用后台 job 读;没有该工具时按上面的重试上限执行。独立的只读调用一次发出(有 `Promise.all` 就用它,没有就同一轮并行发起)。',
    ],
    routingHeading: '可委派的角色(用 `role_search` 找 id,再用 `delegate_role` 派出;这里是举例,不是白名单):',
    routingNote: [
      '- `role_search` **不带 query** 会列出全部角色(已排除 standard/ptc/minimal/cordis/deep-ptc 这几个内置完整组合)。不确定 id 就先查,别猜:猜错会在首次委派时报错。',
      '- 你作为队友(teammate)同样适用本节:接到 ≥3 个独立单元或需要独立视角的任务时,应当向下委派,不要单线程硬扛;在委派深度上限内(由 DSH subagent 深度闸与 maxDepth 设置执行)的孙代理委派是被授权的。',
    ],
  },
  en: {
    heading: '## Auto delegation protocol (applies to every member of this session, teammates included)',
    lanes: [
      '- First action: land the three questions on a carrier. If this session has `todo_write`, put the answers in the first task list (can it split / does it deserve a second opinion / can it run concurrently); otherwise write them in your first reply. Without that, work has not started.',
      '- Lanes (count first, never by feel): single-file change or one command -> do it inline; one focused subtask where only the result matters -> `subagent` (fresh context) or `subagent_fork` (inherits this conversation). **Any one of these countable conditions forces a split**: 3 or more files to change -> split; 2 or more packages or modules to touch -> split; 2 or more independent verifications to run (two test suites, checks in two repositories) -> run them in parallel. How to split: use the `workflow` tool (pipeline/parallel) when it is available, and without it (e.g. the deep-ptc composition) send N self-contained `subagent` calls in parallel instead - equivalent; multi-round handoffs or a shared task board -> form a team (`spawn_teammate` + task board); irreversible conclusions -> adversarial verification with an independent reviewer.',
      '- When in doubt, go one lane up: prefer one extra delegation over reworking twice. At the third same-kind file, or after >8 tool calls with no acceptable intermediate artifact, stop and re-decompose: can the rest be delegated in parallel?',
      '- **Close the escape hatch**: "let me read the code first" or "explore the repo before deciding" is not a reason to skip splitting -- **breadth-first exploration** (mapping the repo, finding candidate implementations, surveying external material) may be handed out, with each subagent reporting its slice. But **the files you are about to change or review you must read yourself in full**: deciding from a child summary leaves you no basis to check for conflicts, duplicates and gaps. **The exception applies only when none of the countable conditions above is hit**: one verifiable deliverable, all edits inside one file. Hit any threshold and the countable rule governs; do not cite the exception.',
      '- Tool coverage (what persona does not say): `list_agents`/`wait_agent` cannot see a `subagent` you already launched - its result arrives as an inbox notification. Do not read that absence as "the subagent died". Pick the lane first: one job goes through one channel (`subagent` or a teammate), not both.',
      '- **Role delegation is the only way to give a child a specialist lens**: when a subtask needs a domain specialist (security review, accessibility, a framework convention, databases, migrations), find the id with `role_search({query})` (Chinese and English both work) and start it with `delegate_role({role, prompt, description})`. The child inherits your **complete toolset** (files, search, shell) and receives the role full briefing, and can delegate further. **Do not expect `subagent` to switch roles for you** -- that path yields a shell (no file tools, no persona) and this deployment removed the argument.',
      '- **Fan-out does not widen authority**: children run on the same filesystem, so a destructive operation (`rm -rf`, deleting data, dropping or truncating a database, force-push, restarting the host process) **still** needs the user to be told and to confirm. You, the delegator, hold that gate; "it is already delegated" is never consent.',
      '- Waiting and polling (only the caps persona lacks): keep the same-argument retry cap at 2 (rule 8) and the interval at 5 seconds or less - a longer foreground wait is refused by the pause guard. With `job_output`, read a background job instead; without it, stay within the retry cap above. Issue independent read-only calls together (with `Promise.all` when available, otherwise in the same turn).',
    ],
    routingHeading: 'Delegable roles (find the id with `role_search`, start it with `delegate_role`; examples, not a whitelist):',
    routingNote: [
      '- `role_search` **without a query** lists every role (the built-in full compositions standard/ptc/minimal/cordis/deep-ptc are excluded). When unsure of an id, ask instead of guessing: a wrong id errors on first delegation.',
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
    ...roleLines(locale),
    '',
    ...copy.routingNote,
  ]
  return lines.join('\n')
}
