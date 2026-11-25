# issue-242/243/244/250:面板的四处静默失败

**分级:standard**(一个包、4 个缺陷、两个文件族:lib-git-status 与 client)

## 目标

把 ralph 审查实测出的四处「失败不给信号」修成「失败可见」,都在 packages/dev-flow:

1. **#242 超长 diff 渲染成「没有改动」**:`fileDiffOf` 以 `maxBuffer = maxBytes*4` 读 diff,超限时 `runCommand` 丢弃已读内容并返回 null,于是 `parts` 为空 → `{diff:'', truncated:false}`;未跟踪路径还会退化成「整文件新增」。
2. **#243 开放 PR/issue 的 30 条静默窗口**:`gh.js` 两条查询写死 `--limit 30`,满额时返回 30 条、退出码 0、无截断标记,第 31 张卡不存在。
3. **#244 合并证据超时退化成「没有合并」**:`recentlyMergedPullRequests` 超时 → null,任务板 `Array.isArray?…:[]` 折成空数组,已完成分支回到 dev 列且 `.flow` 被判 stale。
4. **#250 第 4 条待办卡片动作丢失**:`buildNeedsUser` 先 `slice(0,3)` 再回填 `card.action`,被截掉的卡片 action 为 null,条带也没有「还有 N 条」。

## 边界

- 只改 `packages/dev-flow`(lib-git-status/{run,git-info,gh,snapshot,task-board}.js + client.js)与其测试;不动别的 bundle。
- 不改快照的既有字段语义:`prs`/`issues`/`mergedPrs` 仍分别是「数组或 null」,新增的是标记字段。
- 不引入新的 gh 查询;不改 `gh` 调用**次数口径**——`pr list`/`issue list`/`pr list --state merged` 仍是各一次,单条查询的超时只放宽合并查询那一条。`gh pr checks` 是每个开放 PR 一次,故上限提到 200 后必须收窄它的集合(见变更点 4)。

## 验收

- 每项一条新测试且能反向验证(改回旧实现即红):#242 800 KB diff 在 `maxBytes=10000` 下 `truncated:true` 且前缀非空;#243 argv 中两条开放查询的 `--limit` 等于 `OPEN_LIST_LIMIT` 且 >30、满额快照带 `issuesTruncated:true`;#244 `mergedPrs:null` 时板子 `mergedPrsUnknown:true` 且卡片 `mergeEvidenceUnknown:true`,`[]` 时不标;#250 5 条待合并时条带仍 3 条、`needsUserTotal=5`、第 4/5 张卡仍有 action。
- `node --test test/*.test.mjs`(本包)全绿;`pnpm verify` 绿;版本 0.8.1 → 0.8.2。

## 变更点(实现中调整,留证)

1. **`runCommand` 不改变对外语义**:新增内部 `runCapture` 与导出 `runCommandCapped`,前者保留原有返回值(成功给字符串、`allowFailure` 给 null、致命失败给 undefined),只有后者返回 `{stdout, capped}`。这样 20 多处既有调用点零改动。
2. **上限从 `maxBytes*4` 收紧为 `maxBytes+1`**:超过 1 字节即判截断,`capped` 与「文本已满」一一对应,不必再靠 `diff.length > maxBytes` 推断;同时把内存峰值压回一个 diff 预览的量级。
3. **CHANGELOG 计数行按实况重写**:原句称「缺 tag 的 7 条」,实测(`git tag -l` 比对)只有 `dsh-skill-surface@0.1.0` 一条缺 tag —— 那 6 条在 #234 后已补打。现写为 84 条 = 80 已打 tag + 2 待打 + 2 仓库级。

## 双轴 review 裁决(轴2 回报 5 条,全部采纳;轴1 未回报)

轴1 子代理在收尾时仍未产出,其职责由 lead 自审代替(**无独立第二视角**)。轴2 的 5 条:

1. **【高】上限 200 让 `gh pr checks` 调用数从最多 30 涨到 200(spec 与注释都称「没变」= 失实)** → **采纳**:`checksOf` 只对「头分支在本地分支表里」的 PR 发起查询——没有本地分支的 PR 本来就不出卡,查它是纯浪费。新增测试:200 个开放 PR、仅 1 个本地分支 → `pr checks` 恰好 1 次。spec §边界与 `snapshot.js` 注释同步改写。
2. **【中】`mergeEvidenceUnknown` 把「未推送、绝不可能已合并」的卡片也标成可能已合并** → **采纳**:加 `ahead === 0` 条件,并补反向测试(`ahead:2` + `mergedPrs:null` → 不标)。
3. **【中/低】#243 测试钉常量不钉数值,200 改成 31–199 仍绿;且 `prsTruncated` 正向从未被测** → **采纳**:直接断言 `OPEN_LIST_LIMIT === 200`;补 200 个 PR 的 `prsTruncated:true` 用例。
4. **【低】#242 测试注释还写「> 4 x 10 KB cap」,而实现已改为 `maxBytes+1`** → **采纳**,注释改为「≫ the 10 KB read cap (maxBytes + 1)」。
5. **【低】`runCapture` 注释说「最多 maxBuffer bytes」,实际 `room` 按字符算** → **采纳**:注释改为「最多 maxBuffer 个字符(上限按字节比较,多字节载荷可能多留一点)」;不改实现(多留几十字节对预览无影响,切在多字节中间最多一个 U+FFFD)。
