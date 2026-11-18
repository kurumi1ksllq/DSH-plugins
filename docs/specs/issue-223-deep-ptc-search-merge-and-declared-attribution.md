# issue-223:deep_ptc_tools 搜索分层短路遮蔽 + 工具归属依赖脆弱刮取

**分级**:standard(2 个 ticket,3 个包,行为契约变更)
**日期**:2026-11-18

## 背景(独立对抗验证(code-reviewer 角色子代理,会话 id 356c5adb-1fb8-45c8-8628-c16280f05435,非 git 对象)结论 + 主上下文逐条复核)

用户长期观察到 deep-ptc 会话里"自动拆分分发子 agent / 自动使用 skill"不可靠。诊断初期提出的
「external 死锁」定性被独立对抗审查推翻并经主上下文源码复核确认。真实缺陷:

1. **搜索分层短路**:`lib/tool-policy.mjs` `state.search` 按 external→official→unattributed
   顺序逐层搜索,一层命中即 return——官方 subagent 系工具命中后,unattributed 层的
   `role_search`/`delegate_role` 永远不出现在自然语言查询结果里(实测:
   search('delegate role subagent dispatch') 只回官方 3 条)。
2. **归属缺失→永不隔离**:`lib/official-names.mjs` 刮取器只读包入口文件
   (resolve→package main);task-dispatcher 入口 index.js 零注册字面量(注册在
   lib/role-tools.mjs 经 registerRoleTools 间接调用)→ role 工具 unattributed →
   `tool-policy.mjs:148` observe() 直接 return → 反复失败(如 js-yaml 损坏窗口期的
   MODULE_NOT_FOUND)永不隔离,模型盲调无保护。

背景事故(非本 issue 代码缺陷,已环境层修复):仓库 .pnpm 存储缺 js-yaml@4.3.2 实体,
三个包的 node_modules/js-yaml 悬空,delegate_role 在宿主内抛 cannot find module。
已用 pnpm install --frozen-lockfile --config.auto-install-peers=false 补齐。

## 目标

- **Ticket 1**:deep_ptc_tools search 三层合并为单一排序结果,每条带 layer/provider
  标注;任一层命中不再遮蔽其它层。隔离排除语义不变。
- **Ticket 2**:归属增加声明式通道——bundle 在 package.json 的 `dsh.toolNames` 数组
  声明 model-facing 工具名,official-names 读取并归入 provider 归属(刮取保留为回退);
  task-dispatcher 与 skill-surface 落声明。

## 顺序约束(对抗审查警告)

归属修复使 role 工具变 external(compact SDK 下隐藏直至 load);**必须与 Ticket 1
同批落地**,否则官方层短路依旧、工具又从 SDK 隐藏 → 制造真正的死锁。两 ticket 一个
分支、一次 PR。

## 变更面

- `packages/dsh-deep-ptc-mode/lib/tool-catalog.mjs`:searchCatalog 增加可选 annotate 参数
- `packages/dsh-deep-ptc-mode/lib/tool-policy.mjs`:search 三层合并
- `packages/dsh-deep-ptc-mode/lib/official-names.mjs`:readManifest 声明读取(可注入,默认解析 <module>/package.json)
- `packages/dsh-task-dispatcher/package.json`:dsh.toolNames 声明 + 版本 bump
- `packages/dsh-skill-surface/package.json`:dsh.toolNames 声明 + 版本 bump
- `packages/dsh-deep-ptc-mode/package.json`:版本 bump
- `packages/dsh-deep-ptc-mode/test/tool-compatibility.test.mjs`:合并语义新测试 + 声明归属测试;旧「分层」测试按新契约改写(变更点见下)

## 验收

- 查询同时命中官方与 unattributed/external 层时,单结果集内全部出现,带 layer+provider
- 隔离的工具仍被排除;分页确定性不回退
- 声明式归属:第三方 bundle 声明的工具名 → providerOf=模块名、isOfficial=false、
  失败可隔离;official bundle 声明 → isOfficial=true;非法声明忽略不崩
- `pnpm test` + `pnpm verify` 全绿
- unattributed fail-open 契约(test:325)不回退

## 变更点

- 旧测试「search first returns extensions, then admitted official equivalents after
  quarantine」断言的顶层 layer 字段是**被修的缺陷行为本身**,按合并契约改写
  (隔离排除行为保留断言)。search 输出从顶层 layer 变为逐条 layer/provider——
  该输出仅被模型消费与测试断言,无其它机器读者。
