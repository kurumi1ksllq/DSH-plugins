# #185-#188 委派纪律四条（合并处理）

- 分级：`standard`（1 个文本文件为主 + 测试 + 文档；四条共享同一段 `COPY`）

## 为什么合并成一个 PR

> **任务板**：四条共用 `docs/specs/.flow/185.json` 一块板（合并 PR，同一分支同一工作单元）。`186/187/188.json` 不单独建，避免面板出现四张同步推进的卡。

四条 issue 来自同一次会话复盘（`session-9dcf2a20`），且**全部落在 `packages/dsh-task-dispatcher/lib/delegation-text.mjs` 的同一段 `COPY` 里**。分开做会在同一处文本上反复冲突，也看不出四条之间的口径是否自洽。

数据核对：会话原始事件在 `~/.dsh/sessions/--root-DSH-plugins--/session-9dcf2a20-05bd-4ad6-9923-0f6440034140/session.v4.jsonl.zstd`（2107 行）。复核时把该文件解压后按事件类型统计（`tool/ptc-dispatch` 的 `name`/`arguments`、`step/start` 的 `turn`/`step`、`turn/start` 的时间戳），结果与 issue 复述有出入的已在各节标注。**取证脚本是临时的，未入库**——本句只保证上述路径与统计方法可重跑。

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

**不采纳**「在 deep-ptc preset 里启用 workflow」：上游禁它可能与其 PTC 中断语义冲突（`README.zh.md:206` 提到长 workflow 内部的等待不能被插话提前结束），且改 `preset.json` 会被 `scripts/check.mjs:179` 的 snapshot 同步断言拦下，需连带改 derive 与两道门。

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

## 变更（2026-11-12，双轴 review 后）

轴1 报 6 条，全部采纳。四处改变了实现：

### 1. 新增文案与仓库既有上限冲突（最严重）

原文案写「同参数最多 3 次，间隔从 10s 起翻倍」，但：

- `governor-copy.mjs:81` 的 discipline8 是「失败最多重试 **2** 次」——同一 prompt 里出现 2 和 3；
- `sleep-lint.mjs:4` 的 `MAX_PAUSE_SECONDS = 5`，前台 `>5s` 的等待会被守卫拒绝——照文案执行会拿到 `Deep PTC refuses a 10 s foreground pause`。

这正是本 PR 合并四条时要避免的「口径不自洽」。已改为「重试上限沿用 ⑧ 的 2 次，间隔不超过 5 秒」。

### 2. 测试断言不绑定 bullet，删条款仍绿

原断言是对整段文本的松散正则。实测：删掉 `todo_write` 的降级语后，`/没有|不可用/` 会命中**上一条 workflow bullet** 里的「没有该工具时」，测试仍绿。同理 inbox、`Promise.all`、去重句。

改为 `bulletWith(text, needle)` 先切出含该关键词的那一条 bullet，再在该条内匹配。四条变异现在全部变红（实测）。

### 3. 去重纪律无人守

spec 要求「含去重纪律」，但原 5 条测试没有任何一条断言它——而「同一份工作不要同时用两档」才是白跑 226 秒的直接原因。已在「两条结果通道」用例里补上 `dedupe` 断言。

### 4. 重复了 persona 已有的内容

`preset.json:10` 的 persona 已写「Never sleep, busy-poll」「`job_output`」「Batch independent inspections」「end the turn」。原 bullet 几乎逐句复述，而 spec §边界 自己写着「重复写会稀释」。

已压到只保留 persona 没有的信息：重试上限 + 间隔上限 + 「改用 `job_output`」。

### 5. 文档结构漂移

README 说「内含两节」但列表列了三条；`renderDelegationText` 实际只输出两个标题，等待纪律是 lanes 里的一条 bullet。已改 README 与 `index.js` 注释，写明「只有两个标题」。

### 6. 事实引用

spec 引 `README.zh.md:193` → 实际 `:206`；上游请求单标题「B/C/E 三项」→ 正文四节，第 4 节是扩展发现，已标注；`.flow` 只建 `185.json` 是**有意的**（四条共用一块板），已在 spec 写明。

### 7. zh/en 同构只守条数，不拦措辞漂移（第 7 条 review）

既有的「bullet 数相等」断言只守条数：把 zh 某条 bullet 里的 `Promise.all` 改成「串行」而条数不变，测试全绿（实测）。

已补一条**成对标记**断言：把每条规则的 zh/en 关键短语成对列出（`todo_write` / `workflow` / `wait_agent` / `inbox` / `job_output` / `Promise.all` / 「第 3 个」↔`third` / 「2 次」↔`cap at 2` / 「5 秒」↔`5 seconds`），任一侧缺失即红。实测：zh 单侧漂移 → 2 条测试红。

### 8. 每轮成本（实测）

注入文本是**每轮都付费**的上下文。实测 zh 段从 **759 字符 / 10 条 bullet** 增长到 **1221 字符 / 12 条 bullet**（+61%）；en 段 1853 → 2833（+53%）。

**更正一处先前的错误比较**：初版说「discipline0..9 约 1400+ 字符，本段同量级」——那是 en 的数字。实测 discipline0..9 的 **zh** 只有 514 字符，所以本段 zh 已是它的 **2.4 倍**。这不是「同量级」。

另一个事实：本部署 `index.js` 写死 `renderDelegationText('zh')`，en 段**不会被渲染**——en 的 +980 字符是纯维护成本。

取舍：四条 issue 的根因都是「文本没说到位」，而文本是本仓库唯一能改的载体。但 review 已削掉了与 persona 重复的部分（见下），**后续若还要加条款，应先压缩既有 bullet 而不是继续增长**。

### 与 persona 的重复已削

`preset.json:10` 的 persona 已有「Never sleep, busy-poll」「Batch independent inspections」「Do not duplicate running work」「Collect results through the channel」。初版的等待条与去重条几乎逐句复述。现改为只写 persona 没有的**工具级事实**与**具体上限**：`list_agents`/`wait_agent` 看不见已派出的 `subagent`、重试上限 2 次、间隔上限 5 秒。

## 验收（更新后）

| 项 | 结果 |
| --- | --- |
| dispatcher | 12/12 绿 |
| 仓库契约 | 94/94 绿 |
| 跨包白名单镜像 | 4/4 绿 |
| 删 `todo_write` 降级语 | 红 |
| 删去重句 | 红 |
| 删 inbox 句 | 红 |
| 只改 zh 不改 en | 同构断言红（删整条时） |
