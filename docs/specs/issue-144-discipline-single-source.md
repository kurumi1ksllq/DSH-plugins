# spec: 纪律文案单源化 + 谱系与检索纪律落盘(issue-144)

> 停点2 产物(经 DSH ask_user_question 确认,2026-11-09)。背景:纪律文本(order=20000 固定段)
> 的 zh 源在 governor-anchor.mjs 硬编码常量,en 源在 governor-copy.mjs COPY 字典,双源无守卫;
> 且该文本谱系不可发现,曾导致一次误归因(把本仓库迁移产物当成 /tmp 上游插件的个人化修改)。

## Tickets

1. **纪律文案单源化**(code):execDisciplineText 的 zh 分支改走 governor-copy.mjs COPY 字典拼装(勘误:spec 初稿误写 makeDisciplineText,代码库中不存在该符号,#146 轴1 审查发现);
   EXEC_DISCIPLINE_TEXT 保留为 zh 基准常量(供契约测试对照);新增契约测试断言 zh/en 两条路径
   纪律全文同构(⓪–⑨ 条目一一对应、条数一致);反向验证:改坏实现测试必须变红(留证);
   dsh-deep-ptc-mode 版本号 +1(patch),CHANGELOG 记录。
2. **谱系速查**(docs):本 spec + 仓库 AGENTS.md 增「纪律文本谱系」段:
   真源 packages/dsh-deep-ptc-mode/lib/governor-anchor.mjs(zh 基准)+ governor-copy.mjs(双语字典),
   注入机制 systemPrompt.context order=20000,⑨ 引入 commit b2474a6(#96),#115 吸收、#120 拆模块、
   #138 locale 字典化;上游 dsh-cot-anchor v0.4.2(JiewiW,411cb74/005bb91)仅存于 git 调研史,
   /tmp 克隆已删;本机 link: 装入 ~/.dsh/profiles/web。
3. **全局检索纪律**(global-config,用户已批准):~/.dsh/AGENTS.md 增「检索纪律」三条:
   零命中≠不存在(grep -r 不下钻目录符号链接,零命中换 grep -R / realpath / 换根复验);
   作者/出处判断须落 git 记录或文件原文,双源交叉;易失路径(/tmp)证据先摘录哈希行号落盘。
4. **dev-flow 停点交互改造**(code):packages/dev-flow/SKILL.md 停点1/2/3 的「等用户回复」
   改为必须经 ask_user_question 在 DSH 内发起、给可选项(推荐项前置标 Recommended);
   用户范围裁定:仅改仓库 SKILL.md,不动全局 AGENTS.md 工作方式节;dev-flow 版本号 +1(minor),CHANGELOG 记录。

## 验收

- ticket1:zh/en 同构契约测试绿;改坏实现变红(留证进 spec);四件套绿
- ticket4:SKILL.md 三处停点均含 ask_user_question 强制条款
- 分支 issue-144-discipline-single-source;PR 进 main;CI 一次;双轴 review;merge 等用户口令

## 影响面

packages/dsh-deep-ptc-mode(lib + test + 版本 + CHANGELOG)、packages/dev-flow(SKILL.md + 版本 + CHANGELOG)、
仓库 AGENTS.md、本 spec、~/.dsh/AGENTS.md。不动行 id / cordis.patch.yml / .flow 格式。

## 执行记录

- PR: https://github.com/kurumi1ksllq/DSH-plugins/pull/146(commit b9004a7)
- CI: run 42597844565 — test success(2026-11-09)
- 反向验证:改坏 EXEC_DISCIPLINE_TEXT(硬编码副本复活)→ discipline-copy 1 fail / exit 1;还原 → 4/4 绿,文件字节级还原
- 测试环境:PATH 默认 node18 假红(import…with 语法不支持),全部经 /opt/dsh-runtime/node24(v24.15.0)执行

## 轴1 审查修复(#146 review,2026-11-09)

- P1: spec 符号名笔误勘误(makeDisciplineText→execDisciplineText)
- P2/P4: 本「执行记录+审查修复」段随 commit b08121a 及后续 commit 落盘;四件套证据:5 包测试(deep-ptc 170[含加强测试]/dev-flow 205/vault 227/inventory 494/websearch 20,均 node24)+根文档 74/74+verify×3 exit0
- P3: 契约测试 4→6 条:新增"每条非空+zh/en 条目数相等"与"discipline 键集合与拼装键集一致";双路反向验证:多键 mutation→1 fail,清空 mutation→2 fail,还原全绿
- P5: SKILL.md merge 闸改为单向规则(点选「merge 本 PR」等同口令;暂缓/返工/跳过均不授权)

## 设计变更记录（#146 轴2）

- 原设计「EXEC_DISCIPLINE_TEXT 保留为 zh 基准常量（供契约测试对照）」→ 实现改为 zh 派生值（execDisciplineFromDict("zh")），理由：避免第二份字面量复活双源问题。基线守护职责改由契约测试的 sha256 钉定承担（2940d3238c886f31…，改文案=有意变更须同步更新哈希并记 CHANGELOG）。
- 符号名勘误：初稿误写 makeDisciplineText，实际为 execDisciplineText（全 git 历史 -S --all 仅 spec 命中，#146 轴1/轴2 双轴发现）。
