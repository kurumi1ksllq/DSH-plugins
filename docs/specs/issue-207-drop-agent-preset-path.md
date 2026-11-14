# issue 207 — 删掉 `agent_preset` 这条空壳通路,注入文本只教 `delegate_role`

grade: standard

## 用户诉求(原话)

> 我需要插件可以提供让主agent在可行的时候 在需要的时候 会主动并积极的创建队友agent和子agent。并且子agent还会用上不同的预制。
> 但是我经历了多个会话。让你改进了很多个版本。但是目前依然没有一个好用的版本。甚至是功能都没有生效。

## 问题(实测,非推断)

本会话对三条通道各真派一个子 agent,让子 agent 自己列出工具与人格:

| 通道 | 工具数 | `read/write/edit/grep/glob` | 角色人格 |
|---|---|---|---|
| `subagent({})`(继承父组合) | 56 | 有 | 无 |
| `subagent({agent_preset:'code-reviewer'})` | 28 | **全无** | **无** |
| `delegate_role({role:'code-reviewer'})` | 齐全 | 有 | **有**(回引「你被委派为 code-reviewer」) |

根因不是「没做委派」,而是**注入文本与插件自身结论相反**:

- `dsh-task-dispatcher/lib/delegation-text.mjs` 的 ROUTING 表原文写着「可委派的子 agent preset(按子任务内容选择 `agent_preset`)」,并列 5 个 id。
- 同仓库 #194 的 README 与 spec 早已写明:preset 是**完整插件组合**,不是人格标签;133 个 ECC preset 每个只声明一行 `dsh-persona`,挂上去就是空壳。
- `dsh-deep-ptc-mode` 的 `DELEGATION_PRESET_WHITELIST` 又主动把 `agent_preset` 参数暴露给模型,等于给坏路铺了红毯。

模型照着注入文本走,拿到一个没有文件工具的子 agent → 干不了活 → 用户看到「功能没生效」。多轮会话反复调整纪律措辞都无法修复,因为**方向是反的**。

## 目标

1. 注入文本不再出现 `agent_preset`,只教 `role_search` + `delegate_role`。
2. 从 `subagent` 的 schema 里彻底移除 `agent_preset`(删白名单),让坏路**不可达**,而不只是「不推荐」。
3. 机制层验收进 `pnpm test`;行为层给出可复制的活体探针,结果写进本 spec。

## 边界

- 不改 133 行 preset 定义,不改 DSH 运行时与官方包,不改 UI。
- 不新增依赖。
- 示例角色 id 必须取自 `ecc-agent-presets` 真实名册(测试读该 bundle 校验)。
- 仓库外的 `~/.dsh/AGENTS.md` 有一行 `委派 agent_preset=planner` 同样在教坏路;不在本仓库范围内,只在结论里点名。

## 裁剪

无裁剪。两个包都有既有测试,四件套全跑。

## 验收

| # | 判据 | 证据 |
|---|---|---|
| A1 | 注入文本(zh/en)不含 `agent_preset` | `dsh-task-dispatcher/test/role-routing.test.mjs` |
| A2 | 注入文本点名 `role_search` 与 `delegate_role` | 同上 |
| A3 | 文本里的示例角色 id 全部存在于 `ecc-agent-presets/cordis.patch.yml`;zh/en 示例一致 | 同上(读真实 bundle) |
| A4 | 示例数 < 名册总数,且文本说明「不带 query 列出全部」 | 同上 |
| A5 | `model.mjs` 不再出现 `allowedAgentPresets` / 白名单常量 | `dsh-deep-ptc-mode/test/delegation-whitelist.test.mjs` |
| A6 | derive 输出的 spawn 侧 `tool-subagent` 行与官方快照逐字相等;报告不再声称白名单打点 | 同上 + `upstream`/`execution` 测试 |
| A7 | 活体:新派一个 `delegate_role` 子 agent 能拿到完整工具 + 人格 | 见下「活体证据」 |
| A8 | **新根会话**里 `tool_describe('subagent')` 看不到 `agent_preset` | **未验证**(需用户开新会话;见下「生效边界」) |

## 活体证据(合并前实测,2026-11-14)
> **覆盖面声明(轴1 review 发现)**:下面这组只证明 `delegate_role` 这条路能给子 agent 完整工具 + 人格,
> 那是**改动前就成立**的行为(问题表第三行)。它**不**构成本次改动的证据。本次改动的活体判据是 A8
> (新根会话里 `agent_preset` 消失),受组合固化限制在本会话无法验证,已如实标为未验证。

探针方式:实现完成后新派一个 `delegate_role({role:'typescript-reviewer'})` 子 agent,
让它自己报工具集、人格、以及用 `read` 真读一次仓库文件。子 agent `a66dfe23` 回复:

| 项 | 结果 |
|---|---|
| 人格 | 有,原文「You are a senior TypeScript engineer ensuring high standards of type-safe, idiomatic TypeScript and JavaScript.」 |
| `read` / `write` / `edit` / `grep` / `glob` | 5/5 全部在 |
| 真读文件 | 读到 `dsh-task-dispatcher/package.json`,version = `0.5.0`(与本分支实况一致) |
| 再往下派 | YES(`subagent` / `subagent_fork` / `delegate_role` / `role_search` 都在) |

对照(改前,同一会话):`subagent({agent_preset:'code-reviewer'})` 的子 agent 自报 28 个工具、
`read/write/edit/grep/glob` **一个都没有**、人格 NONE。

## 四件套

- `pnpm test`:exit 0。**全仓 1518 条,0 红**(根 `node --test test/*.test.mjs` 104 条;8 个包各 227/199/249/108/81/29/4/517,合计 1414)。
  复现:`pnpm test > /tmp/t.log 2>&1; echo $?` 然后 `grep -E "ℹ (tests|fail)" /tmp/t.log`。
  (旧写法只写「104/104」,那是**根套件**的数,不是全仓 —— 轴2 P7 指出后已更正。)
- `pnpm verify`:bundles ok 8 checked;两条 `untagged version` 是**待打 tag 的提示**,非失败。
- `node packages/dsh-deep-ptc-mode/scripts/check.mjs`:exit 0(派生与官方快照一致,`peerPackages: 3`)。
## 双轴 review 裁决

两轴各 6 条,逐条核实后处置(采纳=已改并补反向验证):

| 来源 | 发现 | 裁决 |
|---|---|---|
| 轴1-1 | 只在源码层删常量,没有断言「组合后任何行都不带 allowedAgentPresets」 | **采纳**。新增全树断言(walkRows 遍历派生结果)。反向验证:把该键注入 tool-subagent 行 → 3 条红 |
| 轴1-2 | A7 活体证据不覆盖本次改动 | **采纳**。加覆盖面声明;新增 A8(新根会话 schema 无该参数)并标「未验证」 |
| 轴1-3 | routingPresets() 无人引用且注释与事实相反 | **采纳**,已在 3a73267 删除 |
| 轴1-4 | deep-ptc README 的 1.15.0 条目插在 1.12.0 之前 | **采纳**,两个 README 都移到 1.13.x 之后 |
| 轴1-5 | dispatcher README 的「81 条」与 diff 增量对不上 | **核实为真**:实测 node --test 报 tests 81;74 是改动前数字,新增 4 条后为 81。保留实测值 |
| 轴1-6 | bundle.test 用 /role_search/ 替代 /preset/i 后守护变弱;测试文件名与内容不符 | **采纳**。改为断言角色表**形状**;反向验证:删掉表格 → 2 条红;文件改名 delegation-no-preset-surface.test.mjs |
| 轴2-1 | 注入文本把「继承完整工具组合」「本部署已移除」写成无条件事实 | **采纳**。改成条件式:继承**你当前的**组合(你没有的它也没有),并去掉部署级断言 |
| 轴2-2 | diff 与工作树不一致(routingPresets 已在后续提交删除) | **属实但无害**:评审拿到的是 9b045ed 时点的 788 行 diff,之后 3a73267 才删。最终树已确认零命中 |
| 轴2-3 | 「示例不是白名单」只靠 8 < 133 恒真 | **采纳**。加上界 3..12,反向验证:扩到 13 条 → 红 |
| 轴2-4 | 用源码文本扫描断言 allowedAgentPresets 不存在,违反「只测公开行为」 | **采纳**。改为断言模块**导出面**没有该常量;行为面已由 derive 逐字相等 + 全树断言覆盖 |
| 轴2-5 | package.json 的 description 仍写 declarative subagent routing table | **采纳**,改为 role table + 说明子 agent 继承父组合并带人格 |
| 轴2-6 | .flow 的 stage/review 状态落后 | **不成立**:已提交状态为 stage=review / review.state=running / ci=green(评审看到的是旧快照) |
- 反向验证:把白名单打点加回 `model.mjs` → `delegation-whitelist` 红;把 `agent_preset` 写回注入文本 →
  `role-routing` 两条红;把示例 id 换成名册外的 `planner` → `role-routing` 红(实测过,见开发过程)。

## 生效边界(实测)

改动只对**新根会话**生效:子 agent 经 `composeFrom` 绑定父组合的精确 revision,已存在的会话仍持有旧 schema。
实测证据:本 issue 的会话在改动前后,`tool_describe('subagent')` 的 schema **仍**含 `agent_preset`
(enum 仍是那 5 个 id),注入文本也仍是旧 ROUTING 表 —— 与该机制一致,不是改动没落地。
验证方式:开一个新会话,再 `tool_describe('subagent')`,应看不到 `agent_preset`。

## 变更

无(实现中未发现需调整目标/边界的情形)。
