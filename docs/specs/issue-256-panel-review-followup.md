# issue-256:PR #254 的 review 遗留四项

**分级:trivial**(一个包、四处小修,全部由评审报告钉住位置)

## 目标

修合并后迟到的轴1 review 报出的四件事:

1. **截断提示把已抓到的列表藏掉**:`ghHintText` 一旦返回非空,`PrCard`/`IssueCard` 就只画这一句,`snap.prs`/`snap.issues` 里已拿到的 200 行不显示。
2. **`stale` 误判**:合并查询超时(`mergedPrs:null`)时 `stageOf` 给 `dev`,而 `.flow` 常写 `done` → 卡片同时说「状态过期」和「合并证据暂不可用」。
3. **板面无截断信号**:`buildTaskBoard` 不传 `prsTruncated`/`issuesTruncated`,列头只有 `cards.length`。
4. **`runCommand` 致命路径语义**:spawn error 在致命模式由 `null` 变 `undefined`,与 spec 变更点「不改变对外语义」不符(现仓无致命调用者)。

## 边界

- 只改 `packages/dev-flow`(client.js / lib-git-status/task-board.js / lib-git-status/run.js 注释)与其测试。
- 不改 `gh` 调用、不改快照字段语义,只加板面透传字段 `truncated`。

## 验收

- 截断时 PR/issue 列表照常渲染,并在末尾出现一句说明;板面也出现同一句。
- `mergedPrs:null` + `.flow.stage='done'` → `stale === false`、`mergeEvidenceUnknown === true`。
- 新增用例反向可验(改回旧行为即红);本包测试全绿;`dev-flow` 0.8.2 → 0.8.3。

## 变更点

1. **截断提示与失败提示分家**:`ghHintText` 只负责「查不到」,截断改由各卡片在列表之后追加一行;这样两种信息不会互相顶掉。
2. **板面用一句全局说明而不是列头标记**:截断的是列表而不是某一列,列头加标记会让人以为只有那一列不全。
