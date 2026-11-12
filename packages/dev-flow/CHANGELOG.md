# Changelog

## 0.8.0

#197 Git 面板从左侧栏移到**右侧栏**:删掉 `sidebar.panellist` 入口与占满主区的 `main` 整页,
改为右侧栏 tab 类型(`ctx.sidebarRightTabs.register`,kind `git-status`,id `dev-flow/git-status`)
+ `sidebar.right.pane.tab` / `.title` 两个 keyed 座位(按 id 而非 kind,key 错则静默不显示)。
guide 入口卡 order 40,排在文件/终端/浏览器之后。

面板内容不变(八列任务板、需要你出手、未进流程、仓库实况、刷新),布局改为**纵向堆叠**:
右侧栏最窄 300px,八列横向并排会全部藏进横向滚动条。`sessionId` 改用宿主的 session 作用域
标准 props,删除 `retainedSessionId` 反查与「返回对话」按钮。

`dsh.client.inject` 从 layout/sidebar/locale 收敛为 sidebar-right/locale。
新增 `test/client-right-sidebar.test.mjs`(含三条反向验证:正文 key 改 kind、左侧入口写回、
板面改回横向滚动,各自变红)。

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
