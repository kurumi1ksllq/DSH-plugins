# spec: dsh-git-status 改造为 dev-flow 任务板

> 停点2 产物。用户于 2026-11-03 确认三点设计：①状态文件放仓库内 `docs/specs/.flow/<issue>.json`；②字段够用（`grade` 保留，不加负责人/耗时）；③冲突时以 Git/GitHub 实况为准并标「状态过期」。

## 1. 目标

把 `packages/dsh-git-status` 的侧栏面板从「按数据类别平铺」（仓库/改动/ahead/stash/分支/PR/issue 七张并列卡片）改成 **dev-flow 任务板**：一屏看尽有哪些 issue 没处理、每个任务走到哪一步、哪些需要用户出手。

核心转变：**卡片 = 一个 issue，列 = dev-flow 节点**。Git / GitHub 只是证据来源。

## 2. 需求锚点（用户原话）

- 「git 更像是任务板」
- 「想看看有啥 issue 没处理」
- 「任务到了哪一步了」
- 「很直观的看到都有什么需要处理」

## 3. 布局：8 列 + 2 个特殊区

### 3.1 八列（列序 = dev-flow 流程顺序，`stage` 枚举固定）

| # | 列 | `stage` | 含义 | 进入条件 |
|---|---|---|---|---|
| 1 | 待处理 | `intake` | 停点1：意图/分级待确认 | issue 已建、方案未确认 |
| 2 | 方案中 | `spec` | 停点2：spec+tickets 待核 | 有 spec 文件 |
| 3 | 开发中 | `dev` | TDD 红绿循环 | 有 `issue-<n>-*` 分支 |
| 4 | 待 PR | `pr` | 已开发完、待 push/开 PR | 有 ahead 提交 |
| 5 | CI | `ci` | 三态：绿/红/无 | 有 PR |
| 6 | 待 review | `review` | 双轴 review 待裁决 | CI 绿（或无 CI 已决定） |
| 7 | 待 merge | `merge` | 停点3 等口令 | review 完成 |
| 8 | 已完成 | `done` | 已 squash merge | 已 merge |

### 3.2 两个特殊区

**顶部「需要你出手」区**：只挂 dev-flow 的 4 种用户输入，最多 3 条：

1. 停点1 意图/分级待确认
2. 本仓库无 CI → 问是否生成 workflow
3. CI 红已到第 2 轮 → 升级用户
4. merge 待口令（需点名 PR 号）

**最左「未进流程」列**（独立于 8 列）：当前分支的改动既无 issue 也无 `issue-<n>-*` 分支，即「直接改 main」或「在非流程分支上改」。标红。这是唯一能暴露「偷偷没走流程」的位置。

### 3.3 卡片结构（固定四行）

```
┌────────────────────────────────────────────┐
│ #25 feat: 事务化更新器            standard │  ← 标题行
│ ●●◐○○○○○                                  │  ← 进度点（8 列，实心 = 已完成）
│ branch issue-25-updater · 3 文件 +142 −18  │  ← 证据行
│ ●3 未推送 · PR #31 · CI 红 1/2             │
│ ⚠ 需要你：等 CI 第 2 轮结果            2h前 │  ← 行动行（仅需用户出手时出现）
└────────────────────────────────────────────┘
```

空列不留白，显示「下一步动作」提示，例如待 merge 列空 →「无 PR 等口令」。

## 4. 状态文件契约

### 4.1 位置

仓库内 `docs/specs/.flow/<issue>.json`。随分支走，PR 里可见状态变化。

### 4.2 格式

```json
{
  "issue": 25,
  "grade": "standard",
  "stage": "ci",
  "updatedAt": "2026-11-03T06:00:00+08:00",
  "tickets": [
    { "id": 1, "title": "建表", "state": "done" },
    { "id": 2, "title": "校验", "state": "red" }
  ],
  "ci": { "run": 1, "max": 2, "status": "red" },
  "review": { "state": "pending-decision", "axes": 2 },
  "merge": { "authorized": false }
}
```

枚举：

- `grade`: `trivial` | `standard`
- `stage`: `intake` | `spec` | `dev` | `pr` | `ci` | `review` | `merge` | `done`
- `tickets[].state`: `todo` | `red` | `green` | `done`
- `ci.status`: `green` | `red` | `none` | `unknown`
- `review.state`: `not-started` | `running` | `pending-decision` | `done`

### 4.3 冲突仲裁（用户选 A）

`stage` 与 Git/GitHub 实况冲突时，**以实况为准**，卡片落在实况对应列，并打黄色「状态过期」标。

例：`.flow` 写 `review` 但无 PR → 落在「待 PR」列 + 过期标。

## 5. 数据来源与可靠度

| 字段 | 来源 | 可靠度 |
|---|---|---|
| issue 编号/标题/打开 | `gh issue list` | 高 |
| 分支 ↔ issue 映射 | 分支名正则 `^issue-(\d+)-` | 中 |
| 改动文件数、+/- 行 | `git status --porcelain=v2` + `git diff --shortstat` | 高 |
| ahead N 未推送 | `git rev-list --count @{u}..HEAD` | 高 |
| PR 号 / head→base / 草稿 / 冲突 | `gh pr list` | 高 |
| CI 绿/红/无 | `gh pr checks <n>`（新增，每 PR 一次） | 中 |
| TDD 红绿、CI 自修轮次、review 待裁决、merge 口令 | `.flow/<issue>.json` | 中（依赖 skill 写入） |

## 6. 边界（不做）

- 不做多工作区总览层（C 档，留给下一个 PR）
- 不做任何 git 写操作，面板保持只读
- 不改 `dsh-git-bash-tool`、`dsh-inventory` 等其它包
- 不引入前端框架，沿用现有 `h()` 手写渲染

## 7. 验收标准

1. 面板渲染 8 列（空列显示「下一步动作」提示而非空白）+ 顶部「需要你出手」区 + 最左「未进流程」列
2. 一个 issue 一张卡，卡片含标题 / 进度点 / 证据 / 行动四行
3. `docs/specs/.flow/<issue>.json` 存在时，卡片显示 TDD / CI 轮次 / review 状态；不存在时降级为纯 Git 推导，不报错
4. `stage` 与实况冲突 → 落在实况列 + 显示「状态过期」标
5. 「未进流程」列能识别 main 上的脏改动与非 `issue-*` 分支的脏改动
6. 全部现有测试通过 + 新增测试覆盖上述 1-5
7. `dev-flow-skill/SKILL.md` 增加「每个流程节点写 `.flow/<issue>.json`」一步，且 skill 的契约 lint 仍通过

## 8. tickets（有序，含依赖）

| # | ticket | 依赖 | 验收 |
|---|---|---|---|
| 1 | 新增 `lib/flow-state.js`：读 `docs/specs/.flow/<issue>.json`，校验枚举，非法/缺失返回 null 不抛 | — | 单测：合法解析、缺失降级、非法 stage 拒绝、越界路径拒绝 |
| 2 | `lib/gh.js` 新增 `prChecks(repoDir, prNumber)`：`gh pr checks <n> --json state` → green/red/none/unknown | — | 单测（mock 输出）：全绿→green、有失败→red、空→none、命令失败→unknown |
| 3 | 新增 `lib/task-board.js`：纯函数，输入 snapshot + flow states → 输出 `{ columns: [{stage, cards[]}], needsUser: [], offFlow: [] }` | 1, 2 | 单测：issue→列映射、冲突仲裁、needsUser 只含 4 种、offFlow 识别 main 脏改动 |
| 4 | `lib/snapshot.js` 挂接 flow-state 读取与 `prChecks`，新增 `flowStates` 字段 | 1, 2 | 单测：snapshot 含 flowStates，gh 未认证时降级 |
| 5 | `client.js` 重绘为任务板：8 列 + needsUser 区 + offFlow 列 + 四行卡片 | 3, 4 | 渲染测试：列头、空列提示、卡片四行、过期标、needsUser 内容 |
| 6 | `dev-flow-skill/SKILL.md` 增加写 `.flow/<issue>.json` 一步 + `lib/lint.mjs` 契约同步 | — | skill 测试通过 + lint 通过 |
| 7 | 更新 `packages/dsh-git-status/README.md` 描述新布局 | 5 | 文档与实现一致 |

## 9. 分级

**standard**。理由：改动跨 `dsh-git-status`（3 改 + 2 新增）与 `dev-flow-skill`（2 文件），新增 `.flow` 文件格式与 `prChecks` 两个对外契约 → 不满足 trivial 硬标准（≤1 文件 且 ≤30 行 且 无接口变更）。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| `gh pr checks` 每 PR 一次请求，PR 多时变慢 | 详情层并发池限流 4；失败降级 `unknown` 不阻塞渲染 |
| `.flow` 无人写 → 面板只显示到 PR/CI 层 | 已告知用户；ticket 6 让 skill 写；缺文件时优雅降级 |
| 8 列在窄屏挤 | 横向滚动 + 列最小宽度 240px |
| 分支命名不规范 → issue 映射失败 | 该类卡片进「未进流程」列并提示命名规范 |
