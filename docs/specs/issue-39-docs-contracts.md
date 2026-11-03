# #39 收口(一):把「验格式」的契约升级成「验事实」

- 分级:`standard`
- 关联:issue #39,#38 合并后补审发现(轴2 第二份报告)
- 本分支只做 **文档 + 契约 + dev-flow skill 模板**;`pnpm-lock.yaml`、profile 死链、`check:websearch` 只**验证与报告**,不写(避免与 issue-36 会话抢写权)

## 1. 问题:14 条契约对下面这些「改坏」全部失明

复核方式:在干净 checkout 里改坏文档/测试,跑 `node --test test/*.test.mjs`。

| # | 改坏 | 结果 |
| --- | --- | --- |
| A | 把 `P1-6 仍未修` 两处改成 `✅ 已修` | 14/14 全绿 —— 「P1-6 必须仍未修」这条硬要求无人守 |
| B | 校准块写成 `现状校准（2030-13-45,main @ deadbee）` | 全绿 —— 非法日期 + 不存在的 commit 都能过 |
| C | `- 状态：**待批准**`(全角冒号) | 全绿 —— 半角冒号黑名单被绕过 |
| D | 把 Windows 专属包从 json 片段移到表格(信息完整) | 变红 —— 契约过紧,误报合法改法 |
| E | `update-checkout.md` 说 5 个、正文写 6 个 | 全绿 —— 内部矛盾无人管 |
| F | `docs/update-scheme.md` 写「已另开工单」而工单不存在 | 全绿 —— 不可验证的断言 |
| G | `docs/specs/.flow/37.json` 停在 review 且 PR 已合并 | 无人管 |

## 2. 目标

契约只断言**可验证的事实**,并且每条都能反向验证:改坏 → 红。

## 3. 边界

- 改:`test/docs-contract.test.mjs`、`docs/update-scheme.md`、`docs/update-checkout.md`、`docs/specs/docs-drift.md`、`docs/specs/.flow/37.json`、`packages/dev-flow-skill/SKILL.md`(+ `package.json` 版本号与 `CHANGELOG.md`)
- 不改:`pnpm-lock.yaml`、profile、任何插件代码
- `packages/dev-flow-skill` 是 bundle,改它必须 bump:0.2.0 → 0.2.1,合并后在 main 打 `dev-flow-skill@0.2.1`
- 不重启 DSH

## 4. 验收

1. `node --test test/*.test.mjs` 全绿,新增/收紧的契约逐条反向验证(见 §1 表 A-E 全部转红)。
2. `pnpm verify` 全绿(干净环境下;本机脏工作树导致的 `check-bundle-versions` 假红不算)。
3. 文档里每句「已修 / 未修 / 见 #NN」都能被命令或 issue 编号验证。

## 5. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 契约:P1-6 守卫 + lockfile 互锁 | 文档含 `P1-6` 且同行「仍未修」;`pnpm-lock.yaml` 的 importers 与 `packages/` 不一致时,该行若写「已修」必红 |
| T2 | 契约:校准块日期与 commit 真实性 | 非法日期或 `git cat-file -e <sha>^{commit}` 失败即红 |
| T3 | 契约:待批准黑名单认全/半角冒号,并正向要求「已执行完成」 | 全角写法必红 |
| T4 | 契约:安装片段放宽为「每个 bundle 必须被提及且给出正确路径」 | 移到表格/文字仍绿;路径写错或漏包必红 |
| T5 | 文档:引工单号、修 6→5、P1-10 证据、docs-drift 状态、`.flow/37` 收尾 | 与 T1-T4 契约同时绿 |
| T6 | `dev-flow-skill` 补双轴 review 的固定 prompt 模板 + 版本 0.2.1 | `pnpm verify` 版本纪律绿;模板可被直接复制使用 |

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 契约依赖 `git` / lockfile 内容 → 换仓库就误报 | 只在检测到矛盾时才要求「未修」;lockfile 修好后契约自动转为「必须写已修」——但这条留到 #39 第 1 条真正修完时再开 | 
| 收紧后 CI 用旧 commit 的 calibration sha | 校准块必须指向**已存在**的 commit,分支上可指向 base commit,合并后由本 PR 更新为合并前 sha 即可 |
