# #154 dev-flow:规则常驻注入 + 只保留两次交互

- 分级:`standard`
- 关联:#154(本 issue);前史 #47(把 skill 塞进 bundle)、#144(停点改 ask_user_question)
- 本阶段会动:`packages/dev-flow/{index.js,lib/contract.mjs,lib/lint.mjs,SKILL.md→FLOW.md,package.json,cordis.patch.yml,README.md,README-git-status.md,client.js}`、
  `packages/dev-flow/test/*`、仓库 `AGENTS.md`、两处 `CHANGELOG.md`、本 spec 与 `.flow/154.json`

## 1. 实测现状(每条可复核)

| 事实 | 证据 |
| --- | --- |
| dev-flow 以「可选技能」加载 | `packages/dev-flow/index.js`:`inject=['skills']` + `ctx.skills.register({name:'dev-flow',…})` |
| 该技能在本会话不在目录里(**原因未定**) | `deep_ptc_tools skills` → 总数 270,搜 `dev-flow` = 0 条;profile 里 `link:` 与 `bundles` 都在,所以既可能被目录过滤,也可能该行未真正激活。两种原因下「靠技能路由」都不成立,但不要把原因写成已定 |
| 文件系统那一路也是死的 | `~/.dsh/skills/dev-flow -> /root/DSH-plugins/packages/dev-flow-skill`(目录已改名,死链) |
| 因此「改代码先走 dev-flow」无机制保证 | 仓库 `AGENTS.md` 只有一句话,没有注入、没有强制面 |
| 现有流程把技术判断交给用户 | SKILL.md:trivial 必须用户明示、裁剪要「用户点头」、无 CI 要问用户、review 等用户裁决、CI 两轮仍红升级用户 |

## 2. 目标设计

1. **常驻契约**:插件 `apply` 用 `systemPrompt.context` 注入一段短契约(name `dev-flow:flow-contract`,order `21050`,排在执行纪律 20000 / 委派纪律 21000 之后,`required: true`),每次组装都出现,不依赖技能路由。**删除 `ctx.skills.register`**。
2. **单一真源**:详细规程留在包内 `FLOW.md`(由 `SKILL.md` 改名,语义不再是 skill),契约文本里给出其绝对路径,进流程时读一次;不内联副本。
3. **两次交互**:① 意图确认(大白话);② 合并确认。中间全部自动。
4. **agent 自决清单**(必须写进契约与规程,且可审计):分级、阶段裁剪、无 CI(自动补最小 workflow)、CI 红(自修 ≤2 轮,仍红则**不合并**并报结论)、review 裁决(逐条「改了 / 不改+理由」)、spec 中途变更(记录后继续)。
5. **提问语言约束**:面向非程序员,决策项只能是「要不要 / 是不是这个意思」,不得把 `trivial/standard`、issue/PR/diff 这类术语抛给用户判断。

## 3. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 红:新增 `test/contract.test.mjs`,断言 `apply` 向 systemPrompt 注册 1 个 context(名字/order/`required`),正文含四条硬约束与 FLOW.md 绝对路径,且**不调用** `ctx.skills.register` | 先跑见红(现状只注册 skill);红线指向「没有 context 注册 / 仍有 skills.register」 |
| T2 | 绿:新增 `lib/contract.mjs`(`renderFlowContract`)+ 重写 `index.js`(`inject` 走 `ctx.inject(['systemPrompt'],…)` + `scope.effect`) | T1 全绿 |
| T3 | `SKILL.md` → `FLOW.md` 重写:3 停点改 2 次交互,删「用户点头 / 必须用户明示」,新增自决清单与提问语言约束;review 模板、TDD、状态文件章节保留 | `lintFlowDoc` 绿;反向改坏(删「两次」/ 加回「用户点头」)必须红 |
| T4 | `lib/lint.mjs` 改成两个契约:`lintFlowDoc`(章节 + 禁用措辞)/ `lintContract`(常驻契约硬句);测试迁移 | `pnpm -C packages/dev-flow test` 绿 |
| T5 | 包元数据与文档:`package.json`(0.5.0→0.6.0、`files`/`exports` 指向 FLOW.md)、`cordis.patch.yml` 注释、两个 README、`client.js` 的 boardSkillHint 文案、仓库 `AGENTS.md`(3 停点→2 次交互)、两处 CHANGELOG | `pnpm verify` 绿(含 `docs-contract`);`grep -rn 'SKILL.md' packages/dev-flow` 为 0 |

## 4. 边界

- 不动 `lib-git-status/*` 任务板逻辑(它读 `.flow`,与加载方式无关)。
- 不动 `.flow` 文件格式与枚举(面板协议)。
- 不改宿主包(`dsh-skill`/`dsh-system-prompt` 只消费,不修改)。
- 不重启 DSH:生效需重载,由用户决定。

## 5. 风险

| 风险 | 缓解 |
| --- | --- |
| 插件行若本就未激活,换通道也无效 | 交付前实测:用真实 `systemPrompt` 服务跑一遍 `apply`→`assemble`,确认文本进组装;并在交付说明里写明「需重载才生效」 |
| 常驻文本每轮吃 token | 契约压到 ~50 行;详细规程留在 FLOW.md 按需读 |
| 去掉 skill 后用户无法 `/dev-flow` 手动触发 | 规则常驻,不再需要手动触发;显式点名时 agent 读 FLOW.md 即可 |
| `systemPrompt` 服务缺失 → 行不激活 | 与 dsh-auto-delegation 同策略:`ctx.inject` 缺服务即保持 inactive,不抛错 |

## 6. 验收

- `pnpm test`(仓库全部包)与 `pnpm verify` 全绿。
- 反向验证:删掉 context 注册 → T1 红;把「两次交互」改回「三次」→ lint 红;把「用户点头」写回 FLOW.md → lint 红。
- 合并后打 tag `dev-flow@0.6.0`;更新线上 profile 需重载 DSH(需用户点头)。

## 7. 双轴 review 裁决(2026-11-10,PR #155)

两个独立 review 子代理(轴1 对 spec、轴2 对规范)共报 17 条,合并去重后逐条裁决如下。采纳即改,不采纳写明理由,全部记录在本节,不需要用户拍板。

| # | 发现 | 裁决 | 处理 |
| --- | --- | --- | --- |
| 1 | 根 README 仍写「先调用 dev-flow skill」且链到已删除的 `SKILL.md`(死链) | 采纳 | README 改口径与链接(指向 `FLOW.md`);`docs-contract` 增断言「README 不得链接 SKILL.md」 |
| 2 | 面板 `need_*` 文案仍说「需要你决定/裁决」 | 采纳 | `client.js` 六处改写:CI 红=已停止重推且本次不合并、review=agent 正在逐条裁决、意图=等你确认要做什么、合并=等你答是否合并;`cardAction` 改「需要你回话」 |
| 3 | `task-board.js` 仍把 no-ci / ci-red / review-pending 记入「需要你出手」 | 部分采纳 | 面板进度计算属 §4 边界,不改;本次只改文案与文档口径,另开 follow-up issue 收敛 needsUser 语义 |
| 4 | 常驻契约缺「禁测私有函数」「破坏性操作」两条硬约束,且禁用措辞只作用于 FLOW.md | 采纳 | 两条 marker 进 `CONTRACT_REQUIRED`;`FORBIDDEN_PHRASES` 同时跑在 `lintContract` 上;补反向测试 |
| 5 | 「真实 systemPrompt 组装」只在 commit message 自述,测试用自写 stub | 采纳 | 新增 `test/assembly.test.mjs`:宿主 `SystemPrompt` 可用时跑 `apply → assemble` 并断言 context 出现,不可用则 skip |
| 6 | `ctx.inject` 缺失时静默 return 无测试 | 采纳 | 增 `apply({})` 不抛的显式用例;取舍写进 §5 |
| 7 | 契约测试断言 effect 数量与标签文案(违「禁测私有函数」),order 断言同义反复 | 采纳 | 改为「一次注册 + disposer 可调用」与「text 是逐次求值的 provider」;删掉 `order === CONTEXT_ORDER` |
| 8 | 长度闸只数行,行长注水不受限 | 采纳 | 改按字符(`CONTRACT_MAX_CHARS = 1600`,当前 1029);测试改成同量字符注水 |
| 9 | 包 README 写「100 行」而实现是 70 行 | 采纳 | 改按字符上限,README 不再复述数字 |
| 10 | `review.state: pending-decision` 在面板里是 blocker,等于把裁决推回用户 | 采纳 | FLOW.md 改为裁决期间写 `running`;`pending-decision` 仅表示等用户知会;枚举不变 |
| 11 | 契约「只交互两次」与「破坏性操作先说明再问」、自检「停下来报告」自相矛盾 | 采纳 | 契约注明安全前置不计入两次交互;补齐自检失败时的处理(写缺口 + 一条命令,不阻断) |
| 12 | 无确认自动新增 `.github/workflows` 的权限面 | 采纳 | 契约限定 workflow 只跑 test/verify 且显式 `permissions: contents: read`,PR 描述点明 |
| 13 | `boardSkillHint` 键名残留旧语义 | 采纳 | 改 `boardFlowHint`,zh/en 两字典 + 测试同步 |
| 14 | `CONTRACT_MARKERS` 死导出、与 lint 清单两份真源 | 采纳 | 删除该导出,清单只留 `CONTRACT_REQUIRED` |
| 15 | `.flow/154.json` 停在 `spec` 与实况不符 | 采纳(已过期) | 当时确漏提交;之后每个节点都提交状态文件 |
| 16 | §验收「pnpm test 全绿」未达成 | 采纳(记变更) | 见下方「变更」 |
| 17 | 新文件标点半角、与仓库全角惯例不一致 | 不采纳 | 仓库没有标点契约测试;FLOW.md 混有 JSON/bash 代码块,批量替换有实义风险,收益仅观感。若要全仓统一,单开 issue |
| 18 | `required: true` 偏离 auto-delegation 先例,当前无抑制调用方,将来会不对称 | 不采纳(补注释) | 本插件存在的意义就是这段文本常驻;若将来真有抑制路径,宁可流程规则留存。已在 `index.js` 注释写明取舍 |

### 变更(相对 §3/§6 的验收口径)

1. `pnpm test` 不追求全绿:基线(origin/main 1471c87)在 `dsh-deep-ptc-mode` 已红 20 条、`ecc-agent-presets` 红 1 条,`test/verify-clean.test.mjs` 在无 `node_modules` 的干净 worktree 下也红 1 条;三处都在基线复现,与本改动无关。本次以「dev-flow 全绿 + 其余包不新增红 + `pnpm verify` 绿」为准。
2. T5 的 `grep -rn 'SKILL.md' packages/dev-flow` 为 0 改为「除 CHANGELOG 历史条目、契约测试里的反断言、本 spec 之外为 0」。
3. §1 的「270 个 skill 里没有 dev-flow」:观测可复核(命令与输出见上),但**原因未定**——profile 里 `link:` 与 `bundles` 都在,可能是目录过滤,也可能是该行未真正激活。结论不变(两条路都不保证路由),措辞已降级。
4. §4 边界未补 `task-board.js`:needsUser 语义调整交给 follow-up issue,本次只改文案与文档。
