---
name: dev-flow
description: 完整工程开发流程 skill：确认仓库 → 提交 issue → 建分支 → TDD 开发 → push → 开 PR → 查 CI → review → merge。任何改代码的请求（"帮我改""修个 bug""加个功能""开发…"）先调本 skill；出现 dev-flow、issue、分支、PR、CI、review、merge 等词必然触发。
---

# dev-flow：issue → branch → TDD → PR → CI → review → merge

单人文档化工程流程。只有 **3 个实质停点**，其余阶段自动推进。文件（spec/tickets）是唯一状态源，阶段边界即新会话边界：上下文吃紧时把状态写盘，用新会话接着跑。

## 适用范围

只要本次请求会导致仓库文件内容变化——包括"只改一行""小修小补""格式微调"——**必须进入本流程**。改动大小不影响是否进流程，只影响分级。禁止以"改动太小"为由不走流程：trivial 档仍然要过 issue / 分支 / PR / CI 全链路，只是方案确认和 review 可依规则裁剪。

## 前置自检

动手前一次性执行并核对输出：

```
gh --version && gh auth status && git remote -v
```

- 任一失败 → **停下来报告**，不带着假设往下走。
- `gh` 未认证 → `gh auth login` 是交互式的，会卡死 bash 工具；**输出命令让用户自己在终端执行**，确认后再继续。
- `git remote -v` 为空 → 与用户确认目标仓库（已有远程 or `gh repo create`），确认后再继续。

## 停点

### 停点1 意图 + 路径分级

向用户声明两件事，等确认（用户可否决）：

1. **意图**：一句话说清要做什么；需求有歧义就在这里追问（grill 并入本停点，不单设停点）。
2. **分级**：`trivial` 或 `standard`。
   - **trivial 硬标准**（三者同时满足，缺一即 standard）：≤1 个文件 且 ≤30 行变更 且 无接口变更。
   - trivial 必须用户明示；模型只有建议权，不得自行降档。

**裁剪反滥用**（全流程唯一由模型自由裁量的开关，重点防守）：

- 想跳过任何阶段（含 issue、TDD、review）→ 先写明"**依据规则 X 跳过 Y**"并给出理由给用户看，点头才跳。理由没写出来 = 没跳过。
- 模糊任务不得凭感觉判 trivial；拿不准就 standard。
- **分级在停点1、基于对计划变更的预估作出**。先实现后分级、或以"实际 diff 很小"追认 trivial，均无效。对"优化 / 重构 / 清理"类请求，因通常触及接口或多文件，默认按 standard 走。

### 停点2 方案确认

- `trivial`：一句话方案确认即可。
- `standard`：给出 **spec**（目标、边界、验收）+ **tickets**（有序任务清单，可带依赖），落盘为文件（建议 `docs/specs/<topic>.md`，放仓库或 `$DSH_HOME` 下，按用户偏好）。文件是唯一状态源。
- 用户确认后自动推进，不再停：`gh issue create`（正文引用 spec 路径与要点）→ `git switch -c issue-<n>-<简述>`。这两个是机械动作，不配停点。
- **实现阶段不得改写 spec 的目标/边界/验收条款**：审查或实现中发现 spec 本身要改（哪怕理由成立），把变更点列出来**回到用户面前重新确认**（可以在实现 commit 之前单独确认，并在 commit 信息里注明「停点2 重新确认」）。验收条款是用户确认过的承诺，不是实现的注脚。（#48 教训）

### 停点3 review + merge

- push 前明确声明："**我将 push 到 origin/<branch> 并开 PR**"。
- push → `gh pr create`（正文带 `Closes #<n>`）→ **查 CI 一次**（`gh pr checks` 或 `gh run list`；禁用 `--watch`，占住会话无意义）。

#### CI 三态（显式区分，绝不把"无 CI"当"CI 绿"）

| 状态 | 行为 |
|---|---|
| **无 CI**（仓库无 .github/workflows） | 停下来问用户：是否引导生成最小 workflow（如 test+verify），还是本次直接进 review。**报告原话：本仓库当前没有 CI。** |
| **绿** | 直接进 review。 |
| **红** | 自修重推，最多 **2 轮**。一轮 = 一次"读取失败日志 → 修改 → commit → push → 查 CI"；每完成一轮在状态行写明"CI 自修第 N/2 轮"。第 2 轮查完仍红即停，禁止第 3 次重推，禁止静默放弃 → 升级用户，附失败日志要点。 |

#### 双轴 code review

- 两个子代理，用下面的**固定 prompt 模板**（不得即兴改写），输入只给客观材料：**spec/issue 原文 + 完整 diff**（不是只有 diff）。
- 模板要求："列出至少 3 个问题；确实找不到就明确写'未发现问题'。"
- 轴1：对 spec——实现是否符合 spec 与验收标准；轴2：对规范——仓库惯例、测试质量、安全隐患。
- review **只报告不改码**；用户裁决后再动。

- 单人裁剪：用户明示 trivial 时，双轴 review 可由用户点头跳过（依据规则"trivial 裁剪"声明后执行）。

固定模板（原文照抄，只替换 `<...>` 占位符；不得即兴改写）:

```text
（原文照抄，只替换 <...> 占位符；不得即兴改写。）

【轴1 —— 对 spec】只报告，不修改任何文件。
你是代码审查者。材料：spec 原文（<spec 路径>）、issue #<n> 原文、完整 diff（`git diff main...<branch>`，不是摘要）。
任务：判断实现是否符合 spec 的目标、边界（§边界）与验收标准（§验收）；指出超出边界的改动、缺失的验收项、spec 与实现冲突之处。
要求：列出至少 3 个问题（按严重度排序，每条给 `文件:行号` + 为什么是问题 + 建议）；确实找不到就明确写「未发现问题」。

【轴2 —— 对规范】只报告，不修改任何文件。
你是代码审查者。材料：完整 diff（同上）+ 仓库 `AGENTS.md` 与本 `SKILL.md` + 被改文件全文。
任务：仓库惯例（命名/提交/文档风格）、测试质量（只测公开行为？能否反向验证？过松还是过紧？）、事实准确性（每句对现状的断言是否可验证，有没有把「已修」写在没有证据的地方）、安全隐患（凭证泄露、危险指令）。
要求：列出至少 3 个问题（按严重度排序，每条给 `文件:行号` + 为什么是问题 + 建议）；确实找不到就明确写「未发现问题」。
```

#### merge 闸

- merge 需要用户给出**具体口令**：说出"merge"或点名 PR 号（如"merge #5"）。
- **"嗯 / 好 / 继续 / 行 / 通过"都不算 merge 授权**——它们只代表对上一个问题的回答。
- 若用户说"直接 merge 吧"但未点名 PR，列出待 merge 的 PR 编号请用户点名。
- merge 定位为**降低误判**：真正的硬闸是 GitHub 分支保护（见下"给用户的分支保护"）。
- merge 动作：squash merge（若仓库开启）→ 删除远程分支 → 关联 issue 自动关闭（`Closes #n`）。

## TDD

trivial 档若无既有测试可免新增测试，但该裁剪仍须按"依据规则 X 跳过 Y"声明并获点头；有测试仓时仍须跑全量测试。standard 档的每个 ticket 按红绿循环在主上下文执行（不派子代理写码）：

1. **红**：先写一个会失败的测试，运行它，**确认它红对原因**（失败信息指向要实现的行为，而不是语法错误/导入错误）。
2. **绿**：最小实现让测试通过。禁止在测试红之前写实现。
3. 对下一个 ticket 重复。
4. **禁测私有函数**：不 import 内部私有符号、不断言调用次数与内部调用顺序；只测公开行为与输出。

完工验收四件套（全绿才算 ticket 完成）：

```
全量测试（node --test packages/*/test/*.mjs 或包内等价命令）
typecheck（如仓库有）
lint（如仓库有）
build（如仓库有）
```

## 任务状态文件

Git 和 GitHub 只知道证据（分支、提交、PR、CI），不知道 TDD 内部走到了哪、CI 自修到第几轮、review 报告是否在等你裁决。**每过一个节点，把这些写进 `docs/specs/.flow/<issue>.json`**；文件是任务板（`dsh-git-status` 面板）的唯一进度来源。

### 何时写

| 时机 | 写什么 |
|---|---|
| 停点2 确认后、开 issue 后 | 建文件：`issue`、`grade`、`stage: "spec"`、`tickets`（全部 `todo`） |
| 建分支后 | `stage: "dev"` |
| 每个 ticket 红 | 该 ticket `state: "red"` |
| 每个 ticket 绿（四件套全过） | 该 ticket `state: "done"` |
| push + 开 PR 后 | `stage: "pr"` → 查到 CI 后 `stage: "ci"`，写 `ci.status` |
| CI 红自修每轮结束 | `ci.run` 加 1（上限 `max: 2`），`ci.status` 按实况 |
| CI 绿、发起 review 前 | `stage: "review"`，`review.state: "running"` |
| review 报告出来后 | `review.state: "pending-decision"` |
| 你裁决、review 完结 | `review.state: "done"`、`stage: "merge"` |
| merge 完成 | `stage: "done"`、`merge.authorized: true` |

每次写入同时更新 `updatedAt`（ISO 8601 带时区）。

### 格式

```json
{
  "issue": 26,
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

枚举（超出即非法，面板会当作没有状态）：

- `grade`: `trivial` | `standard`
- `stage`: `intake` | `spec` | `dev` | `pr` | `ci` | `review` | `merge` | `done` —— 这八个值就是任务板的八列
- `tickets[].state`: `todo` | `red` | `green` | `done`
- `ci.status`: `green` | `red` | `none` | `unknown`
- `review.state`: `not-started` | `running` | `pending-decision` | `done`

### 写坏了会怎样

**以仓库实况为准**：状态文件的 `stage` 与分支/PR/CI 实况不一致时，面板按实况放置卡片，并标一条「状态过期」提示。所以漏写只会让卡片停在更早的列，不会把任务谎报成已完成。

文件随分支走（进 `.flow/` 目录但不是秘密），PR 里能看到状态变化；它**不是**流程的替代品——停点、merge 口令仍以对话为准。

## 硬规则

- **禁止直接改 main**：任何代码改动都在 `issue-<n>-<desc>` 分支上，经 PR 进入 main。
- **禁止测试私有函数 / 调用次数 / 内部顺序**（见 TDD 节）。
- **裁剪必须声明**："依据规则 X 跳过 Y" + 理由展示给用户 + 用户点头，三步缺一不可。
- **trivial 硬标准**不可放宽：≤1 文件 且 ≤30 行 且 无接口变更。
- commit/push 只在流程节点（停点3 声明后、CI 自修重推）执行；其他时候等用户明确要求。
- 提交后回复末行加状态行（branch / PR / CI 状态）。
- **每过一个节点就写 `docs/specs/.flow/<issue>.json`**（见「任务状态文件」）；漏写任务板会停在旧列。

## 给用户的分支保护（用户自己执行）

仓库落地后建议开启分支保护，merge 闸才有硬约束。命令由**用户本人**在终端执行（需要 admin scope）：

```bash
gh api repos/{owner}/{repo}/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{"required_status_checks":{"strict":true,"contexts":["test"]},"enforce_admins":false,"required_pull_request_reviews":{"required_approving_review_count":1},"restrictions":null}
EOF
```

（`contexts` 按仓库实际 CI job 名调整。）

## 明确不做（v2 候选）

- 并行 worktree + 每 ticket 全新子代理（ticket≥3 且无依赖时再评估）。
- 每任务 review 循环（改为完工后一次双轴 review）。
- `--watch` 式 CI 等待。
- 三档路径制（保留 trivial / standard 两档）。

## AGENTS.md 路由提示

在项目 AGENTS.md 中加一行，保证改代码请求先路由到本 skill：

> 任何改代码的请求，先调用 dev-flow skill，再谈实现。
