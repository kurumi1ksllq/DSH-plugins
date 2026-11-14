# issue 210 — role_search 的两个中文同义词是死的,示例角色清一色 reviewer

grade: standard

## 问题(实测)

#207 把 `role_search` + `delegate_role` 提为**唯一**换角色通路,于是它点名的每个概念都必须真能命中。

实测 18 个 SYNONYM 键:

| 查询 | 命中 |
|---|---|
| `迁移` | **0** |
| `工程` | **0** |
| 其余 16 个 | 1–25 |

根因:`migration` / `engineering` 只出现在 description,而 #196 的设计是**映射词只匹配 role id**
(防 `架构`→architect 把 13 个 reviewer 全拉进来)。所以这两个键永远零命中,注入文本还点名了「迁移」。

另:8 个示例角色里 6 个 reviewer/architect、0 个实现类 —— 与「主动并积极地创建子 agent 干活」相反。
根 `README.md:23` 仍在教「按任务内容选 `agent_preset`」,与包内 README 矛盾。
测试名册只读 ECC bundle(133),而运行时是 138,导致合法 id `planner` 被判不存在。

## 目标

1. 18 个 SYNONYM 键全部至少命中 1 个真实角色。
2. 每个键不得命中超过名册 1/3(防止修成「匹配一切」)。
3. 注入文本点名的领域词必须真有角色。
4. 示例覆盖 实现 / 评审 / 规划 三类。
5. 根 README 与包内 README 口径一致。
6. 测试名册 = 运行时名册(133 + profile 5)。

## 边界

- 不改 133 行 preset、不改 DSH 运行时、不改 `selectRoles` 匹配算法(只改同义词**数据**)。
- 不新增依赖。

## 验收

| # | 判据 | 证据 |
|---|---|---|
| A1 | 每个 SYNONYM 键至少命中 1 个角色 | `test/synonyms-live.test.mjs` |
| A2 | 每个键命中数 ≤ 名册 1/3 | 同上 |
| A3 | 文本点名的领域词真有角色 | 同上 |
| A4 | 示例覆盖 build/review/plan | 同上 |
| A5 | 根 README 无 `agent_preset` | 同上 |
| A6 | 名册读 profile 的 `insert` 块 | 同上(否则 133 而非 138) |

## 实测结果

- 改前:`迁移`=0、`工程`=0;示例 6 reviewer/0 实现;根 README 含 `agent_preset`。
- 改后:`迁移`→`data-engineer`+`database`; `工程`→`platform-engineer`+`api-platform`(均命中且不过宽)。
  示例重排为 3 实现 + 3 评审 + 2 规划。
- `pnpm test`:**1523 条 0 红**(根 104 + 8 包 1419);`pnpm verify` exit 0。

## 反向验证

- 把 `迁移` 改回 `['migration']` → A1 红。
- 把 `工程` 改成 `['engineer']`(命中 22/138)→ A2 红。
- 示例换回全 reviewer → A4 红。
- 根 README 恢复 `agent_preset` → A5 红。
- 名册只读 bundle → A6 相关断言红(planner 被判不存在)。

## 变更

无。
