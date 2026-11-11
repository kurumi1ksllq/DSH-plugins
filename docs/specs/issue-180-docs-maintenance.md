# spec: 全量文档维护——README 补全 + 版本/包名对齐 + 运维文档现状校准(#180)

> 用户 2026-11-11 确认:对整个仓库的项目文档做一次维护,只改文档,不动插件代码与运行环境。
> 分级:`standard`(跨 6+ 文件、需要新增文档契约测试)。

## 1. 问题(只读体检,2026-11-11,main @ 9efbf72)

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | 根 README 插件表只有 6 行,`packages/` 有 8 个 bundle | 表内缺 `dsh-task-dispatcher`、`ecc-agent-presets`;现有契约只查「包名在 README 出现过」,不查表格覆盖 |
| 2 | `dsh-deep-ptc-mode` README/README.zh 版本停在 1.7.3 | 包 `version` 为 1.13.1;安装片段仍写 `dsh-deep-ptc-mode@1.7.3` |
| 3 | dsh-inventory README 把提示词注入写成 `@local/dsh-prompt-inject` | 该包 0.10.0 已并入 dsh-inventory(#111),行 id `prompt-inject` 保留;安装段落仍写独立仓库 + `profile/desktop` |
| 4 | CHANGELOG Unreleased 注记「本段现有 15 个条目」 | 实际 `### ` 条目 29 个;29 条对应的 tag 均存在 |
| 5 | 两份 update 文档校准块停在 2026-11-04 / 5 条 link | 当前 profile 有 8 条 `link:`;正文仍写「今天已是 5 个」「5 个插件 active」;registry 清单提到已不存在的 `dsh-plugin-save-token` |
| 6 | update-scheme 引用不存在的根命令 | `pnpm check:websearch` / `pnpm build:websearch` 不在根 `package.json` scripts;实际是包内 `build:check` / `build` |
| 7 | `.flow/29.json` 停在 `stage: pr` | issue #29 于 2026-11-03 关闭;合并提交 `ea81629`(PR #33) |
| 8 | 缺少文档地图 | 新会话无法区分现行文档与历史 spec |

### 运行时快照(用于校准块)

- `main @ 9efbf72`;工作树 `/root/DSH-plugins/.agents/worktrees/dsh-9dcf2a20-63e5`。
- profile `/root/.dsh/profiles/web`:`dependencies` 里 8 条本仓库 `link:`,全部指向 `/root/DSH-plugins/packages/*`。
- `dsh.profile.bundles` 里有 7 个本仓库行;**`ecc-agent-presets` 已 link 但未列入 bundles,当前不加载**——这是 profile 侧缺口,本文档只记录,不改 profile。
- registry 4 个:`@deepseek-ai/dsh-mcp-client@0.2.2-rc.1`、`dsh-context@0.83.0`、`dsh-tool-search@0.1.10`、`@wxg-prc-cpg/browser-skill-dsh-plugin@0.4.2`。
- 运行时 DSH `0.2.2-rc.1`。

## 2. 目标

1. 根 README 的插件表覆盖 `packages/` 全部 8 个 bundle,并新增一份 `docs/README.md` 文档地图,说明现行文档与历史 spec 的边界。
2. 各包 README 的版本、包名、安装/测试入口与当前代码一致;历史验证报告保留原文,但顶部必须声明「历史快照」并指向现状文档。
3. 两份 update 文档按 2026-11-11 的 profile 实况重新校准;不再引用不存在的命令;正文旧数只在带「当时/历史」的句子里出现。
4. CHANGELOG 的条目计数改成可被测试核对的事实。
5. `.flow/29.json` 按合并证据翻终态。
6. 把上述事实写成文档契约(先红后绿),防止再次漂移。

## 3. 边界

- 只改:`README.md`、`AGENTS.md`、`CHANGELOG.md`、`docs/README.md`(新增)、`docs/update-scheme.md`、`docs/update-checkout.md`、各包 README/历史报告顶部声明、`docs/specs/.flow/29.json`、`test/docs-contract.test.mjs`。
- 不改任何 `packages/*` 代码与 `package.json`,不升版本、不打 tag。
- 不改 profile、不重启 DSH;profile 侧 `ecc-agent-presets` 未加载只记录在文档与最终结论里。
- `docs/specs/*.md` 是历史记录,除新增本 spec 外不改写;只动 `.flow/29.json`。
- 不重写 CHANGELOG 的 History 段;本次只修 Unreleased 的计数注记。

## 4. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| 1 | **红**:新增 4 条文档契约(README 表格覆盖全部包、CHANGELOG 注记计数=实际条目、docs/README.md 存在且链接现行文档、deep-ptc README 头部版本=包版本) | 4 条均因当前文档而红,失败信息指向具体缺口 |
| 2 | README 补 `dsh-task-dispatcher` / `ecc-agent-presets` 两行;新增 `docs/README.md` 地图;README/AGENTS 链到地图 | T1 的表格与地图契约转绿 |
| 3 | CHANGELOG 注记改为实际条目数(当前 33) | T1 计数契约转绿 |
| 4 | 两份 update 文档重新校准(2026-11-11 @ 9efbf72、8 条 link、运行时/registry 版本、ecc 缺口、可执行命令) | 校准块日期/commit 真实;文中不再出现「今天 5 个」;命令可在仓库内执行 |
| 5 | 各包 README 对齐:deep-ptc 1.13.1 + 1.8–1.13 变更摘要(en/zh);inventory 旧包名/安装/测试计数;vault 测试计数;历史报告加「历史快照」声明 | T1 版本契约转绿;README 描述与 package.json/代码一致 |
| 6 | `.flow/29.json` → `stage: done`、`merge.authorized: true`、note 写 `ea81629`/PR #33 | 任务板不再停在 pr |
| 7 | 全量 gate + PR + CI + 双轴 review | `pnpm test` / `pnpm verify` 全绿;CI 绿;review 发现逐条裁决 |

## 5. 反向验证

- 删掉 README 表格里任一插件行 → T1 表格契约红。
- 把 CHANGELOG 注记改回 15 → T1 计数契约红。
- 把 deep-ptc README 头部版本改回 1.7.3 → T1 版本契约红。
- 删除 `docs/README.md` 或其中任一现行文档链接 → T1 地图契约红。

## 5.1 变更点(2026-11-11,实现中)

- **变更**:包内 README 也属于 bundle 内容,`pnpm verify` 的版本纪律要求升版本。原 §边界「不升版本」不成立,改为:
  `dsh-credential-vault` 0.6.0→0.6.1、`dsh-deep-ptc-mode` 1.13.1→1.13.2、`dsh-inventory` 0.12.2→0.12.3、
  `dsh-websearch-failover` 0.5.0→0.5.1,并在 CHANGELOG Unreleased 加四条条目。
- **理由**:版本纪律(AGENTS.md「改动了某个包就必须升它的版本号」)对包内文档一视同仁;不升会被
  `check-bundle-versions` 拦下。合并后需按常规打四个 tag。
- **追加(双轴 review 发现)**:`dsh-websearch-failover/package.json` 仍有 6 个指向已删除文件的死脚本
  (`test:install`/`build`/`build:check`/`plugin:dry`/`plugin:install`/`plugin:uninstall`),
  与本 PR 写的「已退役」冲突。已在 0.5.1 内删除,属打包元数据修正,无运行时行为变化。
- **不变**:不改插件运行代码、不改 profile、不重启 DSH。

### review 裁决(双轴)

- 轴1 #2 / 轴2 #3:旧计数 `5 linked bundle(s)` 漏改、计数契约对 `linked bundle(s)` 与「N 个包」形态漏检 → **采纳**:改 8 并扩正则到 `个|条|linked` + 分句级历史豁免。
- 轴1 #3 / 轴2 #7:「29 条各自有 tag」不实(`dsh-skill-surface@0.1.0` 无 tag)→ **采纳**:注记改为 28 条有 tag + 1 条历史缺 tag + 4 条待补。
- 轴1 #4:`docs/README.md` 把 `specs/` 同时列进现行与历史 → **采纳**:现行表移除 `specs/`,只留 `.flow/` 并注明运行时状态。
- 轴1 #5:历史声明指向不存在的 `prompt-inject/` → **采纳**:改指 `README-prompt-inject.md` 与 `lib-prompt-inject.js`。
- 轴1 #8 / 轴2 #5:地图契约只查字符串、不查文件存在 → **采纳**:逐个 `existsSync` 解析。
- 轴1 #7 / 轴2 #6:地图称「包 README 版本」被契约覆盖,实际只有 deep-ptc → **采纳**:收窄措辞;顺带去掉三处包内「8 个 bundle」硬计数。
- 轴1 #10:`update-checkout` 缺运行时/registry 快照 → **采纳**:补一行。
- 轴2 #1:`websearch` 的 `npm test` 实际只跑 3 个套件,README 列了 11 个 → **采纳**:按实际执行方式分段说明;未改 `scripts.test`(扩大执行面属代码/CI 变更,另开工单)。
- 轴2 #4:P1-9 说所有包 `engines.dsh` 都是 `^0.2.0`,deep-ptc 不同 → **采纳**:改为逐包事实。
- 轴2 补充:地图漏列 `FLOW.md` → **采纳**:补一行。

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 历史报告被误改成「现状」 | 只加顶部声明,正文原文不动 |
| update 文档再次被 profile 变化带偏 | 校准块写日期+commit+复核命令;正文旧数必须带「当时/历史」 |
| 包 README 写死测试数继续漂移 | 改用「覆盖范围」描述,不写死用例数;deep-ptc 只写版本与变更摘要 |
| profile 侧 ecc 未加载被当成文档问题 | 在 update-checkout 校准块与最终结论中显式标注「待用户决定」,不擅自改 profile |
