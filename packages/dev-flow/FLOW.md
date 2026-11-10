# dev-flow:意图 → issue → 分支 → TDD → PR → CI → review → merge

单人文档化工程流程。规则以本文件为准,由 `dev-flow` 插件**常驻注入**一段短契约(见 `lib/contract.mjs`)——不再注册为技能,也不依赖模型"想起来加载"。侧栏 Git 面板实时展示任务板各列与"需要你出手"条目。

只有 **两次交互**,其余阶段自动推进。文件(spec/tickets/状态)是唯一状态源,阶段边界即新会话边界:上下文吃紧时把状态写盘,用新会话接着跑。

## 适用范围

只要本次请求会导致仓库文件内容变化——包括"只改一行""小修小补""格式微调"——**必须进入本流程**。改动大小不影响是否进流程,只影响分级。

**不进流程**的情形(直接回答,后者读侧栏 Git 面板亦可):

- **纯只读查询**:解释代码/查实现/找定义/"这个函数在哪"/"这是什么意思";
- **状态询问**:任务进度、CI 状态、review 结论、`.flow` 状态;
- **会话级操作**:切目录、读文件、跑一次性诊断命令。

判断口径:请求**不产生任何仓库文件写入**时一律不进流程;拿不准就进流程。

## 两次交互

### 交互1 意图

开工前,用一句大白话向用户复述两件事,并用 `ask_user_question` 请其确认(推荐项前置):

1. **你要的是什么**:需求原话 + 我的复述;有歧义就在这里追问。
2. **我打算怎么做**:2–4 条要点(会新建/改动什么、验收标准是什么),够用户判断"是不是这个意思"即可。

约束:

- 用户不是程序员。选项只能是「是不是这个意思 / 要不要做」这类判断,**不得**把 `trivial/standard`、issue、PR、diff、CI 这类术语当决策项抛给用户。
- 用户确认(或指出偏差)后**不再停下**;确认即代表授权一路做到合并前。

### 交互2 合并

做完(CI 绿、双轴 review 收尾、发现已裁决)后用 `ask_user_question` 问「要不要合并」,选项:合并 / 先不合并;并给一句建议与理由。

- 卡片点选「合并」等同口令;"嗯 / 好 / 继续 / 行 / 通过"不算。
- 用户点选"先不合并"→ 停下,按状态行报告当前 PR 与结论,等后续指示。

两次之外**不设停点**:spec 确认、issue 创建、分支创建、CI 自修、review 裁决全部自动。

## 自决边界

下列判断由 agent 自行作出,并把结论写进 spec / PR / `docs/specs/.flow/<issue>.json`,供用户复核——但**不要**为此提问:

| 事项 | 自决内容 | 留证位置 |
| --- | --- | --- |
| 分级 | `trivial`(≤1 文件 且 ≤30 行 且 无接口变更)或 `standard`,按计划变更预估,否则一律 standard | spec 首行 + `.flow` 的 `grade` |
| 裁剪 | 跳过某阶段(如 trivial 免双轴 review)必须写明"依据 X 跳过 Y";拿不准就不裁 | spec 的「裁剪」小节 + commit 信息 |
| 无 CI | 仓库没有 `.github/workflows` → 自动补一个最小 workflow(只跑 test/verify,显式 `permissions: contents: read`),再 push;PR 描述里点明新增了 workflow | PR 描述 |
| CI 红 | 自修≤2 轮(读取日志→修改→commit→push→再查),每轮在状态行写"第 N/2 轮";仍红则**不合并**,附失败要点与建议 | PR 评论 + `.flow` 的 `ci` |
| review 发现 | 自己裁决每条:采纳并修,或不采纳并写明理由;不得静默丢弃 | PR 描述 |
| spec 变更 | 实现中发现目标/边界/验收要调整,在 spec 里追加「变更点 + 理由」后继续 | spec 的「变更」小节 |

## 前置自检

动手前一次性执行并核对输出:

```
gh --version && gh auth status && git remote -v
```

- 任一失败 → 不带着假设往下走:把缺口写进最终结论,并给出用户要执行的那一条命令;其余能做的照做,不因此停工(这不是第三次交互)。
- `gh` 未认证 → `gh auth login` 是交互式的,会卡死 bash 工具;输出命令让用户自己在终端执行,确认后再继续。
- `git remote -v` 为空 → 与用户确认目标仓库(已有远程 or `gh repo create\))。
- 远程是镜像地址导致 `gh` 认不出仓库时,用 `gh … -R <owner>/<repo>` 指名,不要因此停工。

## TDD

standard 档每个 ticket 按红绿循环在主上下文执行(不派子代理写码):

1. **红**:先写一个会失败的测试,运行它,**确认它红对原因**(失败信息指向未实现的行为,而不是语法错/导入错)。
2. **绿**:最小实现让测试通过。禁止在测试红之前写实现。
3. 对下一个 ticket 重复。
4. **禁测私有函数**:不 import 内部私有符号、不断言调用次数与内部调用顺序;只测公开行为与输出。

trivial 档若无既有测试可免新增测试,但该裁剪按上表声明并留证;有测试仓时仍须跑全量测试。

完工验收四件套(全绿才算 ticket 完成,仓库里没有的项跳过):

```
pnpm test     # 或包内等价命令
pnpm verify   # 打包/版本纪律
typecheck / lint / build(如仓库有)
```

多会话共用 checkout 时,被别人的未提交改动或宿主 git 全局配置带偏的假红,用干净验证路径(`node scripts/verify-clean.mjs`)复核。

## 任务状态文件

Git 和 GitHub 只知道证据(分支、提交、PR、CI),不知道 TDD 内部走到了哪、CI 自修到第几轮、review 是否在等裁决。**每过一个节点,把这些写进 `docs/specs/.flow/<issue>.json`**;文件是任务板的唯一进度来源。

### 何时写

| 时机 | 写什么 |
|---|---|
| 意图确认、开 issue 后 | 建文件:`issue`、`grade`、`stage: "spec"`、`tickets`(全部 `todo`) |
| 建分支后 | `stage: "dev"` |
| 每个 ticket 红 | 该 ticket `state: "red"` |
| 每个 ticket 绿(四件套全过) | 该 ticket `state: "done"` |
| push + 开 PR 后 | `stage: "pr"` → 查到 CI 后 `stage: "ci"`,写 `ci.status` |
| CI 红自修每轮结束 | `ci.run` 加 1(上限 `max: 2`),`ci.status` 按实况 |
| CI 绿、发起 review 前 | `stage: "review"`,`review.state: "running"` |
| review 报告出来后 | `review.state: "running"`(裁决在 agent 侧进行);只有确实需要用户知会时才写 `pending-decision` |
| 合并请求发出前 | `stage: "merge"` |
| 合并完成 | `stage: "done"`、`merge.authorized: true` |

每次写入同时更新 `updatedAt`(ISO 8601 带时区)。

### 格式

```json
{
  "issue": 154,
  "grade": "standard",
  "stage": "ci",
  "updatedAt": "2026-11-10T16:40:00+08:00",
  "tickets": [
    { "id": 1, "title": "建表", "state": "done" },
    { "id": 2, "title": "校验", "state": "red" }
  ],
  "ci": { "run": 1, "max": 2, "status": "red" },
  "review": { "state": "running", "axes": 2 },
  "merge": { "authorized": false }
}
```

枚举(超出即非法,面板会当作没有状态):

- `grade`: `trivial` | `standard`
- `stage`: `intake` | `spec` | `dev` | `pr` | `ci` | `review` | `merge` | `done` —— 这八个值就是任务板的八列
- `tickets[].state`: `todo` | `red` | `green` | `done`
- `ci.status`: `green` | `red` | `none` | `unknown`
- `review.state`: `not-started` | `running` | `pending-decision` | `done`(`pending-decision` = 等用户知会,不是等用户裁决;agent 自裁期间写 `running`)

### 写坏了会怎样

**以仓库实况为准**:状态文件的 `stage` 与分支/PR/CI 实况不一致时,面板按实况放置卡片,并标一条「状态过期」。漏写只会让卡片停在更早的列,不会把任务谎报成已完成。

文件随分支走,PR 里能看到状态变化;它**不是**流程的替代品。

## 双轴 review

push + PR 之后、问用户是否合并之前执行,两个子代理并行,**固定模板**(原文照抄,只替换 `<...>` 占位符;不得即兴改写),输入只给客观材料:**spec/issue 原文 + 完整 diff**。

review 只报告不改码;**裁决由 agent 完成**(采纳则修,或不采纳并写理由),结论落进 PR 描述。

```text
(原文照抄,只替换 <...> 占位符;不得即兴改写。)

【轴1 —— 对 spec】只报告,不修改任何文件。
你是代码审查者。材料:spec 原文(<spec 路径>)、issue #<n> 原文、完整 diff(`git diff main...<branch>`,不是摘要)。
任务:判断实现是否符合 spec 的目标、边界(§边界)与验收标准(§验收);指出超出边界的改动、缺失的验收项、spec 与实现冲突之处。
要求:列出至少 3 个问题(按严重度排序,每条给 `文件:行号` + 为什么是问题 + 建议);确实找不到就明确写「未发现问题」。

【轴2 —— 对规范】只报告,不修改任何文件。
你是代码审查者。材料:完整 diff(同上)+ 仓库 `AGENTS.md` 与本 `FLOW.md` + 被改文件全文。
任务:仓库惯例(命名/提交/文档风格)、测试质量(只测公开行为?能否反向验证?过松还是过紧?)、事实准确性(每句对现状的断言是否可验证)、安全隐患(凭证泄露、危险指令)。
要求:列出至少 3 个问题(按严重度排序,每条给 `文件:行号` + 为什么是问题 + 建议);确实找不到就明确写「未发现问题」。
```

trivial 档可裁掉双轴 review(按「自决边界」声明并留证),但四件套仍须全绿。

## merge 闸

- 只有**用户具体口令**才授权合并:说出 `merge` 或点名 PR 号;在 `ask_user_question` 卡片点选「合并」等同点名。
- "嗯 / 好 / 继续 / 行 / 通过"都不算授权。
- merge 定位为**降低误判**;真正的硬闸是 GitHub 分支保护(见下)。
- merge 动作:squash merge(若仓库开启)→ 删除远程分支 → 关联 issue 自动关闭(`Closes #n`)。
- 合并后:在 main 打 `<包名>@<版本>` tag;需要重载宿主进程时**先问用户**,不自行重启。

## 硬规则

- **禁止直接改 main**:任何代码改动都在 `issue-<n>-<desc>` 分支上,经 PR 进入 main。
- **禁止测试私有函数 / 调用次数 / 内部顺序**;枚举常量属于对外协议,可以断言其内容与顺序。
- **裁剪必须留证**:"依据规则 X 跳过 Y" + 理由,写进 spec 与 commit 信息。
- commit/push 只在流程节点(PR 前、CI 自修重推)执行。
- 提交后回复末行加状态行(branch / PR / CI 状态)。
- **每过一个节点就写 `docs/specs/.flow/<issue>.json`**;漏写任务板会停在旧列。
- 破坏性操作(`rm -rf`、数据库 drop/truncate、force-push、重启宿主进程)先说明再问。

## 给用户的分支保护(用户自己执行)

仓库落地后建议开启分支保护,merge 闸才有硬约束。命令由**用户本人**在终端执行(需要 admin scope):

```bash
gh api repos/{owner}/{repo}/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{"required_status_checks":{"strict":true,"contexts":["test"]},"enforce_admins":false,"required_pull_request_reviews":{"required_approving_review_count":1},"restrictions":null}
EOF
```

(`contexts` 按仓库实际 CI job 名调整。)
