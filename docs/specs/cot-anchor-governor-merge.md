# spec: dsh-cot-anchor + dsh-step-governor 合并为单一插件(设计文档,供后续实现)

> 停点2 产物。本文档**只是设计与调研结论,不含实现**。用户要求:合并两个上游插件为一个新插件,
> 并入本 monorepo(packages/ 成为第九个 bundle),插件代码由用户后续自行编写。
> 调研基线:dsh-cot-anchor v0.4.2(411cb74 后,单 commit 克隆)、dsh-step-governor v0.2.2,均已 clone 至
> /tmp/dsh-cot-anchor、/tmp/dsh-step-governor。

## 0. 两个上游插件是什么

| | dsh-cot-anchor | dsh-step-governor |
| --- | --- | --- |
| 治什么 | 单次生成流内的退化(伪工具调用/字节复读/打转/转折空转/数字流) | 跨步骤空转(无交付步/结论重推/同目标反复失败) |
| 手段 | `agent/soft-cut` 中途切断 + 结论锚点回灌 + 纪律固定段 | `agent/pre-step` reject / `tools/pre-execute` deny 硬熔断 |
| 体量 | lib/index.js 5413 行 + client.js 711 行 + 8 份文档 | lib/index.js 1424 行 + client.js 599 行 |
| 默认形态 | 结论注入开、软切需内核移植 | shadow(只观测不拦截) |
| peer 窗口 | `>=0.1.5-rc.1 <0.2.0 \|\| >=0.2.0-rc.1 <0.3.0-0` | 同左 |

姊妹关系(README 自述):cot-anchor 管**单步边界内**,governor 管**跨步骤**;长任务账单大头是
「步数 × 每步膨胀的上下文重读」。合并动机:两者共享同一套工程方法论(确定性判据、shadow 灰度、
fail-open、有界预算、事故夹具回归),且 governor 已经在消费 cot-anchor 移植段的事件契约
(`agent/soft-cut-suppressed`),事件闭环本就跨插件存在。

## 1. ⚠️ 先读:README 与代码的偏差(以代码为准)

调研中交叉核实出的关键偏差,实现时**不得照 README 写**:

| README / 旧文档说法 | 代码实际(v0.4.2 / v0.2.2) | 影响 |
| --- | --- | --- |
| cot-anchor「每次工具结果后注入结论锚点,装上默认生效」 | **结论注入主路径已移除**。`tools/post-execute` 只剩 ToolArgsError/INVALID_ARGS 恢复指引注入(lib/index.js:5379-5410);`agent/pre-step` 只探测上报、未注册(D9,L113/L4257)。原因是生产中观察到「模型回声已注入锚点 → 提取器再收割 → 再注入」的自反馈环(P1-5,L5306 注释) | 合并文档若按 README 设计"锚点回灌"主功能就错了;真正的现役能力是:软切判定器 + INVALID_ARGS 恢复注入 + 纪律固定段 |
| step-governor「5 个触发器、14 项设置」 | 触发器实际更多:G1-A 有三个子判据(硬零 L766 / 只读空转 L770-773 / 滑窗失速 L885-893),另有软停优先策略(v0.2.2 新增:G1 首次命中只投收尾指令,再犯才硬拦,L1253-1279) | 阈值面更大,合并时按代码枚举 |
| 「与 pre-step 钩子共存待核实」(step-governor README L96) | cot-anchor 现役**不注册** `agent/pre-step`,冲突顾虑自然消解;但合并插件自己注册后,与 goal 自动续跑驱动的交互仍是**未验证项** | 列入验收前置 |
| docs/events.md 的 reflow/post-execute 注入口径 | 旧路径口径,已过时 | 合并后的事件登记要按现役代码重写 |

版本注意:RELEASE-NOTES 只覆盖到 v0.3.0,v0.4.x 的变更只体现在代码注释(P0-1/P1-5 等)。

## 2. 合并后的插件形态(建议)

### 2.1 定位与命名

- 单包双引擎:同一 host(index.js)内分两个独立模块边界——「单流内」(源自 cot-anchor)与「跨步骤」(源自 governor),共享装配、设置、client、事件设施。
- 包名建议 `dsh-stall-governor`(或 `dsh-anchor-governor`);cordis.patch.yml 行 id、`PLUGIN_SOURCE.kind = "plugin:<新包名>"` 一并统一。**内核识别靠这些 id,不得复用旧名挂新逻辑**。
- 新路由/持久化/槽位全部用新 id:`/plugins/<新名>/settings`、`storages/<新名>.json`、settings.section order 取 997(两上游分别是 998/996,新包避让)。

### 2.2 能力矩阵(合并后保留什么)

| 能力 | 来源 | 建议保留度 |
| --- | --- | --- |
| 软切五判定器 + overLongCoT 兜底 | cot-anchor L5069-5374 | **保留**,整体搬运;预算 6/20/3 仍在内核移植段,插件回 budgetClass(预算桶名)与 cutClass(内核 softCutBudgetKey 可识别名),三分支映射冻结:pseudoTool→confirmed-pseudo/pseudoTool,repeat/numberRunaway→confirmed-repeat/confirmed-repeat,churn/transition/external→heuristic/heuristic(勘误:原「两字段同值」与上游代码不符,2026-11-07 review 裁决) |
| INVALID_ARGS 恢复指引注入 | cot-anchor L5379-5410 | **保留**(现役唯一 post-execute 注入) |
| 命令执行纪律固定段 | cot-anchor L891-901/L4289 | **保留**,order=20000 不变 |
| 结论提取器 extractConclusions 及 Tier1/Tier2 打分 | cot-anchor L462-516 | **保留**——虽然注入主路径已移除,它仍是软切 transition 分支的回流前置;不建议擅自恢复"每工具结果注入"主路径(那就是把已知自反馈事故重新引入) |
| LLM 提炼 / CoT 采集(harvest)/ 学习模式 | cot-anchor L2644-3411 | 默认全关,可整体搬运或**砍掉**(三选一砍最重:省 ~800 行 + 一个路由)。砍的话保留 extractConclusions 依赖的常量即可 |
| G1-A 三子判据 + G1-B 指纹 + G1-C 硬顶 | governor | **保留**,全部纯逻辑可搬 |
| G2-A/G2-B + 目标键归一化 + 终态豁免 | governor L298-474/L915-916 | **保留** |
| semantic-watcher 服务接入(stall-2/stall-3) | governor provide 服务 | 视生态:有真实 watcher 再保留,否则可简化为预留接口 |
| 看门狗 heartbeat | governor L1328 | 依赖未定契约(PENDING_DEPENDENCIES 三项),合并后从 PENDING_DEPENDENCIES 摘除或清空 |

### 2.3 关键合并点(两份深读报告的交叉结论)

1. **`agent/soft-cut` 单点决策**:若两个引擎都注册该钩子,会共享同一 6/20/3 预算桶且 waterfall 链需重审。合并后应单点返回 cut 决策,统一 cutClass 分类;governor 的 `agent/soft-cut-suppressed` 消费(高置信类升级 reject)在同一进程内闭环,契约测试必须保留(payloads.test.mjs:173-188)。
2. **「挂起 + 钩子现场消费」模式统一**:governor 的 pendingReject 与 cot-anchor 的外部软切挂起表(EXTERNAL_SOFT_CUT_TTL_MS=30s,L3776)是同一模式,天然统一点。
3. **`ctx.provide("cotAnchor")` 有外部依赖**(dsh-derive-watcher 调 requestSoftCut):合并包必须保留同名服务或确认迁移调用方,否则静默破坏下游。
4. **systemPrompt.context order 唯一**:合并后只注册一个纪律段(20000),不得撞其他段。
5. **soft-cut 钩子按探测注册**:probeKernelHook 返回 absent 时不注册(L5068),unknown 时照注册(宁留回调)——能力探测是硬要求,见 §3 模式清单。

## 3. 必须原样继承的健壮性模式(合并时不回退)

按「上游踩过的真实事故」整理,逐条都有事故出处:

1. **注入消息契约三件套**(cot-anchor 头注释 L10-19 + L46-66):
   - 每条 additionalContext 必须 `id: randomUUID()` 且 deepFreeze,否则 agent-loop 报 `"undefined" is already pending`;
   - source.kind 必须是 `plugin:<name>` 标准形态,笼统 `kind:"plugin"` 会被 v4 行级准入 assertV4SourceRowAdmission 抛 SessionFormatError(2026-10-05 事故);
   - webServer 路由必须在 apply 期经 `inject=["webServer"]` 就绪,apply 内软解析会让设置页静默 404。
2. **fail-open**:两个钩子体整体 try/catch,catch 记 `{at, failOpen:true, error}` 后 `return next()` 放行(governor L1203-1206/L1290-1293);cot-anchor 侧「宁可不切」:超长点整条保留只发事件(L510-515)、去重命中不切(L5356)、守恒/配平失败弃注入(L5328-5345)、emitCotAnchorEvent 永不抛(L657-664)。
3. **分类有界预算**:6(heuristic)/20(confirmed-repeat)/3(confirmed-pseudo)由内核移植段持有,confirmed-pseudo 耗尽 hard-abort;外部请求固定占 heuristic 额度,防止外部干预引发硬中止(L5089-5106)。原则:**所有配额必须有界,禁止无限额,按置信度分桶**。
4. **自反馈三防**:跳过自家注入消息(L4519 source.plugin 判定);检测副本剥离已注入锚点(stripInjectedAnchors L4074);伪工具锚刻意不复述原始标签(L2213)。governor 侧对应:插件 spliced 注入不清账目、`d.source?.kind==="user"` 才视为真人(test-governor-logic.mjs:303-309)。
5. **内核能力探测**:probeKernelHook(L130-155,createRequire 读 dsh-agent-loop 源码查钩子字面量)→ present/absent/unknown;absent 不注册 + 启动 warn + 设置页如实上报。**钩子被上游移除后静默失效是真实发生过的事故**(0.1.5-rc.3 移除 agent/soft-cut)。
6. **跨 turn 隔离**:governor turn/start 清零全部账目(L635-664);软停 softStopTurn 按 turn 记录(L1272);cot-anchor churn/overLong 计数按 assistant/message 的 data.turn 归零(L4999-5006)。
7. **deny/reject 文案三要素**(governor P1-16):触发规则与计数口径 + 当前步序 + 合法继续出口;info 按分支构造防 undefined 字段(P1-19:内核对 undefined 判非 losslessly serializable,deny 文案会被 TypeError 吞掉)。
8. **事件载荷四元组**:sessionId/turn/step/evidenceSeq,evidenceSeq 模块级单调、同源多事件共享(L628/L640-647);字段缺省置 null 不省略。
9. **有界内存**:全部会话态 Map 有界 + LRU(governor maxSessions + LRU 淘汰 L994-1013;cot-anchor 锚点 hash 32/256、refineCache 96)。
10. **目标键空串兜底**(governor P1-21):全字段取不到时 `#args:<fnv1a(stableStringify)>`,绝不退化空串——否则同工具全部调用塌成同一键,G2-B 一旦命中永久拦截、改参数也无法脱身。

## 4. 并入 monorepo 的工程要求(按本仓 AGENTS.md + deep-ptc-integration.md 先例)

1. 新包 `packages/<新名>`:自描述 bundle,`dsh.bundle.patch` 指向 cordis.patch.yml;包名/行 id/patch 的 `- id:` 一律按上游风格保留不动。
2. peerDependencies 延续上游窗口(`>=0.1.5-rc.1 <0.2.0 || >=0.2.0-rc.1 <0.3.0-0`);注意移植脚本(apply-softcut-port.mjs)只支持原始 0.2.0-rc.2(版本 + SHA256 自检),软切能力在未移植内核上会按 §3-5 探测后如实降级。
3. 登记八件套(照 deep-ptc-integration.md ticket 清单):`verify-packages.mjs` EXPECTED、`check-profile.mjs` SHIPPED、README/AGENTS/CHANGELOG/docs 计数 8 → 9、docs-contract.test.mjs 断言、pnpm-lock importer。
4. 版本纪律:新包从 0.1.0 起,改动即升版本,`check-bundle-versions` 会拦。
5. 测试体系:不照搬上游根目录散装 `test-*.mjs`,用本仓 `node --test`;但**测试设计照搬**(见 §5)。

## 5. 测试设计(直接可搬的模式)

| 模式 | 上游出处 | 搬运方式 |
| --- | --- | --- |
| 伪内核 waterfall ctx | governor test/integrity-runner.mjs(92 行:createCtx on/emit 链 + console.warn 劫持 + 子进程 mode 矩阵) | 原样搬进 `test/`,配合 `node --test` |
| 事故夹具回归 | cot-anchor test-incident-replay.mjs + 脱敏夹具;governor 黄金回放(step28-30 报警 + 正常浏览零报警) | 反事实(若钩子在,复读于 19,360 字符截停,省 75.3%)固化为断言 |
| 黄金键 baseline | governor test/old-keys-baseline.json + compress-targetkey.test.mjs | 目标键归一化的键值快照回归 |
| 契约形状负对照 | governor payloads.test.mjs(自排除两种契约形状含负对照) | deny 标记在事件 data 顶层 error.info.plugin(**不在 message 层**,历史 bug) |
| fail-open 验证 | test-integration.mjs:61-65(GOVERNOR_BAD_PAYLOAD=null payload) | 每个钩子至少一条 null/坏 payload 断言 |
| 设置 schema 驱动 | settings.test.mjs(GET 全量、clamp、env>json>默认) | schema 数量断言(合并后项目数会变,断言按新 schema 定) |

**必须保留的契约测试**:soft-cut budgetClass/cutClass 三分支冻结映射(pseudoTool→confirmed-pseudo/pseudoTool 等,见 §2.2 勘误);`agent/soft-cut-suppressed` 载荷契约;终态豁免词元表不外溢;G2 滑窗衰减与 turn 隔离;伪工具锚不复述标签。

## 6. 未决项 / 未验证(实现前须逐条处理)

1. **最终包名**与 cordis id、路由前缀、settings.section order——本文档用占位,实现时定死。
2. **agent/pre-step 与 goal 自动续跑驱动的并存顺序**:上游自己标注"待核实";合并插件注册 pre-step 后须用双插件伪内核实测软停→硬拦链路,未验证前 G1 建议保持 shadow。
3. **是否保留 harvest/学习模式**(~800 行 + 1 路由):建议砍,给用户决定。
4. **dsh-derive-watcher 依赖**:`ctx.provide("cotAnchor").requestSoftCut` 是否有真实调用方需要确认;保留或迁移。
5. **PENDING_DEPENDENCIES 三项**(watchdog 出站 API / 心跳事件名 / soft-cut-suppressed 载荷契约):合并后子卡 C 的角色由本包承担,依赖应消除而非照抄。
6. **预算在内核移植段**这个前提:合并插件仍依赖 tools/apply-softcut-port.mjs 移植内核;若用户环境不移植,软切引擎零生效(结论注入/INVALID_ARGS 恢复不受影响),设置页能力横幅三态展示必须如实。

## 7. 建议 Tickets(供用户后续 dev-flow 立项时参考)

1. 定名 + 骨架:package.json / cordis.patch.yml / inject / provide / 路由前缀 / 持久化文件。
2. 搬 governor 引擎:G1/G2 纯逻辑 + 目标键 + 软停策略 + 设置 schema 合并(14 + 66 项按 §2.2 裁剪后合并,新前缀)。
3. 搬 cot-anchor 引擎:五判定器 + INVALID_ARGS 分支 + 纪律段 + 提取器;统一 soft-cut 单点决策。
4. 事件层:统一四元组 + evidenceSeq;清理死事件常量(cot-anchor 有 5 个已声明未发射:anchor-injected / softcut-inbox-resumed / invalid-args-dedup-skipped / invalid-args-recovered / anchor-injection-suppressed)。
5. client.js:两个 700/600 行设置页合并为一个 schema 驱动页(手写 `window.__ModuleLoader__.load({id,factory})` 壳不能少,裸顶层 return 会炸 client bundle;仅用 `--dsw-alias-*` 主题变量)。
6. 测试:按 §5 搬运骨架 + 契约测试;先红后绿。
7. monorepo 登记八件套 + `pnpm verify && pnpm test` 全绿。

## 附:两个上游的钩子/服务/事件全景(实现时对照)

**cot-anchor(v0.4.2 现役)**
- 模块级 `inject=["systemPrompt","webServer"]`;`ctx.provide("cotAnchor",{requestSoftCut})`
- ctx.on:`session/event`(turn 边界归零 + 喂采集)、`agent/soft-cut`(仅 probe≠absent)、`tools/post-execute`(仅 INVALID_ARGS)
- ctx.inject(["systemPrompt"]):scope.systemPrompt.context({name:"dsh:cot-anchor-exec-discipline", order:20000, text})
- emit(现役 6 个):point-truncated / reflow-misjudged / length-conservation-failed / structure-unbalanced / anchor-dedup-skipped / softcut-taken
- 路由:/plugins/cot-anchor/settings(GET 带 capabilities)、/plugins/cot-anchor/harvest
- 关键常量:SOFT_CUT_HOOK="agent/soft-cut"、PRE_STEP_HOOK="agent/pre-step"(仅探测)、EXEC_DISCIPLINE_CONTEXT_ORDER=20000、PLUGIN_SOURCE={kind:"plugin:dsh-cot-anchor", plugin:"dsh-cot-anchor"}

**dsh-step-governor(v0.2.2)**
- 模块级 `inject=["webServer"]`;`ctx.provide("stepGovernor",{denyToolCategory, rejectStep})`
- ctx.on:`session/event`(noteEvent 状态机 + 看门狗)、`tools/pre-execute`(stall-2 deny → G2)、`agent/pre-step`(stall-3 消费 → G1 软停/硬拦)、`agent/soft-cut-suppressed`(高置信升级)、`semantic-watcher/heartbeat`
- emit(3 个):governor/category-denied / step-rejected / step-soft-stopped
- 路由:/plugins/step-governor/settings(GET 带 pendingDependencies);BLOCK_CODES 冻结枚举:g1a-zero-delivery / g1b-fingerprint-repeat / g1c-turn-limit / g2a-same-target / g2b-consecutive-failure / semantic-stall-2 / semantic-stall
- 关键常量:WORKFLOW_TERMINAL_TOOL 正则 `/(^|_)(submit|report|finalize|finish|complete|deliver|accept)(_|$)/i`、FINGERPRINT_JACCARD_MIN=0.8、env 变量族 DSH_GOVERNOR_*(env > json > 默认)

## 8. 决策附录(#96 停点1 落定,2026-11-07)

| 未决项 | 决策 |
| --- | --- |
| §6-1 包名 | **dsh-stall-governor**(cordis 行 id / PLUGIN_SOURCE.kind=`plugin:dsh-stall-governor` / 路由前缀 `/plugins/stall-governor` / settings.section order=997 / 存储文件 `storages/stall-governor.json`) |
| §6-2 G1 灰度 | 保持 shadow 默认(注:上游 v0.2.2 代码默认 g1g2,此为**有意偏离**——pre-step 与 goal 自动续跑并存未验证;CHANGELOG 已如实记录);伪内核双引擎实测软停→硬拦链路作为测试项,硬拦经设置开启 |
| §6-3 harvest/学习模式 | **砍掉**(用户确认):连同 harvest 路由与 LLM 提炼一并移除,仅保留 extractConclusions 及其依赖常量 |
| §6-4 dsh-derive-watcher | 实测本机 web/headless 两 profile 均未安装 derive-watcher/cot-anchor/governor,`ctx.provide("cotAnchor")` 无真实调用方;新包以 `ctx.provide("stallGovernor",{requestSoftCut})` 预留接口,不迁移旧名 |
| §6-5 PENDING_DEPENDENCIES | 摘除:soft-cut-suppressed 载荷契约由本包自己承担,watchdog 心跳事件名以本包实际发射为准 |
| §6-6 内核移植段依赖 | 保留 probeKernelHook 三态探测与设置页能力横幅如实上报;未移植内核上软切引擎如实降级 |
| 分支策略 | 独立 worktree 基于 main(issue-96-stall-governor);若 #94 先 merge,本 PR rebase 后登记计数按 8→9 调整 |
