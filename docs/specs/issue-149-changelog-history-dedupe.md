# spec: CHANGELOG 重复 Unreleased 段归位 + spec 命名补号

> 停点2 产物(经 DSH ask_user_question 确认)。上一轮(#147)双轴 review 遗留两项待办:
> 第二个 Unreleased 段与 spec 文件名惯例漂移。摸底发现比预期多一项内容级缺陷:两段有
> 2 条同名重复条目(dsh-git-bash-tool 0.1.1、dsh-websearch-failover 0.3.1)。

## 证据(2026-11-09 实测,main @ 587b90c)

- CHANGELOG.md 存在两个 `## Unreleased` 段:L13(17 条,当前批次)与 L160(19 条,#102-#105 旧批次,
  引入链 7b17dea/9d895be);其中 2 条与第一段同名重复,第二段版本更详实(带机制描述)。
- 契约测试 unreleasedSection() 已按「第一个 Unreleased 段」取作用域,多段并存不会假绿,
  但「第二段」的存在违反文件自身注记「待下一次统一归档至 History 段」的承诺语义,且读者无法
  判断哪段是权威待发布区。
- docs/specs/docs-maintenance.md(本轮已改名 issue-147-docs-maintenance.md)无 issue 号前缀(执行前状态);仓库内(排除自身)零引用;
  命名现状:带 issue- 前缀 11 个,不带 20 个(两种风格并存,本轮只补新文件,不批量统一存量)。

## 边界

- 只动 CHANGELOG.md、test/docs-contract.test.mjs、docs/specs/ 下两个文件名;不批量重命名 20 个存量 spec。
- 不改任何包代码 → 无版本号变更、无新 tag。
- 剔重原则(用户裁定):保留第二段详细版;第一段的 0.1.1/0.3.1 短版从 Unreleased 段移除
  (两者均已随 tag 发布,守卫只要求当前版本在第一段,不受影响)。
- GitHub issue #147 正文引用旧 spec 路径:随改名同步 gh issue edit 修正,避免死链。

## Tickets

1. **守卫先行(红)**:契约测试新增断言——CHANGELOG 全文件 `^## Unreleased` 恰好出现 1 次;
   运行确认红在「出现 2 次」上。
2. **归档归位(绿)**:第二段 19 条全部移入 `## History` 段顶部(剔重后 17 条唯一+2 条详版替代短版,
   计 17+2=19 条不变);第一段移除 2 条短版;第一段注记改写(不再有「待归档」承诺残留歧义);
   History 顶部加一行归档说明(来源批次 #102-#105,2026-11-09 归位)。T1 转绿。
3. **spec 改名**:docs-maintenance.md → issue-147-docs-maintenance.md(git mv);
   gh issue edit #147 正文路径同步。
4. **验收与交付**:pnpm test + pnpm verify 全绿;守卫反向验证(手工造第二段→红→还原绿);
   push→PR(Closes 本 issue)→CI 一次→双轴 review→merge 闸。

## 验收

- `grep -c '^## Unreleased' CHANGELOG.md` = 1;守卫断言可反向验证。
- 条目守恒(修订口径,经用户确认):两段 36→34(15 留 Unreleased + 19 归 History),全文件 ### 条目 67→65;
- docs/specs/issue-147-docs-maintenance.md 存在,旧名无残留引用;issue #147 正文链接有效。
- pnpm test / pnpm verify 全绿。

> 修订(2026-11-09,手术前自查):原验收行「变更后 36 条」与已确认剔重口径算术矛盾——短版被详版替代后
> 两段合计 34(15+19),全文件 67→65,2 条短版信息由详版承载无丢失。经裁决卡 q-spec-conflict-149 确认。
