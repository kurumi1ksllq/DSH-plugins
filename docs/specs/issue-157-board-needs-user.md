# #157 任务板「需要你出手」收敛为意图 + 合并两类

- 分级:`standard`
- 关联:#157;上游 #154(只保留两次交互)留下的面板语义尾巴
- 本阶段会动:`packages/dev-flow/{lib-git-status/task-board.js,client.js,README-git-status.md,package.json,CHANGELOG.md,test/{task-board,t4-df,client-board}.test.mjs}`、根 `CHANGELOG.md`、本 spec 与 `docs/specs/.flow/157.json`

## 1. 现状(可复核)

| 事实 | 证据 |
| --- | --- |
| 面板仍把 5 类都当"需要你出手" | `task-board.js:22` `NEEDS_USER_KINDS = ['intake-confirm','no-ci','ci-red-escalated','review-pending-decision','merge-gate']` |
| 其中 3 类自 #154 起已归 agent 自决 | `FLOW.md`「自决边界」:无 CI 自动补 workflow、CI 红自修≤2 轮后不合并、review 发现由 agent 裁决 |
| 文案已改、结构未改 | 就这条条带而言,#154 只改了 `client.js` 措辞与 `README-git-status.md` 口径,条目仍在条带里 |
| 测试仍在断言旧契约 | `test/task-board.test.mjs`「each of the four dev-flow user inputs」; `test/t4-df.test.mjs` 断言 `review-pending-decision` 进 needsUser |
| 后果 | 用户按新流程忽略条带,面板持续喊话。判据是本 issue 引入的:一条把所有事都列上的横幅会被训练成背景噪声(见 `task-board.js` 的 `NEEDS_USER_KINDS` 注释),不是仓库既有 README 的措辞 |

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

## 7. 双轴 review 裁决(2026-11-10,PR #166)

两轴共报 16 条,去重后 12 条,全部采纳(3 条为同一根因的不同表述)。

| # | 发现 | 裁决 | 处理 |
| --- | --- | --- | --- |
| 1 | review 状态被从条带删掉后**完全没有面板出口**:卡片证据行从不渲染 card.review,README/spec 的「仍可见」承诺为假 | 采纳 | `client.js` 证据行加 `review_running` / `review_pending-decision` 两段文案(zh/en);新增渲染层断言 |
| 2 | 「仍可见」只在快照字段层断言,渲染层零覆盖 | 采纳 | `client-board` 新增用例:text 输出必须含「无 CI」「CI 2/2」「review 待裁决」且不含「需要你:」 |
| 3 | `NEEDS_USER_KINDS` 没有消费者,词表形同注释 | 采纳 | `buildNeedsUser` 返回前按词表过滤,常量有了约束力 |
| 4 | `t4-df` 断言 `NEEDS_USER_KINDS` 数组内容,违反 `docs/specs/test-hygiene-29.md` 的既定决定 | 采纳 | 删除该用例;改为行为用例:红 CI 2/2 + review pending 的板 `needsUser` 必须为空,同时卡片字段仍携带 |
| 5 | 「review running 不触发」成为恒真僵尸测试 | 采纳 | 并入上一条的最坏情形用例,删除原用例 |
| 6 | CI 红 2/2 用例只断言 `card.action === null`(等价于重复断言不在 needsUser) | 采纳 | 补 `card.checks === 'red'` 与 `card.ci` 深比较 |
| 7 | `.flow/157.json` stage 落后(ci 而实况 review),卡片会打「状态过期」 | 采纳 | 改 `stage: "review"` |
| 8 | `.flow` 的 `updatedAt` 把 UTC 写成 `+08:00`,差 8 小时 | 采纳 | 改用 `toISOString()`(Z)。根因是手写 `replace('Z','+08:00')`;161.json 的历史值不追改,记录在此 |
| 9 | spec 误归因:「正是 README 自己警告的『训练用户忽略条带』」——仓库里查不到这句话 | 采纳 | 改为「本 issue 引入的判据」,指向 `NEEDS_USER_KINDS` 注释 |
| 10 | spec 绝对化:「#154 只改了 client.js 与 README」 | 采纳 | 限定为「就这条条带而言」 |
| 11 | `client-board` 的 host 用例 fixture 自相矛盾(红 CI + review done + merge-gate),且丢了证据行断言 | 采纳 | 改为 green CI + run 1/2;补 `assert 'CI 绿'` |
| 12 | 两处 CHANGELOG 与测试文件缺空行 | 采纳 | 补齐 |

### 与 issue 建议的差异(记录)

issue #157 的建议是「把三类降级为 info」;本 spec 选择**整段删除**,理由是 info 条目仍会被读成待办。为不让状态彻底消失,补了第 1 条的渲染出口——两条路线的目标一致(不喊用户、但别丢信息),取后者。
