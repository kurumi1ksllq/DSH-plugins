# dsh-task-dispatcher

向会话所有成员(主 agent 与每个 teammate)注入**一个** runtime-context 段(`dsh:auto-delegation-discipline`),并注册两个**按角色委派**的工具。段内只有**两个标题**:

1. **委派纪律**(heading):开工三问(绑到 `todo_write`,无该工具时写进首条回复) + **可数分档**(要改 ≥3 个文件 / 要动 ≥2 个包 / 要跑 ≥2 个独立验证 → 必须拆;有 `workflow` 用它、没有则用 N 个 `subagent` 并行 / 组队 / 对抗验证) + **反逃生口条款**(「先读一遍看看」不构成跳过拆解的理由) + 角色化委派 lane + 停手线 + 去重与投递语义 + 等待与轮询上限,含队友向下委派的显式授权。
2. **声明式路由表**(routingHeading):列出可委派的子 agent preset(id → 职责),模型按子任务内容选择 `agent_preset` 参数。

## 角色化委派(#194)

路由表那条路有个实测缺陷:preset 是**一个 agent 的完整插件组合**,不是人格标签。在 DSH `0.2.2-rc.1` 上实测——

| | 继承型子 agent | `agent_preset: planner` |
| --- | --- | --- |
| 工具总数 | **57** | **27** |
| `read/write/edit/glob/grep` | 5/5 | **0/5** |
| `subagent` / `subagent_fork` | 有 | **无** |

`dsh-web-app` 在宿主平面把 `tool-fs`/`tool-fs-search`/`tool-skill`/`tool-goal`/`tool-subagent` 等全部 `disabled: true`,改由每个 preset 自带;而 `ecc-agent-presets` 的 133 个 preset 每个只声明一行 `@deepseek-ai/dsh-persona`(实测 133/133)。于是「委派给 preset X」拿到的是一个只有 bash 的空壳,干不了活,也不能再往下派。

两个工具补上这条路:

| 工具 | 作用 |
| --- | --- |
| `role_search({query?, limit?})` | 在已注册的 preset 里按关键词找角色,返回 id + 一句话职责。无 query 返回全部;排除内置完整组合(`standard`/`ptc`/`minimal`/`cordis`/`deep-ptc`)。 |
| `delegate_role({role, prompt, description?, cwd?})` | 派出子 agent。**不传 `agentPreset`** → 宿主 `composeFrom` 让子 agent 继承父组合(保住全部工具),角色的 persona 原文作为子 agent 开场消息注入。 |

实现要点:

- **persona 不复制**:运行时用 `ctx.agentPresets.readDocument(role)` 读注册表里的官方定义(deep-ptc `lib/index.mjs:129` 已有先例),本仓库零重复存储。读回时用**与写入相同的 schema**(`JSON_SCHEMA` + `!!js` 标签)——用 `DEFAULT_SCHEMA` 会把单行 `2026-11-12` 解析成 Date,导致存在 persona 却报「declares no persona text」。
- **人格走首条消息**:`0.2.2-rc.1` 的 `SubagentStartRequest` 已不含 `persona` 字段(descriptor 只留 label/provider/model),所以随任务文本进入是版本无关的做法。
- **provider 选择**:优先 `spawn`;缺失时取第一个不继承父上下文的 provider;都没有则报错列出可用名。
- **深度**:显式转发宿主的深度闸。宿主的闸是拿 `request.maxDepth` 做比较,**不传等于不限**(`child-agent.js:31-40`),而读配置的 `resolveMaxDepth()` 只有官方 `subagent` 工具调用——不显式转发,这两个宿主平面工具会让子 agent 无界递归。
- 两个工具都注册在**宿主平面**,所以主 agent、teammate、被派出的子 agent 都能用。**已知副作用**:`dsh-tools` 的 `view()` 把 global 层工具继承给所有 scope,因此一个在组合层面禁用了 `subagent` 的子 agent 仍看得见 `delegate_role`(源码推断,未在活会话实测)。

## 配套

- 路由表里的 preset id 必须真实存在于 profile,并与 `dsh-deep-ptc-mode/lib/model.mjs` 的 `DELEGATION_PRESET_WHITELIST`(derive 期打点,`preset.json` 保持官方原样)双向镜像——契约测试双向守护,改动需两处同步。
- 注入走 `systemPrompt.context`(与 deep-ptc governor 同一通道);恒定文本利于 KV cache。
- locale 固定 zh(操作者工作语言);`lib/delegation-text.mjs` 的 en 字典为预留。

> 运行时工具描述(`spawn_teammate` / `wait_agent` / `subagent`)不在本仓库,改不到的部分记在 `docs/specs/issue-187-upstream-request.md`。

teammate 经 `composeFrom` 继承父组合,因此文本对主 agent 与 teammate 同时生效;深度上限由 DSH `dsh-subagent` 的深度闸与 `maxDepth` 设置执行,注入文本只引用机制、不固定具体数值。

## 测试

```bash
pnpm test   # 或包内 node --test test/*.test.mjs
```

63 条测试全绿。每条新断言都做过反向验证(基线 0 红,统计口径统一为 `node --test` 的 `fail` 计数):注入 `agentPreset` → 5;删掉「工具齐全」承诺 → 3;删掉 zh 角色 lane → 2;不转发 `maxDepth` → 3;persona loader 换回 `DEFAULT_SCHEMA` → 1;删掉 zh 可数阈值 → 1;删掉 zh 逃生口 bullet → 3;单独删「读也要分出去」→ 1;单独删「唯一例外」→ 1;把「必须拆」弱化成「可以考虑拆」→ 1;**极性反转**(「→ 拆」改「→ 不拆」)→ 1;纯措辞改名(语义不变)→ 0(不误报)。

`test/real-roster.test.mjs` 直接读 `ecc-agent-presets` 的 133 行真实名册,而不是自造 roster——初版用自造的中文 description 让 `role_search('安全')` 变绿,而线上 description 全是英文、该查询实际零命中。现在测的是现实:英文关键词命中、中文查询零命中(已记录边界,工具的空答案会提示改用英文)。
