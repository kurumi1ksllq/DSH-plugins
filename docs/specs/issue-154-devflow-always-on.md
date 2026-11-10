# #154 dev-flow:规则常驻注入 + 只保留两次交互

- 分级:`standard`
- 关联:#154(本 issue);前史 #47(把 skill 塞进 bundle)、#144(停点改 ask_user_question)
- 本阶段会动:`packages/dev-flow/{index.js,lib/contract.mjs,lib/lint.mjs,SKILL.md→FLOW.md,package.json,cordis.patch.yml,README.md,README-git-status.md,client.js}`、
  `packages/dev-flow/test/*`、仓库 `AGENTS.md`、两处 `CHANGELOG.md`、本 spec 与 `.flow/154.json`

## 1. 实测现状(每条可复核)

| 事实 | 证据 |
| --- | --- |
| dev-flow 以「可选技能」加载 | `packages/dev-flow/index.js`:`inject=['skills']` + `ctx.skills.register({name:'dev-flow',…})` |
| 该技能在本会话根本不在目录里 | `deep_ptc_tools skills` → 总数 270,搜 `dev-flow` = 0 条 |
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
