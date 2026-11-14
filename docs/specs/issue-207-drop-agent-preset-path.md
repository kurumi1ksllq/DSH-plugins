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

## 活体证据(合并前实测,2026-11-14)

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

- `pnpm test`:**104 / 104 通过**,exit 0(全仓 `node --test`,含两个改动包)。
- `pnpm verify`:bundles ok 8 checked;两条 `untagged version` 是**待打 tag 的提示**,非失败。
- `node packages/dsh-deep-ptc-mode/scripts/check.mjs`:exit 0(派生与官方快照一致,`peerPackages: 3`)。
- 反向验证:把白名单打点加回 `model.mjs` → `delegation-whitelist` 红;把 `agent_preset` 写回注入文本 →
  `role-routing` 两条红;把示例 id 换成名册外的 `planner` → `role-routing` 红(实测过,见开发过程)。

## 变更

无(实现中未发现需调整目标/边界的情形)。
