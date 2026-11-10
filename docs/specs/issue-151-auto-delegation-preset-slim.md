# Issue #151:自动委派编排 + Agent preset 精简(dsh-auto-delegation)

> 停点2 修订(2026-11-10,review 后确认):
> ① 白名单实现方式与原背景不同——**不改 preset.json**,由 `dsh-deep-ptc-mode/lib/model.mjs` 的 `DELEGATION_PRESET_WHITELIST` 在 derive 期确定性打点(preset.json 保持官方原样,check 门同步识别;理由:官方快照零污染 + 可反向验证)。
> ② §边界"严禁重启 DSH"存在**用户批准的一次性例外**(2026-11-10):重组合后 stall-governor 路由泄漏与白名单运行体未换新,行级 toggle 均无效,重启为唯一恢复路径;经过与证据见 `docs/specs/issue-151-deployment-log.md`。

## 背景(调研结论,已源码级核实)

- 主 agent 与 teammate 的委派工具来自 deep-ptc preset 的 `delegation` 组(`packages/dsh-deep-ptc-mode/lib/preset.json`:`tool-subagent`(spawn)+ `tool-subagent-fork`(fork));teammate 经 `composeFrom` 继承父组合,天然拥有委派工具(`dsh-subagent/lib/index.js:382`)。
- 模型面 `agent_preset` 参数枚举**只**来自 `dsh-tool-subagent` 的 `allowedAgentPresets` 白名单(`dsh-tool-subagent/lib/index.js:312-313`),与 roster 显示无关。
- UI 显示面共 4 处(Settings 卡片组 / 新会话 picker / 会话头标签 / Plugins 清单页),全部直读 `agentPresets/list`;registry `list()` 无条件全量返回,声明 schema 无 hidden/分组字段 → "注册在册但 UI 不列"不可行,唯一可行 = 改变"哪些 preset 注册"。
- patch 层无法向 preset 的 plugins 列表插行(preset 是运行时 JSON 注册的 `EntryGroup`,非 loader group),定向委派白名单必须改 preset.json 源文件。
- profile patch 现有 138 个 `preset-*` 行(4 个大 insert 块),是几百个 preset 显示的来源。

## 目标

1. **功能一(自动委派编排)**:新增 bundle `dsh-auto-delegation`,向所有会话成员(Lead 与 teammate 共享组合、同时生效)注入:
   - 委派纪律 context(先拆解→分档:单线程/委派/扇出/组队/对抗验证,含队友向下委派的显式授权,方案确认"先靠文本");
   - **声明式路由表 context**:列出可用子 agent preset(id → 职责 → 适用场景),模型按子任务内容选择 `agent_preset`——"AI 理解内容并决策"的依据。
   - 修改 `dsh-deep-ptc-mode` 的 preset.json:给 `tool-subagent` 行加 `allowedAgentPresets` 白名单,让 `agent_preset` 参数实际暴露。
2. **功能二(preset 精简)**:新建 bundle `ecc-agent-presets` 收编 ~128 个非常用 `preset-*` 行;主 profile 只留常用 preset;模型面路由表/白名单只引用留在 profile 的常用 id。需要时启用 bundle 整体回归。

## 边界

- 不修改 DSH 运行时/官方包任何文件(不做 client 侧 roster 过滤——网关拒绝覆盖 `agentPresets/list`,已实锤)。
- 不做二期角色区分渲染(Lead/teammate 不同文本),留待文本验证后评估。
- 功能二只动本仓库 bundle 与 profile 挂载(经 `plugin_manager install_bundle`),不手写 profile 文件;`~/.dsh/profiles/web/cordis.patch.yml` 的收编由 install/remove 流程完成,方向为"新 bundle 收编行 + 主 profile patch 相应删除"——**profile patch 文件本身不在本仓库,其改动属于部署侧操作,需用户在 DSH 内确认执行**。
- 严禁重启 DSH 进程;验证用 `cordis_inspect_query` / toggle 触发重组合。
- dev-flow 流程、停点、merge 口令照常。

## 验收

1. **A. 新 bundle 合格**:`packages/dsh-auto-delegation` 过 `pnpm verify` 三脚本 + `pnpm test`;engines.dsh 容纳 `^0.2.0`;scripts.test 非空;locale/icon/display checklist 齐(Host-only 也有 inventory 条目);仓库文档契约同步(README/AGENTS/CHANGELOG/update-scheme 计数、EXPECTED/SHIPPED 接线、lockfile)。
2. **B. 纪律 + 路由表注入生效**:install 后(不重启),`Config.listConfigs` 可见新行;`Tool.listTools` 不受影响;DSH 内观察 runtime-context 快照含 `dsh:auto-delegation-discipline` 段。
3. **C. 定向委派可用**:`dsh-deep-ptc-mode` 版本号升级;白名单 id 均为 profile 内已注册 preset;DSH 内实测 `subagent` 工具出现 `agent_preset` 参数(枚举=白名单)。
4. **D. preset 精简生效**:新 bundle 收编的 preset 行 install 后从 `agentPresets/list` 消失(4 个显示面全部);被收编 id 不进白名单/路由表;常用 preset 保留且委派引用正常;启用/停用 bundle 可回归/移除。
5. **E. 流程合规**:issue/分支/TDD 红绿循环/PR/CI/双轴 review/merge 口令全程执行;`.flow` 状态文件每节点更新。

## Tickets

| # | Ticket | 依赖 |
|---|---|---|
| 1 | 骨架:`packages/dsh-auto-delegation`(package.json/patch/index.js/locale/icon/test)+ 仓库文档契约接线 | - |
| 2 | 纪律+路由表文本模块(TDD):`lib/delegation-text.mjs`(zh/en 字典,可复用 governor-copy 双语字典模式)+ apply 注入测试 | 1 |
| 3 | preset.json 白名单:`dsh-deep-ptc-mode` 加 `allowedAgentPresets` + 升版本 + CHANGELOG | 1 |
| 4 | 功能二 bundle:`packages/ecc-agent-presets` 收编 preset 行 + 文档契约 + 部署侧(profile patch 收编)确认 | 3 |
| 5 | 装后验证:install_bundle → toggle 重组合 → inspect 三查 → DSH 内功能实测(A-D 验收) | 4 |

## 关键源码依据(复核入口)

- `packages/dsh-deep-ptc-mode/lib/preset.json` — delegation 组与 tool-subagent 行
- `dsh-tool-subagent/lib/index.js:312-313` — allowedAgentPresets → agent_preset 枚举
- `dsh-agent-preset-registry/lib/types/index.js:203-217` — list() 全量返回
- `dsh-agent-preset/lib/index.js` — 声明 schema 五字段,无 hidden
- `api-gateway/lib/client.browser.js` validateContribution — client 覆盖拒绝
- `dsh-deep-ptc-mode/lib/governor-apply.mjs:730-749` — systemPrompt.context 注入范例
- `~/.dsh/profiles/web/cordis.patch.yml` — 138 个 preset-* 行分布(4 个 insert 块)
