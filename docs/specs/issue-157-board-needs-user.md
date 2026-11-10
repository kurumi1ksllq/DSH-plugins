# #157 任务板「需要你出手」收敛为意图 + 合并两类

- 分级:`standard`
- 关联:#157;上游 #154(只保留两次交互)留下的面板语义尾巴
- 本阶段会动:`packages/dev-flow/{lib-git-status/task-board.js,client.js,README-git-status.md,package.json,CHANGELOG.md,test/{task-board,t4-df,client-board}.test.mjs}`、根 `CHANGELOG.md`、本 spec 与 `docs/specs/.flow/157.json`

## 1. 现状(可复核)

| 事实 | 证据 |
| --- | --- |
| 面板仍把 5 类都当"需要你出手" | `task-board.js:22` `NEEDS_USER_KINDS = ['intake-confirm','no-ci','ci-red-escalated','review-pending-decision','merge-gate']` |
| 其中 3 类自 #154 起已归 agent 自决 | `FLOW.md`「自决边界」:无 CI 自动补 workflow、CI 红自修≤2 轮后不合并、review 发现由 agent 裁决 |
| 文案已改、结构未改 | #154 只改了 `client.js` 措辞与 `README-git-status.md` 口径,条目仍在条带里 |
| 测试仍在断言旧契约 | `test/task-board.test.mjs`「each of the four dev-flow user inputs」; `test/t4-df.test.mjs` 断言 `review-pending-decision` 进 needsUser |
| 后果 | 用户按新流程忽略条带,面板持续喊话——正是 README 自己警告的「训练用户忽略条带」 |

## 2. 改动

`NEEDS_USER_KINDS` 收为 `['intake-confirm','merge-gate']`;`buildNeedsUser` 删掉 `no-ci`、`ci-red-escalated`、`review-pending-decision` 三个分支。CI 三态、CI 自修轮次、review 状态仍作为**卡片证据行**显示(`checks`/`ci`/`review` 字段未动)。

连带清理:`client.js` 三个 `need_*` 文案(zh/en)、`task-board.js` 的 `CI_MAX_ROUNDS`(已无消费者)。

## 3. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 红:`task-board`/`t4-df` 断言词表封闭为两项;无 CI、CI 红 2/2、review pending 都不进 needsUser,但卡片上仍可见 | 先跑见红(现状 5 类) |
| T2 | 绿:改 `NEEDS_USER_KINDS` 与 `buildNeedsUser`;删死常量与文案 | T1 全绿 |
| T3 | 文档:`README-git-status.md` 两处改口径 | 与实现一致 |
| T4 | 版本 0.6.1 → 0.7.0;两处 CHANGELOG;spec 与 `.flow` | `pnpm verify` 绿 |

## 4. 边界

- 不动 `.flow` 文件格式与 `STAGES` 枚举(面板列不变)。
- 不动 CI 判定、review 状态机、快照字段。
- 不改 `FLOW.md` 的流程规则(它已经只写两次交互)。

## 5. 风险

| 风险 | 缓解 |
| --- | --- |
| 用户再也收不到「CI 红两次」「review 出报告」的主动提示 | 这些状态仍在卡片证据行(CI 红 · CI 2/2、review pending);且 agent 会在对话/PR 里给结论 |
| `NEEDS_USER_KINDS` 是对外导出的枚举,可能有仓外消费者 | 仓内唯一消费者是本包;枚举收窄是 minor 版本变更(0.7.0),CHANGELOG 明写 |

## 6. 验收

- `packages/dev-flow` 全绿;`pnpm verify` 绿。
- 反向验证:把三类塞回 `buildNeedsUser` → 测试红。
- 面板「需要你出手」最多出现 `intake-confirm` / `merge-gate`。
