# spec: 把违反「禁测私有函数」的测试改成黑盒行为测试

> 停点2 产物。用户 2026-11-03 确认：①`flowStatePath` 取消导出，`stageOf` 保留导出但测试改走黑盒；②`NEEDS_USER_KINDS` 保留导出（client.js 降级路径在用），但测试改为断言行为。

## 1. 背景

`packages/dev-flow-skill/SKILL.md` 的硬规则写得很清楚：

> **禁测私有函数**：不 import 内部私有符号、不断言调用次数与内部调用顺序；只测公开行为与输出。

PR #27 新增的部分测试违反了这条规则（双轴 review 轴2 问题 6 发现）。当时的功能缺陷已修，
测试规范问题另开 #29。本 spec 处理 #29。

**重要前提**：这些是测试质量问题，不是产品缺陷。功能行为本身在 PR #27 已修正并有覆盖。
所以本次改动的验收标准是「**改了测试后行为覆盖不下降**」，而不是「发现新 bug」。

## 2. 目标

四处具体修改：

### 2.1 `flowStatePath` —— 取消导出，测行为

**现状**：`test/flow-state.test.mjs:51` 断言
`flowStatePath('/tmp/repo', 26) === join('/tmp/repo','docs','specs','.flow','26.json')`
—— 这是把实现里的路径拼法在测试里重写一遍，改成分段常量或 `path.resolve` 就会红，
而公开行为（`readFlowState` 读对了位置）没变。

**已核实**：`flowStatePath` 全仓只被这一个测试使用，`lib/flow-state.js` 内部调用它。

**改法**：
- `lib/flow-state.js` 去掉 `export`（改为模块内 `function`）
- 删掉那条路径拼法断言
- 新增一条**行为**断言：在 `<repo>/docs/specs/.flow/26.json` 放合法文件，`readFlowState(repo, 26)` 能读到；
  放在**错误位置**（如 `<repo>/.flow/26.json`）则返回 null。这才是「路径是对的」的真正证据。

### 2.2 `stageOf` —— 保留导出，测试改走 `buildTaskBoard`

**现状**：`test/task-board.test.mjs:44-57` 直接调 `stageOf({hasIssue, hasBranch, ahead, pr, checks, merged, flow})`
—— 这是内部入参形状。危险在于：它的入参与 `buildTaskBoard` 的入参（完整 snapshot）完全不同，
一旦 `cardOf` 改调用方式，所有 `stageOf` 测试会继续绿而实际行为已变。

**改法**：把 4 条 `stageOf` 用例全部改写为「构造一个 snapshot，断言 `buildTaskBoard(snap).columns` 里卡片落在哪一列」。
每条用例对应一个阶段场景（只有分支 → dev、有未推送提交 → pr、有 PR+CI未知 → ci、已合并 → done）。

### 2.3 `NEEDS_USER_KINDS` —— 保留导出，测行为

**现状**：`test/task-board.test.mjs:121-124` 只断言常量数组内容。这是「测常量不测行为」——
常量改了会红，但真正要保证的「这四种输入各自能触发」零覆盖。

**改法**：保留导出（`client.js` 的降级路径用到同名概念），删掉常量断言，
改为构造**四种触发各一次**，断言 `buildTaskBoard(snap).needsUser` 的 `kind` 集合恰好是这四个。

### 2.4 `rejectsBecauseMalformed` —— 同一目录复用

**现状**：`test/flow-state.test.mjs:36-41` 这个辅助函数每次调 `repoWith` 都新建临时目录，
所以注释声称的「same input succeeds on the happy path」另一半并不成立——每次都是不同目录。

**改法**：改为同一个目录：先写入合法文件 → 断言 `readFlowState` 返回非 null（正路径成立）
→ 覆盖成非法内容 → 断言返回 null。这样「同一个读取器、同一位置，只换内容」才是真对比。

## 3. 边界（不做）

- 不改任何产品代码的**行为**（只去掉一个 `export`）
- 不改 `client.js`（它有一份镜像实现，属于已接受的降级路径）
- 不动其它包的测试
- 不顺手改历史遗留的其它测试（只处理 #29 列的四处）

## 4. tickets

| # | 内容 | 验收 |
|---|---|---|
| 1 | `flowStatePath` 去导出 + 删拼法断言 + 新增「正确位置能读/错误位置读不到」行为断言 | 测试通过；把 `FLOW_DIR` 改成错误目录时新测试变红 |
| 2 | 4 条 `stageOf` 用例改写为 `buildTaskBoard` 黑盒断言 | 测试通过；把 `stageOf` 的某个分支改错时新测试变红 |
| 3 | `NEEDS_USER_KINDS` 常量断言 → 四种触发的行为断言 | 测试通过；删掉任一触发条件时新测试变红 |
| 4 | `rejectsBecauseMalformed` 改为同目录先正后负 | 测试通过；去掉 `normalizeFlowState` 的某个校验时新测试变红 |
| 5 | 全仓扫描：`dsh-git-status` 的测试里不再 import 非公开符号 | 除跳包契约常量（`STAGES`/`GRADES` 等枚举，属于 `.flow` 文件格式契约，不是私有实现）外无残留 |

## 5. 关于枚举常量的判定

`STAGES` / `GRADES` / `TICKET_STATES` / `CI_STATUSES` / `REVIEW_STATES` 这五个**保留断言**。
理由：它们是 `.flow/<issue>.json` 的**文件格式契约**——skill 写、面板读，跨进程、跨语言。
它们不是「私有实现细节」，而是对外协议的一部分，与 `client.js` 镜像实现共享同一套枚举。
测试锁住它们的**内容和顺序**是正当的。

## 6. 验收标准

1. `dsh-git-status` 测试不再 import `flowStatePath`（已不导出）、不再直接调 `stageOf`、
   不再断言 `NEEDS_USER_KINDS` 数组内容
2. 全部测试通过，且总数不减少（覆盖不下降）
3. **反向验证**：至少对 ticket 1/2/3 各做一次「改坏实现 → 新测试变红 → 恢复」
4. `pnpm verify` 全绿

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 改写过程中丢覆盖 | 每条用例改写前先看它原本验证什么，改写后确认同一行为仍被验证 |
| 黑盒断言可能变脆（依赖列位置字符串） | 用 `columns.find(c => c.stage === 'dev')` 这类结构性断言，不断言整个 board 形状 |
| 去掉 export 可能影响未发现的调用方 | 已全仓 grep 确认只有测试在用 |
