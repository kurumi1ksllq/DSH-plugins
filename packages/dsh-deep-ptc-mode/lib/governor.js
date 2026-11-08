/**
 * dsh-stall-governor — 失速治理单包双引擎(#96,由 dsh-cot-anchor v0.4.2 与 dsh-step-governor v0.2.2 合并)。
 *
 * 两个引擎共享装配、设置、client、事件设施;包名/行 id/PLUGIN_SOURCE/路由/存储全部用新 id:
 *   - 「跨步骤」引擎(源自 dsh-step-governor):
 *       agent/pre-step    → {kind:"reject"} 步级熔断(G1-A 三子判据 + G1-B 指纹 + G1-C 硬顶;软停优先,默认 shadow)
 *       tools/pre-execute → {kind:"deny"}   支线熔断(G2-A 同目标 / G2-B 连续失败)
 *       agent/soft-cut-suppressed → 高置信类升级为 pendingReject(与「单流内」引擎同进程闭环)
 *   - 「单流内」引擎(源自 dsh-cot-anchor):
 *       agent/soft-cut    → 单点软切决策(五判定器 + overLongCoT 兜底;probeKernelHook 三态门控)
 *       tools/post-execute→ 仅 INVALID_ARGS/ToolArgsError 恢复指引注入(结论注入主路径已移除,不恢复)
 *       ctx.inject(["systemPrompt"]) → 命令执行纪律固定段(order 20000)
 *
 * 稳定性契约(继承上游真实事故,不回退):
 *  - 每条注入 additionalContext 必须带 id: randomUUID() 且 deepFreeze——缺 id 会报
 *    `"undefined" is already pending`(agent-loop 对 pending inbox 去重)。
 *  - source.kind 必须是 `plugin:<name>` 标准形态:笼统 kind:"plugin" 会被 v4 行级准入
 *    assertV4SourceRowAdmission 抛 SessionFormatError(2026-10-05 事故)。
 *  - webServer 路由必须在 apply 期经模块级 inject=["webServer"] 就绪——apply 内软解析会让设置页静默 404。
 *  - fail-open:两个引擎的钩子体整体 try/catch,catch 记 {at, failOpen:true, error} 后放行。
 *  - 分类有界预算:6(heuristic)/20(confirmed-repeat)/3(confirmed-pseudo)由内核移植段持有;
 *    budgetClass=预算桶名,cutClass=内核 softCutBudgetKey 可识别名,三分支映射冻结
 *    (pseudoTool→confirmed-pseudo/pseudoTool,repeat/numberRunaway→confirmed-repeat/
 *    confirmed-repeat,其余→heuristic/heuristic;pseudoTool 的 cutClass 必须写
 *    "pseudoTool" 而非桶名,否则归入 heuristic 桶);外部请求固定占 heuristic 额度。
 *  - probeKernelHook 直读 @deepseek-ai/dsh-agent-loop 源码查钩子字面量:absent 不注册 + 启动 warn +
 *    设置页能力横幅如实上报(0.1.5-rc.3 移除 agent/soft-cut 的静默失效事故)。
 *
 * 与上游的接口差异:ctx.provide("stallGovernor") 合并两上游服务;路由 /plugins/stall-governor/settings;
 * 存储 storages/stall-governor.json(两引擎设置合并为一份扁平 JSON);harvest/LLM 提炼/学习模式已砍
 * (spec #96 §6-3);governor 的 PENDING_DEPENDENCIES 已摘除(soft-cut-suppressed 契约由本包自持)。
 * G1 默认 shadow:agent/pre-step 与 goal 自动续跑驱动的并存顺序未经双引擎伪内核实测(#96 §6-2)。
 */

// #116 governor 拆分:约 250 个顶层声明按语义分组移入 governor-{peer,core,anchor,settings,softcut,apply}.mjs,
// 本文件为装配入口:下方 import 为新增,export 单行导出面与文件头注释保持逐字不变。

import { name, inject, createSessionState, noteEvent, noteAssistantStep, evaluateG1, evaluateG2, targetKey, failureSignature, reasoningFingerprint, shingleSet, jaccardSimilarity, isSelfDenialResult, advanceStepBoundary, toolCategory, applySettings, settingsSnapshot, BLOCK_CODES, CATEGORY_BY_TOOL, DENY_CATEGORIES, GOVERNOR_SETTINGS_SCHEMA, GOVERNOR_SETTINGS_DEFAULTS, CONFIG } from "./governor-core.mjs";
import { SETTINGS_SCHEMA, DEFAULT_SETTINGS } from "./governor-settings.mjs";
import { apply } from "./governor-apply.mjs";




// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { name, inject, apply, createSessionState, noteEvent, noteAssistantStep, evaluateG1, evaluateG2, targetKey, failureSignature, reasoningFingerprint, shingleSet, jaccardSimilarity, isSelfDenialResult, advanceStepBoundary, toolCategory, applySettings, settingsSnapshot, BLOCK_CODES, CATEGORY_BY_TOOL, DENY_CATEGORIES, GOVERNOR_SETTINGS_SCHEMA, GOVERNOR_SETTINGS_DEFAULTS, SETTINGS_SCHEMA, DEFAULT_SETTINGS, CONFIG };
