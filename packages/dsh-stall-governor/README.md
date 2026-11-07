# dsh-stall-governor

失速治理单包双引擎——把两个上游插件合并为一个 DSH bundle:

| 引擎 | 治什么 | 手段 | 来源 |
| --- | --- | --- | --- |
| 「单流内」 | 单次生成流内的退化(伪工具调用 / 字节复读 / 打转 / 转折空转 / 数字流) | `agent/soft-cut` 单点软切判定 + `tools/post-execute` INVALID_ARGS 恢复指引注入 + 命令执行纪律固定段 | dsh-cot-anchor v0.4.2 |
| 「跨步骤」 | 跨步骤空转(无交付步 / 结论重推 / 同目标反复失败) | `agent/pre-step` reject 步级熔断 + `tools/pre-execute` deny 支线熔断,shadow 先行 | dsh-step-governor v0.2.2 |

两引擎共享同一套装配、设置、client、事件设施;同一方法论:确定性判据、shadow 灰度、fail-open、有界预算、事故夹具回归。

## 与上游 README 的偏差(以代码为准)

- **结论锚点回灌主路径已移除**(上游生产事故:注入→提取→再注入自反馈环)。现役能力是:软切判定器 + INVALID_ARGS 恢复注入 + 纪律固定段。本包不恢复该主路径。
- governor 触发器按代码枚举:G1-A 三个子判据(硬零交付 / 只读空转 / 滑窗失速)+ G1-B 指纹 + G1-C 硬顶,另有 v0.2.2 软停优先策略(首次命中只投收尾指令,再犯才硬拦)。
- `agent/soft-cut` 是内核移植段提供的能力(上游 `tools/apply-softcut-port.mjs` 只支持 0.2.0-rc.2)。**未移植内核上软切引擎零生效**——本包用 probeKernelHook 三态探测(present / absent / unknown),absent 时不注册钩子、启动 warn、设置页能力横幅如实上报。纪律段与 INVALID_ARGS 恢复注入不受影响。

## 健壮性模式(继承自上游真实事故,不回退)

1. 注入消息契约三件套:`id: randomUUID()` + deepFreeze;source.kind 必须是 `plugin:<name>` 标准形态;webServer 路由 apply 期经 `inject=["webServer"]` 就绪。
2. fail-open:两个引擎的钩子体整体 try/catch,catch 记 `{at, failOpen:true, error}` 后 `return next()` 放行。
3. 分类有界预算:6(heuristic)/ 20(confirmed-repeat)/ 3(confirmed-pseudo)由内核移植段持有;外部请求固定占 heuristic 额度。所有配额有界,按置信度分桶。
4. 自反馈三防:跳过自家注入消息;检测副本剥离已注入锚点;伪工具锚不复述原始标签。
5. 内核能力探测:probeKernelHook → present/absent/unknown;absent 不注册 + 启动 warn + 设置页如实上报。
6. 跨 turn 隔离:turn 边界清零全部账目;软停按 turn 记录。
7. deny/reject 文案三要素:触发规则与计数口径 + 当前步序 + 合法继续出口;info 按分支构造防 undefined 字段。
8. 事件载荷四元组:sessionId/turn/step/evidenceSeq(evidenceSeq 模块级单调,同源多事件共享);字段缺省置 null 不省略。
9. 有界内存:全部会话态 Map 有界 + LRU 淘汰。
10. 目标键空串兜底:全字段取不到时 `#args:<fnv1a(stableStringify)>`,绝不退化空串。

## 与上游的接口差异(合并改名)

| 上游 | 本包 |
| --- | --- |
| 包名 dsh-cot-anchor / dsh-step-governor | `dsh-stall-governor` |
| `PLUGIN_SOURCE.kind` | `plugin:dsh-stall-governor` |
| 路由 /plugins/cot-anchor/settings、/plugins/step-governor/settings | `/plugins/stall-governor/settings` |
| 存储 两份 json | `storages/stall-governor.json` |
| settings.section order 998/996 | 997 |
| `ctx.provide("cotAnchor")` / `ctx.provide("stepGovernor")` | `ctx.provide("stallGovernor", { requestSoftCut, denyToolCategory, rejectStep })` |
| harvest 路由 + LLM 提炼 / CoT 采集 / 学习模式 | **已砍**(注入主路径移除后非现役能力) |
| PENDING_DEPENDENCIES 三项 | 已摘除(soft-cut-suppressed 契约由本包自己持有) |

## 安装

profile 的 `package.json`:

```json
"dsh-stall-governor": "link:/path/to/DSH-plugins/packages/dsh-stall-governor"
```

且 `dsh.profile.bundles` 加入 `"dsh-stall-governor"`。只写 dependencies 不会加载 bundle。

## 设置页

Web 设置页挂在 `/plugins/stall-governor/settings`,schema 驱动,能力横幅三态(present / absent / unknown)如实上报内核软切能力。

## 测试

```bash
node --test packages/dsh-stall-governor/test/*.test.mjs
```

测试设计沿用上游:伪内核 waterfall ctx、事故夹具回归、黄金键 baseline、契约形状负对照、fail-open 验证、设置 schema 驱动。
