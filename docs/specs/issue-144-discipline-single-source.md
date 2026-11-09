# spec: 纪律文案单源化 + 谱系与检索纪律落盘(issue-144)

> 停点2 产物(经 DSH ask_user_question 确认,2026-11-09)。背景:纪律文本(order=20000 固定段)
> 的 zh 源在 governor-anchor.mjs 硬编码常量,en 源在 governor-copy.mjs COPY 字典,双源无守卫;
> 且该文本谱系不可发现,曾导致一次误归因(把本仓库迁移产物当成 /tmp 上游插件的个人化修改)。

## Tickets

1. **纪律文案单源化**(code):makeDisciplineText 的 zh 分支改走 governor-copy.mjs COPY 字典拼装;
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
