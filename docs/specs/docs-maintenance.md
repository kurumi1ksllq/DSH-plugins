# spec: 文档维护——版本纪律补账 + 任务板翻终态 + 结构补全

> 停点2 产物(经 DSH ask_user_question 确认)。起因:只读文档体检发现三类漂移
> (CHANGELOG 缺 #144 两条发布条目、10 个 .flow 状态停滞但合并证据齐全、
> AGENTS.md 目录表漏列 docs/update-*.md),外加用户裁定删除的 REVIEW-FIXES.md。

## 决议记录(停点1,2026-11-09)

- 范围:A+B+C 全套 + 防再漂移守卫;分级 standard。
- REVIEW-FIXES.md 处置:**用户明确选择「删除」**(git rm,历史可追溯)。
- 守卫测试:**用户明确选择「加」**(docs-contract 契约断言 CHANGELOG 必须含每个包当前版本号)。

## 证据(全部双源核验,2026-11-09)

- 版本纪律缺口:dsh-deep-ptc-mode@1.11.2 与 dev-flow@0.5.0 由 cab5801(PR #146,#144)合入,
  CHANGELOG Unreleased 无条目、无对应 tag;Unreleased 现存 15 条全部已有 tag,
  注记「1.11.1 待打 tag」已过时(该 tag 已存在)。
- .flow 停滞 10 个,合并证据(git merge-base --is-ancestor <sha> main 全部 IN_MAIN):
  #26→3ee13aa(PR #27) #30→merge 9848633(PR #31) #34→54b61c0(PR #35)
  #39→6ec6c14(PR #40) #45→6d194f6(PR #46) #48/#50→4672d74(PR #63)
  #60→0a5ab92(PR #61) #118→510fb49(PR #119) #143→e773266(PR #144)。
- 结构:AGENTS.md 目录速览表缺 docs/update-checkout.md、docs/update-scheme.md 两行(README 有引用);
  REVIEW-FIXES.md 为 2026-10-31 旧机一次性 review 记录(内含 E:\Project-hub 旧路径),git 跟踪文件,无引用。

## 边界

- 不改任何包代码 → 无版本号变更、无新 tag(除补打的两个既有版本 tag)。
- 不动 34 个未合并本地分支;不重写历史;不重启 DSH 宿主。
- .flow 翻转只依据上表已核验证据;证据不足的条目(无)一律不翻。
- 执行前置:gh 未认证。vault 存在 github-rope-token(经 credential action:"use" 下发环境变量名
  DSH_CRED_GITHUB_ROPE_TOKEN,值不入对话)。若 token 注入或 gh 操作失败 → 不重试超过 2 次,
  改为把精确 gh 命令交用户在终端自行执行,流程不静默跳过 issue/PR 环节。

## Tickets

1. **守卫测试(红)**:test/docs-contract.test.mjs 新增断言——遍历 packages/*/package.json,
   要求 CHANGELOG.md 含 `<name> <version>` 字样;运行确认红在「1.11.2/0.5.0 缺失」上。
2. **CHANGELOG 补账(绿)**:Unreleased 补 dsh-deep-ptc-mode 1.11.2 与 dev-flow 0.5.0 两条
   (体例对齐既有条目,引 #144/PR #146);注记改写为「17 个条目,全部已随各自 tag 发布」;
   T1 转绿。反向验证:删任一版本字样该测试必红。
3. **任务板翻终态**:10 个 .flow 文件 stage→done、merge.authorized→true、updatedAt 刷新,
   note 记 merge 证据(PR 号+merge sha);依据「合并后即终态,历史板面只保留未交付项」。
4. **结构补全**:AGENTS.md 目录表补 docs/update-checkout.md(权威 checkout 运维记录)与
   docs/update-scheme.md(插件更新方案)两行;git rm REVIEW-FIXES.md。
5. **tag 补账**:main HEAD(36251d9)补 tag dsh-deep-ptc-mode@1.11.2、dev-flow@0.5.0,
   随停点3 push 一并推送。
6. **验收与交付**:pnpm test + pnpm verify 全绿;push→开 PR(Closes 本 issue)→查 CI 一次
   →双轴 review→merge 闸。

## 验收

- pnpm test / pnpm verify 全绿;新守卫断言可反向验证(去掉任一包版本字样即红)。
- CHANGELOG Unreleased 含全部 5 个包的当前版本条目;两个缺失 tag 已补。
- 10 个 .flow 文件 stage=done 且 note 含可核验 merge 证据。
- AGENTS.md 目录表覆盖 docs/ 全部现存文档;REVIEW-FIXES.md 从工作树移除。
- git status 干净(分支上),无越界改动(对照 §边界)。
