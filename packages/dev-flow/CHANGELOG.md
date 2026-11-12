# Changelog

## 0.8.0

#197 Git 面板从左侧栏移到**右侧栏**:删掉 `sidebar.panellist` 入口与占满主区的 `main` 整页,
改为右侧栏 tab 类型(`ctx.sidebarRightTabs.register`,kind `git-status`,id `dev-flow/git-status`)
+ `sidebar.right.pane.tab` / `.title` 两个 keyed 座位(按 id 而非 kind,key 错则静默不显示)。
guide 入口卡 order 40,排在文件/终端/浏览器之后。

面板内容不变(八列任务板、需要你出手、未进流程、仓库实况、刷新),布局改为**纵向堆叠**:
右侧栏最窄 300px,八列横向并排会全部藏进横向滚动条。`sessionId` 改用宿主的 session 作用域
标准 props,删除 `retainedSessionId` 反查与「返回对话」按钮。

**修掉一个会被误读成「标签页是空的」的缺陷**:宿主把 tab body 画在 `overflow: hidden` 的 pane 里
(dock kit 拥有 pane,body 不能滚动它),而原 `S.page` / `S.pageWide` 没有 `overflowY` ——
内容被裁掉且没有滚动条。两个根样式补 `height:100%; overflowY:auto`,空态/错误态/板面都自带滚动轴。
chip 标题也从 `<span style="display:contents">` 改为 `React.Fragment`(宿主 `GuideTitle` /
`FilesTitle` 同款:chip 的盒子由 dock kit 提供,多包一层会引入它不预期的布局盒)。

**修掉一个渲染期崩溃**(既有缺陷,`main` 上同样可复现):6 处 `t(key, a, b)` 把参数塞进第二实参,
而宿主 `translate()` 对函数型词条执行 `template.replace(...)` → `TypeError`,renderer 错误边界兜住后
标签页退化成空壳(「看起来是空的」的另一个成因)。统一改为同文件既有的一段式 `t(key)(a, b)`。

**其余 review 收尾**:`priority` 改 `extension`(本包从产品外安装,`builtin` 会在未来出现同 kind 产品类型时
注册期抛错而非被优雅覆盖);`S.card`/`S.cardTitle` 重名覆盖导致 RepoFacts 拿到任务板卡样式,已拆成
`boardCard`/`boardCardTitle`;`cardMeta` 加 `overflowWrap:anywhere` 且两个页面根加 `overflowX:hidden`
(分支名是单个不可断 token,300px 栏会横向滚动);无 `sessionId` 时给出「可能显示的是宿主启动目录」的提示
(此前静默展示另一个仓库);删死词条 `needsUserEmpty`,头注释的 28px 标题描述按实际 18px 改写;
`key` 用 `kind` 的后果措辞改准(宿主画 `tab.unavailable` 提示,不是空白)。

`dsh.client.inject` 从 layout/sidebar/locale 收敛为 sidebar-right/locale,并加集合相等守护。
新增 `test/client-right-sidebar.test.mjs`(9 条,反向验证口径见根 CHANGELOG)。

## 0.7.0 — 2026-11-10

#157 任务板「需要你出手」收敛:`NEEDS_USER_KINDS` 只剩 `intake-confirm` 与 `merge-gate`;无 CI、CI 红到第 2 轮、review 报告不再作为用户待办(仍显示在卡片证据行)。删除三个 `need_*` 文案与 `CI_MAX_ROUNDS` 导出。

## 0.6.1 — 2026-11-10

#161 修 patch 形态:`cordis.patch.yml` 从裸 `- id:` 改为 `- insert:`。旧写法被宿主当作"修改已存在的行",报 `entry not found` 后跳过,导致本包两行从未挂载(#154 的常驻契约与任务板面板因此静默失效)。新增 `test/patch-form.test.mjs` + `test/patch-mounts.test.mjs`(用宿主真实 `applyPatches` 验证,含负例)。

## 0.6.0 — 2026-11-10

#154 规则常驻注入:向 systemPrompt 注册 `dev-flow:flow-contract`(order 21050,`required: true`),不再注册为技能;
停点 3 → 两次交互(意图 / 合并),其余技术判断由 agent 自决并留证;`SKILL.md` 改名 `FLOW.md` 作为规程全文。
lint 拆成 `lintFlowDoc` + `lintContract`,并修掉章节重复检测漏 `g` 标志的漏检。

## 0.5.0 — 2026-11-09

#144 停点交互改造:停点1/2/3 确认一律经 DSH ask_user_question 发起(详见 SKILL.md 提问通道条款)。
