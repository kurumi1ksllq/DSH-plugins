# Issue #194:按角色委派子 agent(role_search + delegate_role)

> 三问(开工载体):① 可拆 = 是(角色目录 / 委派工具 / 纪律文本 / 文档 四个独立单元);② 值得第二视角 = 是(涉及子 agent 创建与人格注入,错了会静默失效);③ 可并行 = 文本与工具互不依赖。
>
> 分级:**standard**(跨 6 个文件、新增对外工具接口、改 package.json 依赖与版本)。

## 背景(源码级核实,2026-11-12)

用户诉求:让 `ecc-agent-presets` 的 133 个角色真正成为**子 agent**,由主 agent 按需把任务拆给它们;不是变成 133 个主 agent 模式。

实测证据(本机 DSH `0.2.2-rc.1`):

| 探测 | 继承型子 agent | `agent_preset: planner` |
| --- | --- | --- |
| 工具总数 | **57** | **27** |
| `read/write/edit/glob/grep` | 5/5 | **0/5** |
| `subagent`/`subagent_fork` | 有 | **无** |
| `todo_write`/`get_goal`/`skill` | 有 | 无 |

根因:preset 是「一个 agent 的**完整插件组合**」。`dsh-web-app` 在宿主平面把 `tool-fs`/`tool-fs-search`/`tool-skill`/`tool-goal`/`tool-subagent` 等全部 `disabled: true`,改由每个 preset 自带;而 133 个 ECC preset 的 `config.plugins` **只有 `@deepseek-ai/dsh-persona` 一行**(实测 133/133)。挂 preset 即整体替换组合 → 子 agent 变成只有 bash 的空壳。

第二根因:preset 注册表**没有 hidden/分组字段**,`list()` 无条件全量返回,4 个 UI 面直读 → 「注册但对下拉隐藏」不可行。用户已明确接受下拉显示这些 preset,故本 issue 不动 UI。

## 目标

在不改 preset、不改下拉的前提下,新增一条**按角色委派**通路:

1. `role_search({query?, limit?})`:在已注册的角色 preset 里按关键词检索,返回 id + 名称 + 一句话职责。
2. `delegate_role({role, prompt, description?, cwd?})`:派子 agent——**不传 `agent_preset`**(因此 `composeFrom` 继承父组合,保住全部工具),把该角色的 persona 原文注入子 agent 首条任务消息。

## 边界

- **不修改** `ecc-agent-presets` 的 133 行、不修改任何 preset 定义、不修改 DSH 运行时/官方包。
- **不复制** persona 文本:运行时通过 `ctx.agentPresets.readDocument(role)` 读注册表里的官方定义(deep-ptc `lib/index.mjs:126` 已有先例),本仓库零重复存储。
- 不做 UI 过滤/隐藏(实测不可行,见背景)。
- 不改 `DELEGATION_PRESET_WHITELIST` 与 `ROUTING` 表(issue-151 的双向契约不动)。
- 角色目录只排除**内置完整组合**(`standard`/`ptc`/`minimal`/`cordis`/`deep-ptc`),其余一律视为角色(含 5 个白名单 preset)。

## 关键实现决定

1. **人格注入走首条消息,不走 preset**:`0.2.2-rc.1` 的 `SubagentStartRequest` 已不含 `persona` 字段(descriptor 只留 label/provider/model,`dsh-subagent/lib/types/types.d.ts:127`),成员人格只能随任务文本进入。这是版本无关且不依赖内部符号的做法。
2. **子 agent 必须不传 `agentPreset`**:这是保住 57 个工具的唯一条件(`dsh-subagent/lib/types/child-agent.js:374` 的 `applyChildComposition` 分支)。测试用「spec 里不存在 agentPreset 键」反向锁定。
3. **provider 解析**:优先 `spawn`;缺失时取第一个 `inheritsParentContext !== true` 的 provider;都没有则报错列出可用名。不硬编码到会崩。
4. **深度**:不传 `maxDepth`,让宿主 `subagents` 配置的全局深度闸生效(`resolveMaxDepth(undefined)`)。
5. **YAML 容错**:`readDocument` 返回的 YAML 可能含 `!!js` 标签,解析时扩展一个宽容的 `!!js` 类型;解析失败给出可操作错误而非静默。

## 验收

1. `role_search("安全") ` 能命中 `security-reviewer` 等角色;无 query 返回全部角色(排除内置组合);`limit` 生效。
2. `delegate_role({role:'django-security', prompt:'...'})` 启动的子 agent:spec 中 **无 `agentPreset`**;首条 prompt 同时含该角色 persona 原文与任务原文。
3. 未知角色 → 报错并提示用 `role_search`;角色无 persona → 报错;宿主无 `startActivation` → 报错说明宿主过旧。
4. 委派纪律文本新增一条 lane,zh/en **bullet 数一致**(既有契约测试守护)。
5. `pnpm test` + `pnpm verify` 全绿;`dsh-task-dispatcher` 升版 + CHANGELOG 条目。

## Tickets

1. 角色目录 + `role_search`(红→绿)
2. `delegate_role`(红→绿)
3. 纪律文本 lane(zh/en 对称)
4. 文档 / 版本 / 依赖

## 变更

(实现中的调整记录在此)

