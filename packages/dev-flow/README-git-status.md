# dev-flow 任务板面板(原 dsh-git-status,已并入 dev-flow 包)

DeepSeek Harness 插件：当前工作区是 git 项目时，侧栏多一个 **Git** 面板，把它变成一个 **dev-flow 任务板**——一屏看清有哪些 issue 没处理、每个任务到了哪一步、哪些在等你出手。

**只读。** 插件对仓库只执行 `git` / `gh` 的只读子命令，不写任何仓库文件；唯一的写入口是 `dev-flow` skill 自己维护的状态文件（见下）。

## 任务板布局

一张卡 = 一个 issue；一列 = `dev-flow` 的一个节点。列顺序就是流程顺序：

| # | 列 | 含义 |
| --- | --- | --- |
| 1 | 待处理 | 停点1：意图与分级待确认 |
| 2 | 方案中 | 停点2：spec + tickets 待核 |
| 3 | 开发中 | TDD 红绿循环 |
| 4 | 待 PR | 有未推送提交 |
| 5 | CI | 三态（绿 / 红 / 无 CI） |
| 6 | 待 review | 双轴 review 待裁决 |
| 7 | 待 merge | 停点3：等你点名 merge |
| 8 | 已完成 | 已合并 |

除八列外，面板还有两个特殊区：

- **需要你出手**（顶部）：只挂 `dev-flow` 里真正需要你输入的四件事——停点1 待确认、本仓库无 CI、CI 红到第 2 轮升级、merge 待口令。最多 3 条，阻塞项优先。
- **未进流程**（红色横幅）：三种绕过流程的形态——脏 `main`、不在 `issue-<n>-*` 上的分支（**提交了也算**，不要求工作区脏）、以及 `issue-<n>-*` 但该 issue 并不存在。这是唯一能暴露「偷偷没走流程」的位置。

空列不留白，而是显示「下一步在等什么」（如待 merge 列空 → 「没有 PR 等口令」），面板本身就是流程说明书。

### 卡片

```
#26 [git-status] 面板改造为 dev-flow 任务板      standard
●●◐○○○○○                         ← 八个进度点，实心 = 已到该阶段
issue-26-task-board · ↑1 · PR #31 · CI 红 · CI 1/2 · ticket 2/7
⚠ 需要你：PR #31(issue #26)等你点名 merge
```

四行固定结构：标题行（issue 号 + 标题 + 分级）、进度点、证据行（分支 / ahead / PR / CI / ticket 计数）、**行动行**（只有这张卡需要你出手时才出现）。顶部区汇总全部待办，卡片行动行说明「这一张」在等什么。

## 状态文件：`docs/specs/.flow/<issue>.json`

Git 和 GitHub 知道分支、提交、PR、CI，但不知道 TDD 内部走到哪个 ticket、CI 自修到第几轮、review 报告是否在等你裁决。这些由 `dev-flow` skill 在每个流程节点写入同一个文件：

```json
{
  "issue": 26,
  "grade": "standard",
  "stage": "ci",
  "updatedAt": "2026-11-03T06:00:00+08:00",
  "tickets": [{ "id": 1, "title": "建表", "state": "done" }],
  "ci": { "run": 1, "max": 2, "status": "red" }
}
```

- `stage` 取值就是八列：`intake` / `spec` / `dev` / `pr` / `ci` / `review` / `merge` / `done`
- `tickets[].state`：`todo` / `red` / `green` / `done`
- `ci.status`：`green` / `red` / `none` / `unknown`
- `review.state`：`not-started` / `running` / `pending-decision` / `done`

文件缺失、JSON 写坏、枚举越界，一律当作「没有记录」降级处理，不会报错也不会谎报进度。

面板拿到的 `flowStates` 是**按 issue 号索引的普通对象**（不是 `Map`）：快照要走 `JSON.stringify`，`Map` 会序列化成 `{}`，浏览器端就会丢掉全部进度。同理，任务板本身也在**宿主侧一次算好**随快照下发，浏览器只渲染，避免两端各写一份推导逻辑而逐渐分叉。

### 冲突时以仓库实况为准

状态文件的 `stage` 与分支/PR/CI 实况不一致时，面板按**实况**放卡，并在卡片上标一条「状态过期」——所以漏写只会让卡停在更早的列，不会把任务谎报成已完成。

## 数据来源

| 字段 | 来源 |
| --- | --- |
| issue 列表 | `gh issue list` |
| 分支 ↔ issue 映射 | 分支名 `^issue-(\d+)-` |
| 改动文件 / 行数 | `git status --porcelain=v2` + `git diff --shortstat` |
| 未推送提交 | `git rev-list --count @{u}..HEAD` |
| PR 状态 | `gh pr list` |
| CI 三态 | `gh pr checks <n> --json state`（每 PR 一次；退出码 1/8 仍保留 stdout，因为「无 CI」和「检查进行中」都靠 body 判定） |
| TDD / CI 轮次 / review / merge 口令 | `docs/specs/.flow/<issue>.json` |

### gh 不可用时

卡片仍会从 git 证据生成（分支名里的 issue 号不依赖 gh），只是没有 PR / CI / issue 标题。面板会给出具体原因：

| 原因 | 提示 |
| --- | --- |
| `not-installed` | 未检测到 gh CLI |
| `not-logged-in` | gh 已安装但未认证 |
| `no-remote` | 仓库没有配置 remote |
| `not-github` | 远程不是 GitHub |

## 仓库实况（折叠）

任务板下面是可折叠的「仓库实况」：当前仓库信息、改动文件（点开看只读 diff）、领先上游的提交、stash、分支、PR、issue。这些是任务板的证据层，平时收起。

## 路由

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/git-status/snapshot?sessionId=<id>` | GET | 全部信息一次返回；`?refresh=1` 绕过缓存 |
| `/git-status/diff?sessionId=<id>&path=<仓库相对路径>` | GET | 单个改动文件的只读 diff；路径越出工作区直接 404 |

两者都只接受 GET，跨源请求返回 403，响应 `cache-control: no-store`。

## 工作区判定

面板跟随**当前会话**：前端把会话 id 带上，后端读该会话 header 里的 `cwd`（先查活动会话，再查会话持久化），从那里往上找最近的 `.git` 祖先。

- 会话 `cwd` 不在 git 仓库里 → 显示空态，**不会**回退去读别的目录的仓库。
- 拿不到会话 id 时（直接 curl、非会话场景）才退回 `$DSH_WORKSPACE` / `$DSH_CWD` / 进程 cwd。

### 缓存键 = 会话 + 工作区

快照缓存 30 秒，键是 `会话 id + 解析出的仓库根`。在同一会话里 `cd` 到另一个仓库（或新建 worktree）后立即重建，停在同一个仓库时仍然命中。

## 安装

profile 的 `package.json` 加一行：

```json
"dev-flow": "link:../../packages/dev-flow"
```

然后 `pnpm install`，重启 DSH。

## 测试

```bash
pnpm --filter dev-flow test
```

覆盖：

- **任务板**：八列顺序、空列提示、issue→列映射、冲突仲裁（实况优先 + 状态过期标）、未进流程识别、需要你出手的四种触发与上限、进度点
- **状态文件**：合法解析、缺失降级、坏 JSON、枚举越界、issue 号越界拒绝
- **CI 三态**：全绿 / 有失败 / 全空 / 进行中标 unknown / 失败优先于进行中
- **快照**：无 gh 权限时仍产出 flowStates 与 checks，非 git 工作区字段稳定
- **渲染**：列头、卡片四行、分级徽章、过期标、需要你出手区、未进流程横幅
- **既有能力**：porcelain v2 解析（rename 原始路径、冲突、截断）、stash、diff 越界拒绝、会话+工作区缓存键
- **README**：文档与实现一致（八列名称、状态文件路径、实况优先）
