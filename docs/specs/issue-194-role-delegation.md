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
- **不复制** persona 文本:运行时通过 `ctx.agentPresets.readDocument(role)` 读注册表里的官方定义(deep-ptc `lib/index.mjs:129` 已有先例),本仓库零重复存储。
- 不做 UI 过滤/隐藏(实测不可行,见背景)。
- 不改 `DELEGATION_PRESET_WHITELIST` 与 `ROUTING` 表(issue-151 的双向契约不动)。
- 角色目录只排除**内置完整组合**(`standard`/`ptc`/`minimal`/`cordis`/`deep-ptc`),其余一律视为角色(含 5 个白名单 preset)。

## 关键实现决定

1. **人格注入走首条消息,不走 preset**:`0.2.2-rc.1` 的 `SubagentStartRequest` 没有 `persona` 入参;durable descriptor 虽带 `persona`,但那只在冷恢复时回灌(`manager.js:1233`),新派发不读它。随任务文本进入是版本无关、不依赖内部符号的做法。
2. **子 agent 必须不传 `agentPreset`**:这是保住 57 个工具的唯一条件(`dsh-subagent/lib/types/child-agent.js:140` 的 `applyChildComposition` 分支)。测试用「spec 里不存在 agentPreset 键」反向锁定。
3. **provider 解析**:优先 `spawn`;缺失时取第一个 `inheritsParentContext !== true` 的 provider;都没有则报错列出可用名。
4. **深度闸必须显式转发**:`subagents.resolveMaxDepth()` 的结果要填进 `request.maxDepth`。宿主的闸是拿该字段比较,**不传等于不限**(`child-agent.js:31-40`),而读配置的 `resolveMaxDepth()` 全仓只有官方 `subagent` 工具调用。不转发 → 宿主平面工具让子 agent 无界递归。
5. **YAML schema 对齐**:读回声明必须用**与写入相同的 schema**(`JSON_SCHEMA` + `!!js` 标签,见 `cordis-plugin-include`)。用 `DEFAULT_SCHEMA` 会把单行 `2026-11-12` 解析成 Date 对象,导致存在 persona 却报「declares no persona text」。

## 验收

1. `role_search("security")` 能命中线上角色(实测 14 条);无 query 返回全部 133 个角色(排除内置组合);`limit` 生效。**中文查询对线上名册零命中**(133 行 description 全为英文),这是已记录边界,工具的空答案会提示改用英文。
2. `delegate_role({role:'django-reviewer', prompt:'...'})` 启动的子 agent:spec 中 **无 `agentPreset`**;首条 prompt 同时含该角色 persona 原文与任务原文。角色 id 必须真实存在(初版举例的 `django-security` 不存在,线上是 `django-reviewer` / `django-build-resolver`)。
3. 未知角色 → 报错并提示用 `role_search`;角色无 persona → 报错;宿主无 `startActivation` → 报错说明宿主过旧。
4. 委派纪律文本新增一条 lane,zh/en **bullet 数一致**(既有契约测试守护)。
5. `pnpm test` + `pnpm verify` 全绿;`dsh-task-dispatcher` 升版 + CHANGELOG 条目。测试必须覆盖**真实名册**(读 `ecc-agent-presets/cordis.patch.yml`),不得只用自造 roster。

## Tickets

1. 角色目录 + `role_search`(红→绿)
2. `delegate_role`(红→绿)
3. 纪律文本 lane(zh/en 对称)
4. 文档 / 版本 / 依赖

## 变更(审查后,2026-11-12)

双轴 review 独立发现同一批问题,逐条核实后修改:

1. **深度闸:从「不传」改为「显式转发」**(轴1 §1 / 轴2 P1)。原写法基于错误假设——以为 `startActivation` 会补上宿主 maxDepth。实测 `child-agent.js:31-40` 是 `if (maxDepth !== undefined && childDepth > maxDepth) throw`,不传即不限;读配置的 `resolveMaxDepth()` 全仓只有官方 `subagent` 工具调用。已改并补 2 条测试,反向验证:不转发 → 3 条红。
2. **persona 解析 schema 对齐**(轴1 §3 / 轴2 P4)。实测:单行 `2026-11-12` 在 `DEFAULT_SCHEMA` 下变成 Date 对象 → 存在 persona 却报「declares no persona text」。已改为与写入相同的 schema,补 2 条经真实 loader 的测试。
3. **验收 1/2 的例子改为实测成立的值**(轴1 §2 / 轴2 P2)。原例 `role_search('安全')` 与 `django-security` 在线上名册都不成立。新增 `test/real-roster.test.mjs` 直接读真实 133 行,取代自造 roster——初版测试之所以绿,是因为它自造了一条中文 description。
4. **文档数字改为实测值**(轴1 §4 / 轴2 P3)。原写「注入 agentPreset → 5 条红」等未实测。现全部跑过:5 / 3 / 2 / 3 / 1,基线 0 红。
5. **补 `peerDependencies: @deepseek-ai/dsh-tools`**(轴1 §5)。0-intrusion rule B 要求运行时代码引用的 `@deepseek-ai/*` 必须声明;照 `dsh-credential-vault` 先例。
6. **兜底 `defineTool` 补必填校验**(轴2 P7)。初版只做参数 schema、不校验,无 `dsh-tools` 环境下漏 `prompt` 会起一个空任务子 agent。已照先例补 `validateArgs`,并在 `execute` 里显式拒空 prompt。
7. **合并两处重复的内置清单**(轴2 P6)。`roles.mjs` 导出的 `BUILTIN_PRESETS` 之前无人引用,`role-tools.mjs` 又手写一份;现统一 import。
8. **删掉死代码**(轴2 附带)。`activation.result.catch()` 按契约发布后不再 reject,已删。

**未采纳**:轴2 P5 建议「注册前校验当前 agent 的组合是否允许委派」。当前没有稳定的公开 API 判断「这个 agent 的组合里有没有 subagent 能力」,强行探测会引入内部符号依赖;改为在 README/CHANGELOG 如实写成已知副作用(标注未实测)。
