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

## 0.7.1 — 2026-11-13

#199 修面板查不到 GitHub 数据。`gh` 默认靠读工作区 remote 判断查哪个仓库,而 `url.<镜像>.insteadOf` 会把 `https://github.com/` 改写成镜像地址(如 `https://ghfast.top/https://github.com/`),gh 认不出主机便**整条拒绝执行**,四个查询全部返回 `null`,面板退化成只用本地分支画卡,把早已合并的 issue 显示成「开发中」并给卡片标「状态过期」。

- 新增 `repoArgs(slug)`:`openIssues` / `openPullRequests` / `recentlyMergedPullRequests` / `prChecks` 全部带 `--repo <owner/repo>`。slug 取自 `git config --local`(不受 `insteadOf` 改写),因此不再依赖 gh 自己认 remote。
- `snapshot.js` 把 `repoSlug` 提前到 forge 查询之前计算并透传。
- 已合并窗口 `--limit 20` → 导出常量 `MERGED_PR_LIMIT` = 200:本仓库 86 条已合并 PR,20 的窗口让 `issue-154-*`(PR #155)与 `issue-158-*`(PR #159)失去合并证据——实测 dev 列残留的正是这两张。

实测(本仓库,修复前后各跑一次):`issues` 由 `null` → 2 条、`mergedPrs` 由 `null` → 86 条、dev 列由 23 张 → 1 张(真实的在做任务)、done 列 0 → 22 张。dev 列的绝对值取决于本地还留着多少 `issue-*` 分支,关键是修复后它只剩真正在做的那张。

新增 `test/gh-repo-arg.test.mjs`(13 条,假 gh 桩在缺 `--repo` 时复现真 gh 的报错)+`test/readme-git-status.test.mjs` 一条文档契约。反向验证按「只回退修复、保留导出」逐个定向破坏,每个破坏都有对应测试变红(端口解析、upstream 优先级、slug 形状闸、`prChecks` 透传、合并窗口收益、snapshot 回退 origin-only)。

- **review 后补三处**(轴 A 报 3 条 P1,均复现属实):① `slugFromRemoteUrl` 把 `https://github.com:443/me/repo` 解析成 `443/me/repo`——修复前只坏一条深链,slug 开始指名查询目标后会变成「查一个不存在的仓库」,比不传更糟,已接受并消费端口、并给 `repoArgs` 加「只放行恰好 `owner/repo`」的闸;② 门禁(`forgeHintFor` 接受任意 remote)与 slug(只读 origin)用两套规则,origin 非 GitHub 时门禁放行却拿不到 slug,等于没修,已抽出唯一出口 `forgeRemoteOf`;③ 强制 origin 会覆盖 gh 自己的选择——实测 gh 2.62.0 优先选名为 `upstream` 的 remote(fork clone 的 PR 在上游),现按 `upstream → origin → 任意可解析` 排序。


- **用户可见行为变更**(review 轮引入,需在发布说明里点明):① `upstream` 优先于 `origin` —— fork clone 的查询目标从自己的 fork 变成上游真仓库(与 gh 自身选择一致);② URL 里的显式端口被消费,`https://github.com:443/me/repo` 不再被解析成 `443/me/repo`;③ slug 必须是恰好 `owner/repo` 形状,否则不传 `--repo`(宁可让 gh 自己解析,也不拿错仓库去查)。

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
