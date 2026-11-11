# #185-#188 委派纪律四条（合并处理）

- 分级：`standard`（1 个文本文件为主 + 测试 + 文档；四条共享同一段 `COPY`）

## 为什么合并成一个 PR

四条 issue 来自同一次会话复盘（`session-9dcf2a20`），且**全部落在 `packages/dsh-task-dispatcher/lib/delegation-text.mjs` 的同一段 `COPY` 里**。分开做会在同一处文本上反复冲突，也看不出四条之间的口径是否自洽。

数据核对：我用 `/tmp/sess9/{auth,verify,files4}.cjs` 重跑了该会话（`s.jsonl` 与真实 `session.v4.jsonl.zstd` 解压后 SHA256 一致，2107 行）。权威数字与 issue 复述有出入的已在各节标注。

## 四条 issue 的实测复核

| # | issue 说法 | 实测 | 判定 |
| --- | --- | --- | --- |
| 185 | 注入文本硬引用 `workflow`，但 deep-ptc 已禁用该工具 | `delegation-text.mjs:33/46` 确有硬引用；`preset.json:152-163` 两行 `disabled: true`；该会话 SDK 里 `workflow` **不存在** | ✅ 成立，且是死条款 |
| 186 | 20 文件任务全程单线程，首次委派迟到 24.7 分钟 / 148 次调用 | 24.7 分钟、148 次 dispatch、285 次总 dispatch、工具直方图**逐条一致**；`todo_write` 在其 SDK 里**可用却 0 次调用**；实际改 **25 个仓库文件**（23 个在首次委派前） | ✅ 成立，数字更严重 |
| 187 | subagent 在跑又 spawn_teammate 重复两轴 review | 03:12:22 两个 `subagent`(code-reviewer) → 03:16:20/21 两个 `spawn_teammate`(无 preset) → 03:20:07 `interrupt_agent` ×2，白跑 **226 秒** | ✅ 成立 |
| 188 | 等子代理期间 9 步空转 / 同一 CI 命令 15 次 / 零并发 | 等待窗口 **13 步 / 243 秒**（issue 说 9 步）；`gh pr checks 184` 共 15 次、**同参数完全重复 12 次**；含 ≥2 bash 的 root call **0 个**，另测 39 个多工具 root call 里仅 **1 个**用 `Promise.all` | ✅ 成立，数字修正 |

## 关键边界：哪些改得到，哪些改不到

**本仓库能改**：`packages/dsh-task-dispatcher/lib/delegation-text.mjs` + `README.md`。

**本仓库改不到**（已逐个 grep 确认，不在任何 git 仓库、locale 只有 `meta` 键、`Config` schema 无 description 覆盖字段）：

- `wait_agent` 的 noProgress 文案：`@deepseek-ai/dsh-experimental-tool-agent-team/lib/index.js:32`
- `spawn_teammate` 的 schema 与 description：同上 `:251-275`
- `subagent` 的 description：`@deepseek-ai/dsh-tool-subagent/lib/index.js:373`
- `spawn_teammate` 加 `agent_preset`（#187 的 C 项）：需改 tool schema + `spawnAdmitted` request + `startActivation` + `team/member` 事件版本，是运行时改动

所以本 PR 只能改注入文本，并写一份上游请求单。**不假装闭环。**

## 方案

### 1. `workflow` 条件化（#185）

分档行改为「有 `workflow` 时用它；没有时用 N 个 `subagent` 并行，等价」。

**不采纳**「在 deep-ptc preset 里启用 workflow」：上游禁它可能与其 PTC 中断语义冲突（`README.zh.md:193` 提到长 workflow 内部的等待不能被插话提前结束），且改 `preset.json` 会被 `scripts/check.mjs:179` 的 snapshot 同步断言拦下，需连带改 derive 与两道门。

### 2. 三问绑到 `todo_write`（#186）

「开工第一件事：用 `todo_write` 把三问答案写进首个任务列表」。

**必须带降级**：不是所有组合都有 `todo_write`。文本写成「有则用；没有则写进第一条回复」。否则又是一个指向不存在工具的死条款——正是 #185 的病。

停手线加可数信号：「同类文件改到第 3 个、或连续 >8 次工具调用」，保留原阈值作兜底（「第 3 个」在某些场景更宽松，两个信号取「或」）。

### 3. 去重 + 投递语义（#187）

追加一条：「同一份工作不要同时用 `subagent` 和 teammate；已派出的 `subagent` 不出现在 `list_agents`/`wait_agent` 里，其结果以 inbox 通知自动到达，不要据此判定『子代理已死』并另起一套」。

### 4. 等待与轮询纪律（#188）

追加一条：等待期不空转、轮询外部状态优先后台 job、同参数最多 3 次、独立只读调用用 `Promise.all` 并行。

**注意与 #185 的措辞相邻且口径一致**：185 说「没有 workflow 就用 N 个 subagent 并行」，188 说「不要用 wait_agent 轮询 subagent」——两句必须连贯，否则模型会得到「派出去 → 不知道怎么办」的空档。

### 5. 上游请求单

新增 `docs/specs/issue-187-upstream-request.md`，把改不到的四处逐条写成可提交给上游的 patch 说明（文件:行号 + 建议文案 + 理由）。

## 验收

- 注入文本 zh/en 双份同构（`bundle.test.mjs` 已有的 bullet 数相等断言继续守着）
- 新断言：文本含 `todo_write`（带降级语）、含「第 3 个」、含 `workflow` + 降级路径、含去重纪律、含 `job_output`/并发纪律
- 反向验证：删掉任一条 → 对应用例红；只改 zh 不改 en → bullet 数相等断言红

## 边界

- 不改 `governor-copy.mjs` 的 discipline0..9（有 sha256 tripwire，且语义是「自启长任务」而非「等待外部结果」）
- 不改 persona（`preset.json:10` 已有「Never sleep, busy-poll」与「Batch independent inspections」，重复写会稀释）
- 不改运行时工具描述（改不到，走上游请求单）
- 人工验收口径（首委派调用数、等待期步数、CI 重复次数）**不进 CI**，CI 里没有真实会话
