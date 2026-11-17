# Issue #220 — credential-vault 在 deep-ptc 会话的使用指引修正

**grade**: standard(预计改 5–7 个文件,接口无变化,提示文案 + 一处注册)

## 调查结论(2026-11-18,证据落盘)

issue 原文的两条机制性断言经取证**均不成立**,真实缺口是「指引不精确导致模型误判」:

1. **hint 段其实已注入**。证据会话 `session-2fb16c46`(issue 证据来源,audit.log 15:48–16:36 UTC 十次 reveal)
   与 `session-860e5dd2`、`session-b9ef7417` 的 `session.v4.jsonl.zstd` 里,system message(92,580 字符,
   三会话同长)都含完整 hint 段(位于 3% 处)与 github-rope-token 索引行。模型在 idx 223 自报「上下文里没有」
   ——记录与自述矛盾,指向大系统提示下的小段被忽略(注意力/显著性问题),不是装配缺失。
2. **零明文注入通道其实可用**。2026-11-18 本会话实测:`use` 后 `await tools.bash({command:'test -n "$DSH_CRED_…"'})`
   返回 `injected-nonempty`。`dsh-shell-env` 只喂模型 shell 工具调用(bash/pwsh),run_code/PTC 进程环境
   **按设计**不携带 DSH_CRED_*。证据会话的模型只测了 run_code 的 process.env 与 execSync 子 shell
   (错误表面),从未测过 bash 工具,遂误判「注入失效」退回 reveal。
3. 通道有效性对照:deep-ptc 会话里 `systemPrompt.context`(纪律段/委派编排/dev-flow 契约)模型确实遵循;
   `section` 段(92KB 系统提示内)被忽略。=> 增加 context 短指针是实证有效的显著性修复。

## 方案

只改 `packages/dsh-credential-vault`(含测试),不动宿主、不动 deep-ptc-mode:

1. **use 返回说明写准**(index.js ~336):指名「模型 shell 工具调用(如 `await tools.bash({...})`)」;
   明说「run_code/PTC 程序的 process.env 及其子进程**按设计没有**该变量,勿用 process.env 验证」;
   「shell 工具调用里仍找不到变量 = 注入通道未接通,停下来告知用户,不得自行退回 reveal」。
2. **get 返回说明**(index.js ~255):点明 `action:"reveal"` 是审计过的逃生门,仅用户明确要求看值时使用。
3. **context 短指针**(lib/hint.js 导出常量 + index.js 注册):`dsh-credential-vault:pointer`,
   order 20900(exec-discipline 20000 与 task-dispatcher 21000 之间),三行静态文案:先查库再开口、
   use + shell 工具引用变量、reveal 仅限用户明确要求。
4. **对齐**:hint.js 规则 3 同步措辞;README「提示词约定」补 deep-ptc 边界一句;CHANGELOG 加 0.6.2 条目;
   版本 0.6.1 → 0.6.2。

## 边界

- 不改 hint section 的既有结构与索引行为(#56 语义不变)。
- 不改 env-injection 的注入机制(实测可用,不修不存在的问题)。
- 不动宿主 / deep-ptc-mode / 其它包;不重启 DSH 进程。
- 注册 `context` 采用与 `section` 相同的直接调用(宿主 dsh-system-prompt 服务固定提供两者);
  测试假 ctx 相应补 `context` 方法,不在生产代码里加 typeof 防御(不发明故障模式)。

## 验收

- 新测试:use note 含 tools.bash 指引 / process.env 边界 / 失灵上报三要点;get note 含 reveal 逃生门;
  apply 注册了 name=`dsh-credential-vault:pointer`、order=20900 的 context 且文案含关键短语
  (order/name 为对外协议常量,可断言);改坏实现时测试变红。
- 既有测试全绿(补假 ctx 后);`pnpm test` + `pnpm verify` 全绿。
- 本会话已实测的注入可用性不重复依赖测试(测试只测文案与注册,不依赖宿主 shellEnv 真注入)。

## 变更点

(留空,实现中如需调整在此追加)

- **测试基建**:11 处测试假 ctx 补 `context()`(生产代码不加 typeof 防御——宿主 dsh-system-prompt 服务固定提供 section+context,不发明故障模式)。
- **CHANGELOG 计数注记**:docs-contract 要求自述计数与 `### ` 条目数一致,新增条目后按注记惯例重算 62→63(59 tagged + 3 untagged + 1 repo-level)。
- **预存环境红对照**(与本改动无关,已在 HEAD 干净 worktree 复现):dsh-inventory `sync-issues-3-10` 两例时钟断言(0!==1)、dsh-task-dispatcher `synonyms-live` 与 ecc-agent-presets `bundle` 的 js-yaml 解析——三者在 HEAD(不含本改动)上同样失败;本 diff 与这三个包零重叠。
- **全量四件套口径**:以 `/opt/dsh-runtime/node24/bin/node` 直跑(系统 node 18 缺 `fs.globSync`,为环境性假红):dev-flow 249/249、vault 231/231、deep-ptc 175/175、skill-surface 108/108、websearch 29/29、repo-level 104/104 全绿;verify 三脚本全绿(workspace ok: 8 bundles / bundles ok: 8 checked,0.6.2 未打 tag 为合并后动作)。
- **gh 未认证**:按 FLOW 前置自检记录缺口;push/PR 经保险库 `use` 授权,在 bash 工具调用里以 `GH_TOKEN="$DSH_CRED_*"` 注入(零明文,只出现变量名)。
