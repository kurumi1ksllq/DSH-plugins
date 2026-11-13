# Changelog

## 0.7.1 — 2026-11-13

#199 修面板查不到 GitHub 数据。`gh` 默认靠读工作区 remote 判断查哪个仓库,而 `url.<镜像>.insteadOf` 会把 `https://github.com/` 改写成镜像地址(如 `https://ghfast.top/https://github.com/`),gh 认不出主机便**整条拒绝执行**,四个查询全部返回 `null`,面板退化成只用本地分支画卡,把早已合并的 issue 显示成「开发中」并给卡片标「状态过期」。

- 新增 `repoArgs(slug)`:`openIssues` / `openPullRequests` / `recentlyMergedPullRequests` / `prChecks` 全部带 `--repo <owner/repo>`。slug 取自 `git config --local`(不受 `insteadOf` 改写),因此不再依赖 gh 自己认 remote。
- `snapshot.js` 把 `repoSlug` 提前到 forge 查询之前计算并透传。
- 已合并窗口 `--limit 20` → 导出常量 `MERGED_PR_LIMIT` = 200:本仓库 86 条已合并 PR,20 的窗口让 `issue-145-*`(合并于 PR #193)这类较早分支失去合并证据。

实测(本仓库):`issues` 由 `null` → 2 条、`mergedPrs` 由 `null` → 86 条、dev 列由 21 张 → 1 张(真实的在做任务)、done 列 0 → 22 张。

新增 `test/gh-repo-arg.test.mjs`(5 条,假 gh 桩在缺 `--repo` 时复现真 gh 的报错)+`test/readme-git-status.test.mjs` 一条文档契约。全部经反向验证:去掉修复后新测试全红。

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
