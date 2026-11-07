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
 *    budgetClass 与 cutClass 必须同值;外部请求固定占 heuristic 额度。
 *  - probeKernelHook 直读 @deepseek-ai/dsh-agent-loop 源码查钩子字面量:absent 不注册 + 启动 warn +
 *    设置页能力横幅如实上报(0.1.5-rc.3 移除 agent/soft-cut 的静默失效事故)。
 *
 * 与上游的接口差异:ctx.provide("stallGovernor") 合并两上游服务;路由 /plugins/stall-governor/settings;
 * 存储 storages/stall-governor.json(两引擎设置合并为一份扁平 JSON);harvest/LLM 提炼/学习模式已砍
 * (spec #96 §6-3);governor 的 PENDING_DEPENDENCIES 已摘除(soft-cut-suppressed 契约由本包自持)。
 * G1 默认 shadow:agent/pre-step 与 goal 自动续跑驱动的并存顺序未经双引擎伪内核实测(#96 §6-2)。
 */

// 上游运行时依赖 @deepseek-ai/dsh-llm(createUserMessage,软停收尾指令构造)。宿主内该 peer
// 由内核提供;单测/CI 环境没有运行时,惰性导入失败时以透传桩兜底——软停消息退化为纯文本,
// 其余判据与事件全部不受影响(fail-open:设置便利性永远不是插件启动失败的理由)。
let createUserMessage = (input) => input;
try {
	({ createUserMessage } = await import("@deepseek-ai/dsh-llm"));
} catch {
	// peer 缺失:保留透传桩,见上方注释。
}


// ═══════════════════════ §0 共享设施(合并自两上游) ═══════════════════════

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_ID = "dsh-stall-governor";
const name = PLUGIN_ID;
// systemPrompt:命令执行纪律固定段;webServer:设置页路由必须在 apply 期注册。
const inject = ["systemPrompt", "webServer"];

/**
 * Source marker for every message this plugin injects(软停 notice 与外部锚点共用)。
 *
 * 2026-10-05 修复 "format v4 message requires a producer-owned source kind"：
 * 内核 0.2.0 起废弃了笼统的 `kind:"plugin"` 包装 —— dsh-session-persistence-jsonl
 * 的 worker 在写入前的行级准入（assertV4SourceRowAdmission）与读取时的
 * assertV4MessageSources 都会对它直接抛 SessionFormatError。
 * 改为内核迁移器对未知插件使用的标准形态 `plugin:<name>`。
 */
const PLUGIN_SOURCE = Object.freeze({ kind: `plugin:${PLUGIN_ID}`, plugin: PLUGIN_ID });
/** 软停提示消息来源(上游 governor 的 SOFT_STOP_SOURCE,形状与 PLUGIN_SOURCE 一致)。 */
const SOFT_STOP_SOURCE = PLUGIN_SOURCE;

// 内核能力探测常量与 probeKernelHook 在 §2「单流内」引擎段(源自 cot-anchor,原样保留)。

/** 合并后的设置持久化文件(两引擎设置合并为一份扁平 JSON;env DSH_STALL_GOVERNOR_SETTINGS_PATH 可改路径)。 */
const SETTINGS_FILE = "stall-governor.json";
/** 设置页路由(新前缀;客户端与 HTTP 助手共用)。 */
const SETTINGS_ROUTE = "/plugins/stall-governor/settings";

/** Send one JSON response. */
function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(payload));
}

/** Collect and parse a JSON request body (empty body reads as `{}`). */
function readRequestBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => { body += chunk; });
		req.on("end", () => {
			try {
				resolve(JSON.parse(body || "{}"));
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}

// ═══════════════════════ §1 「跨步骤」引擎(源自 dsh-step-governor) ═══════════════════════

// ── 计划书 §5.8 冻结阻断码（本插件使用的子集；禁止自创码）────────────────
// g1a-zero-delivery / g1b-fingerprint-repeat / g1c-turn-limit → 可走 G1 限次续跑
// g2a-same-target / g2b-consecutive-failure → deny，不终止 turn
// semantic-stall-2（watcher→governor，deny ttl 限定）
// semantic-stall（watcher→governor，L3 语义终判，不可重试，不走 G1 续跑）
const BLOCK_CODES = {
	G1_A: "g1a-zero-delivery",
	G1_B: "g1b-fingerprint-repeat",
	G1_C: "g1c-turn-limit",
	G2_A: "g2a-same-target",
	G2_B: "g2b-consecutive-failure",
	STALL_2: "semantic-stall-2",
	STALL_3: "semantic-stall"
};
/** 语义契约：阻断码禁止使用可重试码（如 prompt-rejected）。 */
const FORBIDDEN_RETRY_CODES = new Set(["prompt-rejected"]);

/**
 * 工作流终态提交工具的判定（P1-20）。
 *
 * 判据：工具名中含 submit / report / finalize / finish / complete / deliver / accept
 * 词元（以 `_` 或首尾为界）。这些词标记的语义是"这次调用本身就是把成果交出去"，
 * 与"查询/取数/探索"类工具相对。
 *
 * 为什么要单独豁免 G2-B：这类工具是外部工作流契约里"本轮必须以它提交结果"
 * 的唯一结构化出口，G2-B 的补救指令是"换命令/参数、换工具或让用户决定"。
 * 对终态提交工具，换工具的出口并不存在（工作流只认这一个工具），而拦截的
 * 直接后果是外部编排永远读不到提交 → 判该角色"不可用" → 整个任务卡死。
 * 也就是说：拦截它不会让模型换一条路，只会把"一次可修正的参数错误"升级成
 * "不可恢复的死锁"。故对这类工具 G2-B / G2-A 均只观测不拦截，防刷屏交给
 * G1-C 的回合步数上限。
 */
const WORKFLOW_TERMINAL_TOOL = /(^|_)(submit|report|finalize|finish|complete|deliver|accept)(_|$)/i;

// ── 工具名 → 类别映射表（计划书 §5.8：read/grep 及 browser 只读类）────────
const CATEGORY_BY_TOOL = new Map([
	["read", "read"],
	["grep", "grep"],
	// browser 只读类归入 read（只读取证不产出文件）
	["browser_open", "read"],
	["browser_snapshot", "read"],
	["browser_a11y", "read"],
	["browser_content", "read"],
	["browser_scrape", "read"],
	["browser_screenshot", "read"],
	["browser_wait", "read"],
	["browser_history", "read"],
	["browser_visited", "read"],
	["web_fetch", "read"]
]);
/** denyToolCategory 首期类别枚举（未知类别拒绝调用）。 */
const DENY_CATEGORIES = new Set(["read", "grep"]);

// ── 设置 schema（设计 §9.3，共 10 项）────────────────────────────────────
const NOTIFY_CHANNELS = new Set(["GUI", "board", "webhook", "IM"]);
const GOVERNOR_SETTINGS_SCHEMA = [
	{ key: "mode", label: "拦截档位", type: "select",
		options: [
			{ value: "off", label: "完全关闭（不观测、不拦截）" },
			{ value: "shadow", label: "仅观测不拦截（默认）" },
			{ value: "g2b", label: "只拦截工具连续失败" },
			{ value: "g2", label: "拦截工具层两种卡死" },
			{ value: "g1g2", label: "全程强拦截" }
		],
		group: "拦截",
		hint: "默认「仅观测」：agent/pre-step 与 goal 自动续跑驱动的并存顺序尚未在双引擎伪内核实测（spec #96 §6-2），先 shadow 灰度；确认无误伤后上调档位开启拦截。" },
	{ key: "g1aZeroSteps", advanced: true, label: "连续无产出多少步算卡死", type: "number", min: 2, max: 20, group: "回合卡死拦截",
		hint: "AI 连续多少步都没有向任务交付实际结果，就判定为卡死。" },
	{ key: "g1aWindowSize", advanced: true, label: "判定参考窗口（最近几步）", type: "number", min: 2, max: 20, group: "回合卡死拦截",
		hint: "用最近几步的滑动窗口来判断是否“隔几步空转一轮”的卡死。" },
	{ key: "g1aSuccessRatioMax", advanced: true, label: "窗口内“成功动作”占比上限", type: "number", min: 0, max: 1, step: 0.05, group: "回合卡死拦截",
		hint: "只有窗口内成功动作占比不超过这个值，才把当前状态计为卡死。" },
	{ key: "g1aReasoningMin", advanced: true, label: "窗口内“思考”最少字数", type: "number", min: 0, max: 2000, group: "回合卡死拦截",
		hint: "窗口内思考总字数低于此值，且成功率也不高，才会判为卡死。" },
	{ key: "g1aUnproductiveSteps", advanced: true, label: "连续只读空转多少步算卡死", type: "number", min: 2, max: 30, group: "回合卡死拦截",
		hint: "AI 连续多少步只有成功的只读类调用（读文件/检索/浏览器只读）而无文本、无文件变更、无写类产出，判定为只读空转卡死。针对“每步都成功翻页读取”的空转模式。" },
	{ key: "g1bFingerprintSteps", advanced: true, label: "重复同一套思考（结论指纹）多少次算卡死", type: "number", min: 2, max: 30, group: "回合卡死拦截",
		hint: "如果连续几步的思考内容高度相似（看起来在原地打转），判定为卡死。内部以「结论指纹」称呼：连续几步命中同一结论指纹（提示文案为「同一结论指纹跨 N 步重现」）。" },
	{ key: "g1cMaxStepsPerTurn", advanced: true, label: "单个回合最多执行步数", type: "number", min: 10, max: 500, group: "回合卡死拦截",
		hint: "一个回合内允许的最大执行步数，超过则强制终止该回合。" },
	{ key: "g2aSameTargetCalls", advanced: true, label: "连续调用同一目标几次算异常", type: "number", min: 1, max: 20, group: "工具层拦截" },
	{ key: "g2bConsecutiveFailures", advanced: true, label: "连续失败几次算异常", type: "number", min: 1, max: 10, group: "工具层拦截",
		hint: "同一工具连续失败达到此次数，就不再容忍，进行拦截。" },
	{ key: "g1MaxAutoResume", advanced: true, label: "自动续跑上限", type: "number", min: 0, max: 10, group: "卡死后自动续跑",
		hint: "卡死被拦下后自动重试续跑的最多次数；设为 0 表示卡死一次就直接暂停，不再自动续跑。" },
	{ key: "g1AutoResumeSwitchAction", advanced: true, label: "续跑时强制换一种动作", type: "boolean", group: "卡死后自动续跑",
		hint: "开启后，自动续跑的回合会强制切换动作类别，避免重复踩同一个坑。" },
	{ key: "notifyChannels", label: "通知渠道", type: "multi-select",
		options: [
			{ value: "GUI", label: "界面面板展示" },
			{ value: "board", label: "任务看板" },
			{ value: "webhook", label: "Webhook 回调" },
			{ value: "IM", label: "即时通讯" }
		],
		group: "通知",
		hint: "卡死拦截走到“自动续跑耗尽”后，通过哪些渠道提醒你。默认界面面板展示。" },
	{ key: "maxSessions", advanced: true, label: "治理状态最多跟踪的会话数", type: "number", min: 10, max: 2000, group: "高级",
		hint: "同时跟踪治理状态的会话数量上限，避免内存占用过高。" }
];
/** 从 schema 的选项定义中取全部合法 value（选项为 {value,label} 对象或纯字符串）。 */
function optionValues(spec) {
	const opts = spec.options || [];
	return opts.map((o) => (o && typeof o === "object" && "value" in o ? String(o.value) : String(o)));
}
const GOVERNOR_SETTINGS_DEFAULTS = {
	mode: "shadow",
	g1aZeroSteps: 4,
	g1aWindowSize: 8,
	g1aSuccessRatioMax: 0.25,
	g1aReasoningMin: 160,
	g1aUnproductiveSteps: 6,
	g1bFingerprintSteps: 6,
	g1cMaxStepsPerTurn: 60,
	g2aSameTargetCalls: 3,
	g2bConsecutiveFailures: 2,
	g1MaxAutoResume: 3,
	g1AutoResumeSwitchAction: true,
	notifyChannels: ["GUI"],
	maxSessions: 200
};

// ── 阈值（env 作启动初始值；设置卡保存后覆盖并持久化，§9.3 兼容约定）──────
function intEnv(name, fallback) {
	const raw = process.env[name];
	const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
const MODES = ["off", "shadow", "g2b", "g2", "g1g2"];
/**
 * P0-6 配置优先级 env > 持久化 json > 默认：记录哪些 schema 键由 env 显式提供。
 * resetConfigFromEnv() 每次装配重建本集合（重复装配/测试互不污染）；
 * applySettings 对集合内键跳过持久化覆盖，保证 env 不被 json 全键覆盖。
 */
const envOwnedKeys = new Set();
/** 每个 schema 键对应的 env 名（与 resetConfigFromEnv 读取一致）。 */
const ENV_BY_KEY = {
	mode: "DSH_STALL_GOVERNOR_MODE",
	g1aZeroSteps: "DSH_STALL_GOVERNOR_G1A_N",
	g1aUnproductiveSteps: "DSH_STALL_GOVERNOR_G1A_UNPROD_N",
	g1bFingerprintSteps: "DSH_STALL_GOVERNOR_G1B_K",
	g1cMaxStepsPerTurn: "DSH_STALL_GOVERNOR_G1C_MAX",
	g2aSameTargetCalls: "DSH_STALL_GOVERNOR_G2A_M",
	g2bConsecutiveFailures: "DSH_STALL_GOVERNOR_G2B_F",
	maxSessions: "DSH_STALL_GOVERNOR_MAX_SESSIONS"
};
/** 运行时配置：由 resetConfigFromEnv()/applySettings() 原地更新，钩子与纯函数全部直读本对象。 */
const CONFIG = {};
/**
 * 从 env 重置 CONFIG 为启动初值（每次 apply() 开头调用）：
 * env=启动初值、设置卡=运行期覆盖；重复装配（测试/多实例）互不污染。
 */
function resetConfigFromEnv() {
	envOwnedKeys.clear();
	for (const [key, envName] of Object.entries(ENV_BY_KEY)) {
		if (process.env[envName] !== undefined && process.env[envName] !== "") envOwnedKeys.add(key);
	}
	CONFIG.mode = (process.env.DSH_STALL_GOVERNOR_MODE || "shadow").toLowerCase();
	if (!MODES.includes(CONFIG.mode)) CONFIG.mode = "shadow";
	CONFIG.g1aZeroSteps = intEnv("DSH_STALL_GOVERNOR_G1A_N", GOVERNOR_SETTINGS_DEFAULTS.g1aZeroSteps);
	CONFIG.g1aUnproductiveSteps = intEnv("DSH_STALL_GOVERNOR_G1A_UNPROD_N", GOVERNOR_SETTINGS_DEFAULTS.g1aUnproductiveSteps);
	CONFIG.g1bFingerprintSteps = intEnv("DSH_STALL_GOVERNOR_G1B_K", GOVERNOR_SETTINGS_DEFAULTS.g1bFingerprintSteps);
	CONFIG.g1cMaxStepsPerTurn = intEnv("DSH_STALL_GOVERNOR_G1C_MAX", GOVERNOR_SETTINGS_DEFAULTS.g1cMaxStepsPerTurn);
	CONFIG.g1aWindowSize = intEnv("DSH_STALL_GOVERNOR_G1A_WINDOW", GOVERNOR_SETTINGS_DEFAULTS.g1aWindowSize);
	CONFIG.g1aSuccessRatioMax = GOVERNOR_SETTINGS_DEFAULTS.g1aSuccessRatioMax;
	CONFIG.g1aReasoningMin = intEnv("DSH_STALL_GOVERNOR_G1A_REASONING", GOVERNOR_SETTINGS_DEFAULTS.g1aReasoningMin);
	CONFIG.g2aSameTargetCalls = intEnv("DSH_STALL_GOVERNOR_G2A_M", GOVERNOR_SETTINGS_DEFAULTS.g2aSameTargetCalls);
	CONFIG.g2bConsecutiveFailures = intEnv("DSH_STALL_GOVERNOR_G2B_F", GOVERNOR_SETTINGS_DEFAULTS.g2bConsecutiveFailures);
	CONFIG.g1MaxAutoResume = GOVERNOR_SETTINGS_DEFAULTS.g1MaxAutoResume;
	CONFIG.g1AutoResumeSwitchAction = GOVERNOR_SETTINGS_DEFAULTS.g1AutoResumeSwitchAction;
	CONFIG.notifyChannels = [...GOVERNOR_SETTINGS_DEFAULTS.notifyChannels];
	CONFIG.maxSessions = intEnv("DSH_STALL_GOVERNOR_MAX_SESSIONS", GOVERNOR_SETTINGS_DEFAULTS.maxSessions);
}
resetConfigFromEnv();

/**
 * 校验并应用一组设置（设置卡 POST / 持久化加载共用）：数值 clamp 到 schema
 * 范围、非法回退默认、未知键丢弃、布尔严格判型、渠道过滤。原地更新 CONFIG。
 * @param {unknown} raw 任意输入（可损坏）
 * @returns {object} 归一化后的设置快照
 */
function applySettings(raw) {
	const incoming = raw && typeof raw === "object" ? raw : {};
	const warn = [];
	for (const spec of GOVERNOR_SETTINGS_SCHEMA) {
		const key = spec.key;
		if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
		const v = incoming[key];
		if (spec.type === "select") {
			const next = typeof v === "string" ? v.toLowerCase() : "";
			const values = optionValues(spec);
			if (envOwnedKeys.has(key)) {
				if (values.includes(next)) warn.push(`${key} 由 env 固定，忽略持久化值 ${JSON.stringify(v)}`);
			} else if (values.includes(next)) CONFIG[key] = next;
			else warn.push(`${key} 非法值 ${JSON.stringify(v)} 回退 ${CONFIG[key]}`);
		} else if (spec.type === "boolean") {
			if (envOwnedKeys.has(key)) {
				if (typeof v === "boolean") warn.push(`${key} 由 env 固定，忽略持久化值`);
			} else if (typeof v === "boolean") CONFIG[key] = v;
			else warn.push(`${key} 非布尔回退 ${CONFIG[key]}`);
		} else if (key === "notifyChannels") {
			const list = Array.isArray(v) ? v.filter((c) => NOTIFY_CHANNELS.has(c)) : [];
			if (list.length > 0) CONFIG[key] = [...new Set(list)];
			else warn.push(`${key} 非法回退默认`);
		} else {
			// P0-6 配置优先级 env > 持久化 json > 默认：env 显式设过的键
			// （resetConfigFromEnv 已吃进 CONFIG），持久化 json 一律不得覆盖。
			// 设置卡 POST 前无 env，保存仍即时生效；测试无 env，同语义。
			if (envOwnedKeys.has(key)) warn.push(`${key} 由 env 固定，忽略持久化值`);
			else {
				// D7 口径:仅整型默认键取整;比值类键保留小数精度(0.25 抬成 1 再 clamp 到 min 0,
				// 阈值永远落空——与 anchor 侧 applyRuntimeSettings 的 D7 修复同因同果)。
				const round = Number.isInteger(GOVERNOR_SETTINGS_DEFAULTS[key]) ? Math.round : Number;
				const n = round(Number(v));
				if (Number.isFinite(n)) CONFIG[key] = Math.min(spec.max, Math.max(spec.min, n));
				else warn.push(`${key} 非数值回退 ${CONFIG[key]}`);
			}
		}
	}
	if (warn.length > 0) logStatic({ at: "settings-invalid", warnings: warn });
	return settingsSnapshot();
}
/** 当前设置快照(14 项)。 */
function settingsSnapshot() {
	const out = {};
	for (const spec of GOVERNOR_SETTINGS_SCHEMA) {
		const v = CONFIG[spec.key];
		out[spec.key] = Array.isArray(v) ? [...v] : v;
	}
	return out;
}
/** 尽早可用的静态日志（apply 之前也可能告警设置回退）。 */
function logStatic(payload) {
	try { console.warn(`[${PLUGIN_ID}] ${JSON.stringify(payload)}`); } catch { /* ignore */ }
}

function enforces(rule) {
	// rule: "G1-A" | "G1-B" | "G1-C" | "G2-A" | "G2-B"
	if (CONFIG.mode === "off" || CONFIG.mode === "shadow") return false;
	if (rule.startsWith("G2-")) {
		if (CONFIG.mode === "g2b") return rule === "G2-B";
		return true; // g2 / g1g2
	}
	return CONFIG.mode === "g1g2";
}

// ── 纯逻辑：目标键归一化 ─────────────────────────────────────────────────
/**
 * 归一化一次工具调用为"目标键"。只能识别同一调用目标，无法把
 * "换方法追同一目的"归一（这是设计上已知的能力边界）。
 *
 * P1-14 提参要点（评估报告 §6）：
 *   - read：offset/limit 翻页是"同一目标"，并入键体（offset 变 = 不同键）；
 *   - grep：带 path 时 pattern 才是目标（path 并入键体），无 path 时 pattern 即目标——
 *     旧 ?? 链把 pattern 排在 path 之后，带 path 时 pattern 被丢弃导致不同检索同键；
 *   - pwsh：split(/[|;&]/)+首词把同脚本不同 -Filter/参数并成一键（事故 §3.1 六笔
 *     误杀主因），改为脚本体规范化哈希 + 保留管道首段 head 语义；
 *   - Windows 路径（C:/x、D:\x）会被 new URL 解析成 scheme=c:、origin 恒 "null"、
 *     跨盘符归一成同键——非 URL（无 scheme://）一律不走 URL 分支。
 * @param {string} name 工具名
 * @param {unknown} args 工具参数（对象或 JSON 字符串）
 * @returns {string}
 */
function targetKey(name, args) {
	let a = args;
	if (typeof a === "string") {
		try { a = JSON.parse(a); } catch { a = {}; }
	}
	a = a && typeof a === "object" ? a : {};

	// 逐工具取参（per-tool param picking）。
	let raw;
	if (name === "grep") {
		const pattern = typeof a.pattern === "string" ? a.pattern : "";
		const path = a.path == null ? "" : String(a.path);
		// 带 path：pattern + path 都进键体；无 path：pattern 即目标。
		// 分隔符用 `::`（而非 \n）：\n 会被下方 replace(/\s+/g," ") 塌成空格，
		// 致 pattern 与 path 不可分（pattern="a b" 与 path 组合可碰撞）。
		raw = path ? `${pattern}::${path}` : pattern;
	} else if (name === "read") {
		// 分页键：offset/limit 决定读的是文件的哪一段（limit 缺省视为读到底）。
		const offset = Number.isFinite(Number(a.offset)) ? Number(a.offset) : 0;
		const limit = a.limit == null ? "" : String(a.limit);
		raw = `${a.file_path ?? a.path ?? ""}::@${offset}:${limit}`;
	} else if (name === "edit" || name === "write") {
		// 变更类键 = 文件 + 变更语料哈希（P1-16）：edit 语料取 old_string+new_string、
		// write 取 content——不同内容的连续编辑各为新键自然放行（推进即推进），
		// 同参数重试才累积同键命中 G2-A；写失败重试另有 G2-B 兜底。
		// 旧实现走 else 兜底 raw=file_path，对同一文件的不同编辑并成同键（误杀主因）。
		const file = String(a.file_path ?? a.path ?? "");
		const corpus = name === "edit"
			? `${typeof a.old_string === "string" ? a.old_string : ""}\u0000${typeof a.new_string === "string" ? a.new_string : ""}`
			: (typeof a.content === "string" ? a.content : "");
		raw = `${file}::#${fnv1aHex(corpus)}`;
	} else if (name === "pwsh" || name === "bash" || name === "sh") {
		raw = a.command == null ? "" : String(a.command);
	} else if (name === "compress") {
		// 压缩工具：键 = 压缩范围（startId::endId），与摘要文本/标题无关。
		// 事故（6117c5ca）：旧实现走 else 兜底全参数哈希，summary 每次自拟不同文本
		// → 同一范围连压 4 次键全互异 → G2-A 滑窗计数恒 1，永远不命中。
		// 形态（实测 dump 43 次调用）：
		//   - content 数组（或可解析为数组的字符串）：取各段 startId::endId 按序拼接；
		//     任一段缺 startId/endId → 该段 "unranged"（仍进键体，不跳过）；
		//   - flat 顶层 startId+endId 齐备：raw = `${startId}::${endId}`；
		//     仅其一存在 → "unranged"；
		//   - content 数组形态优先于 flat（两形态并存以 content 数组为准）；
		//   - 两形态都取不到 → "unranged"（防参数形态再变时塌回全参数哈希）。
		// summary/topic 一律不进键（同范围不同摘要 = 同一压缩目标，正是风暴形态）。
		let contentArr = null;
		if (Array.isArray(a.content)) {
			contentArr = a.content;
		} else if (typeof a.content === "string") {
			const t = a.content.trim();
			if (t.startsWith("[")) {
				try {
					const pc = JSON.parse(t);
					if (Array.isArray(pc)) contentArr = pc;
				} catch {
					contentArr = null; // 非法 JSON（如转义断裂）→ 不按数组处理
				}
			}
		}
		if (Array.isArray(contentArr) && contentArr.length > 0) {
			raw = contentArr.map((seg) => {
				const s = seg && typeof seg === "object" ? seg : {};
				if (s.startId !== undefined && s.endId !== undefined) {
					return `${String(s.startId)}::${String(s.endId)}`;
				}
				return "unranged";
			}).join("|");
		} else {
			const hasStart = a.startId !== undefined;
			const hasEnd = a.endId !== undefined;
			if (hasStart && hasEnd) {
				raw = `${String(a.startId)}::${String(a.endId)}`;
			} else if (hasStart || hasEnd) {
				raw = "unranged";
			} else {
				raw = "unranged";
			}
		}
	} else {
		raw = String(
			a.file_path ?? a.path ?? a.url ?? a.command ?? a.pattern ?? a.script ??
			a.query ?? a.name ?? ""
		);
		// P1-21：未知工具的通用兜底。上面的字段清单只覆盖文件/命令/查询类工具；
		// 对参数形态完全不同的工具（如工作流提交工具用 summary/status/sources），
		// 一个字段都取不到 → raw 恒为空串 → 同工具下**所有调用塌成同一个目标键**
		// （FNV-1a 空串恒为 0x811c9dc5），改参数在结构上无法换键，G2-B 一旦命中
		// 就永久拦截。故取不到键体时改用「全参数规范化 JSON 的哈希」进键：
		// 不同参数自然不同键，同参数重试仍累加同键，G2-B 语义得以保留。
		if (!raw) raw = `#args:${fnv1aHex(stableStringify(a))}`;
	}

	let key;
	if (name === "pwsh" || name === "bash" || name === "sh") {
		key = normalizeCommandKey(raw);
	} else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
		// 仅真 URL（scheme://）走 URL 分支去 query；Windows 盘符（C:/…）不满足该形状。
		try {
			const u = new URL(raw);
			key = u.origin + u.pathname; // URL 去 query
		} catch {
			key = raw.replace(/\s+/g, " ").trim();
		}
	} else {
		key = raw.replace(/\s+/g, " ").trim();
	}
	// P0/P1-14：保留完整归一键体，禁止再截断。旧实现 `cmdHead` 只留首段
	// 可打印字符，把 `#hash`/`@offset:limit` 全砍掉 —— 不同 offset/grep
	// pattern/pwsh -Filter 被并成同键（事故误杀主因，评估 §3.1）。
	// 空格塌缩已在上方分支完成；此处整体小写后作为键，head 仅作可读前缀。
	const head = (key.match(/^([A-Za-z0-9_.\\/-]+)/) || [])[1] || "";
	const digest = fnv1aHex(key);
	return `${name}::${head}#${digest}`.toLowerCase();
}

/**
 * 命令类（pwsh/bash/sh）目标键归一：保留"管道首段 head"语义（`|`、`;` 后缀仍算
 * 同一目标），但整段脚本参数全部进键——同脚本不同 -Filter/参数 = 不同键。
 * 旧实现 split(/[|;&])[0] + 只取首词，把所有参数丢进同一个键（事故误杀主因）；
 * 且 `&&` 也被切断，`cd <目录> && <真实命令>` 只剩 `cd <目录>`，不同命令全部
 * 塌成同一个键（G2-A 误杀正常调查命令的根因）。
 * 修复：先剥离开头的 cd/pushd/chdir 前缀（目录保留进键体），再按 `|` / `;`
 * 切首段；`&&` 链整体参与哈希，避免链上真实命令被丢弃。
 * @param {string} raw 原始命令串
 * @returns {string}
 */
function normalizeCommandKey(raw) {
	const collapsed = String(raw).replace(/\s+/g, " ").trim();
	// 目录切换前缀只提供 cwd，不是调用目标本体；目录单独进键体以保留跨目录区分。
	const cd = collapsed.match(/^(?:cd|pushd|chdir)\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))\s*(?:&&|;)\s*/i);
	const dir = cd ? (cd[1] ?? cd[2] ?? cd[3] ?? "") : "";
	const body = (cd ? collapsed.slice(cd[0].length) : collapsed).trim() || collapsed;
	const firstSegment = body.split(/[|;]/)[0].trim().replace(/^(?:"|')|(?:"|')$/g, "").trim();
	// head = 首段去掉开头的调用算子/引号后的可读首词（保持旧键的可读前缀）。
	const head = (firstSegment.match(/^(?:[>&;]*\s*)*([A-Za-z0-9_.\\/-]+)/) || [])[1] || firstSegment.slice(0, 40);
	// 语料 = 首段全部参数（含 -Filter 等命名参数）；`&&` 链不切分，整链进哈希。
	const corpus = dir ? `${dir}::${firstSegment}` : firstSegment;
	// §3-10 边界(上游 P1-21 同口径):`#args:<fnv1a>` 空串兜底只覆盖未知工具分支;
	// 已知工具主字段缺失时得到每工具恒定键(如 grep::#811c9dc5)。改口径会动黄金键
	// 基线与 compress-targetkey 契约,如需普适兜底须连基线一并重新标定。
	const digest = fnv1aHex(corpus);
	return `${head}#${digest}`;
}

/** FNV-1a 32 位哈希（命令语料指纹；确定性、无依赖）。 */
function fnv1aHex(text) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * 稳定序列化：键序无关地序列化任意参数对象（供未知工具的目标键兜底）。
 *
 * 递归按 key 排序后拼接，保证同一份参数无论键序如何都得到相同文本；
 * 数组保序（顺序本身是参数语义）。遇到循环引用直接跳过，绝不抛错——
 * 目标键计算失败会让整条治理链路失效，保底返回已收集部分即可。
 * @param {unknown} value 任意参数值
 * @returns {string}
 */
function stableStringify(value) {
	const seen = new WeakSet();
	/** @param {unknown} node @returns {string} */
	const walk = (node) => {
		if (node === null || node === undefined) return "null";
		const kind = typeof node;
		if (kind === "string") return JSON.stringify(node);
		if (kind === "number" || kind === "boolean" || kind === "bigint") return String(node);
		if (kind !== "object") return JSON.stringify(String(node));
		if (seen.has(node)) return '"[circular]"';
		seen.add(node);
		if (Array.isArray(node)) return `[${node.map(walk).join(",")}]`;
		const keys = Object.keys(node).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${walk(node[k])}`).join(",")}}`;
	};
	return walk(value);
}

/**
 * 失败签名：只认结构化错误。isError===true 或存在 error 对象才算失败；
 * 错误码只从 error.code / error.info.code 取。绝不扫成功结果全文——
 * 正文含 "401"/"not found" 但 isError=false 的成功结果不得判失败（P0-4）。
 * @param {unknown} result 工具返回
 * @returns {{error:boolean, code:string}}
 */
function failureSignature(result) {
	if (!result) return { error: false, code: "" };
	const r = typeof result === "object" ? result : { content: String(result) };
	if (r.isError === true) return { error: true, code: structuredErrorCode(r.error) };
	if (r.error) return { error: true, code: structuredErrorCode(r.error) };
	return { error: false, code: "" };
}

/** 错误码只从 error.code / error.info.code 结构化取值；缺失回退 "error"。 */
function structuredErrorCode(error) {
	if (error && typeof error === "object") {
		if (typeof error.code === "string" && error.code) return error.code;
		const infoCode = error.info?.code;
		if (typeof infoCode === "string" && infoCode) return infoCode;
	}
	return "error";
}

/**
 * 结果是否为本插件自阻断（G2-B 自我强化排除）。
 * 真实事件契约（亲验）：
 *   - dsh-tools/lib/index.js:3241-3263 deny 后构造 {isError:true, error:{message, info:denialErrorInfo}}；
 *   - agent-loop lib/index.js:763-779 appendToolResult 把 result.error.info 提升为
 *     tool/result 事件 data 的顶层 error（`...result.error?.info ? {error: result.error.info}`）；
 *   - message 本体（dsh-llm lib/types/message.js:92-100）只有 role/source.callId/toolCallId/
 *     content/isError，没有 error/info 字段。
 * 故 deny 标记位于「事件 data 顶层」而非 message 内。旧实现读 d.message.error?.info 恒 undefined，
 * 自我强化熔断链自 fccaa12 起从未生效（评估报告 §3.2）。
 * @param {unknown} data tool/result 事件的 data（整个事件 data，不是 d.message）
 * @returns {boolean}
 */
function isSelfDenialResult(data) {
	if (!data || typeof data !== "object") return false;
	const d = data;
	// 顶层 error = agent-loop 从 result.error.info 提升的 deny 载荷：
	//   形状 {message, info:{plugin,rule,...}}，plugin 在 error.info.plugin；
	//   兼容少数旧版本把整个 info 平铺在 error 顶层（error.plugin）。
	// 不读 message 层：真实 message（dsh-llm message.js:92-100）没有 error/info，
	// 历史 bug 即读 message 层导致恒 false；负对照即验证此行为。
	const info = d?.error?.info ?? d?.error;
	return info?.plugin === PLUGIN_ID;
}

// ── 纯逻辑：结论指纹 ─────────────────────────────────────────────────────
/**
 * 对一段推理取稳定指纹：取规范化后的前 48 个字母数字字符。
 * @param {string} reasoning
 * @returns {string}
 */
function reasoningFingerprint(reasoning) {
	if (typeof reasoning !== "string") return "";
	const norm = reasoning.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
	return norm.slice(0, 48);
}

// ── P1-15：语义指纹（分句 MinHash/Jaccard）─────────────────────────────
/**
 * 对 reasoning 做词级 N-gram shingle（窗口=3 词），每个 shingle 取固定种子 FNV-1a 哈希。
 * 相同文本 → 相同集合；共同前缀规避（事故 "Actually/Hmm 后实质不同"）会被
 * 词窗口差异拆开，集合相似度如实反映语义接近度而非前缀重合度。
 * @param {string} reasoning
 * @returns {Set<string>}
 */
function shingleSet(reasoning) {
	const set = new Set();
	if (typeof reasoning !== "string") return set;
	const norm = reasoning.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ");
	const words = norm.split(/\s+/).filter(Boolean);
	if (words.length === 0) return set;
	const N = 3;
	for (let i = 0; i + N <= words.length; i++) {
		set.add(fnv1aHex(words.slice(i, i + N).join("")));
	}
	return set;
}

/**
 * Jaccard 相似度（两 shingle 集合交集/并集）。
 * @param {Set<number>} a
 * @param {Set<number>} b
 * @returns {number}
 */
function jaccardSimilarity(a, b) {
	if (a.size === 0 && b.size === 0) return 1;
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter += 1;
	return inter / (a.size + b.size - inter);
}

/** P1-15：语义指纹命中阈值——与库内已有指纹 Jaccard 超过该值即视为"同结论重现"。 */
const FINGERPRINT_JACCARD_MIN = 0.8;

// ── 纯逻辑：per-session 状态机 ───────────────────────────────────────────
function createSessionState() {
	return {
		turn: 0,
		stepInTurn: 0,
		globalStepSeq: 0,            // 会话级 step 边界计数（ttl/pending 的时间轴）
		lastBoundaryKey: "",         // (turn,step) 去重键：step/start 与 pre-step 只计一次
		lastSettledStep: 0,          // 已结算的最后一个 turn 内步号（两入口结算幂等）
		consecutiveZero: 0,          // G1-A（连续硬零推进）
		consecutiveUnproductive: 0, // G1-A 只读空转（成功但无文本/无文件变更的连续步数）
		recentSteps: [],             // G1-A 近 N 步滑窗：[{successfulTool, reasoningLen}]（P1-15 覆盖隔步空转）
		fingerprintSteps: new Map(), // fp|s:* -> Set(step)  G1-B（前缀指纹桶 / 语义 shingle 桶）
		fingerprintShingles: new Map(), // s:* 桶键 -> shingle Set（P1-15 语义指纹比对源）
		currentTurnChangedFiles: false,
		toolTargets: new Map(),      // key -> {calls, consecutiveFail}  G2
		pendingKeyByStep: new Map(), // step -> targetKey（tool/call→tool/result 关联）
		stepHadSuccess: new Map(),   // step -> 是否出现过成功工具结果
		categoryDenials: [],         // semantic-stall-2：[{evidenceSeq,ttlSteps,expiresAtStep,category}]
		pendingReject: null,         // semantic-stall 待消费项 {evidenceSeq,reason,code,source}
		turnTargets: new Set(),      // 本 turn 已访问过的工具目标键（G1-A 新颖目标豁免）
		stepTargetKeys: new Set(),   // 当前步调用的目标键（结算时并入 turnTargets）
		softStopTurn: null,          // 已下达软停指令的 turn（同 turn 先提醒、再犯才硬拦）
		lastEscalatedTurn: null,     // soft-cut 抑制升级每 turn 至多一次（null=尚未升级）
		lastActiveAt: Date.now(),    // 上次活跃时间戳（P2-24 LRU 活跃判断）
	};
}

function blocksOf(message) {
	const c = message?.content;
	return Array.isArray(c) ? c : [];
}

/**
 * 推进会话级 step 边界计数。step/start 事件与 agent/pre-step 钩子会对同一
 * 边界各触发一次，用 (turn,step) 键去重；缺编号时按“每次调用即新边界”计。
 */
function advanceStepBoundary(state, turn, step) {
	if (typeof turn === "number" && typeof step === "number") {
		const key = `${turn}:${step}`;
		if (key !== state.lastBoundaryKey) {
			state.lastBoundaryKey = key;
			state.globalStepSeq += 1;
		}
	} else {
		state.globalStepSeq += 1;
	}
	return state.globalStepSeq;
}

/**
 * 处理一次会话事件，推进状态机。
 * @param {object} state
 * @param {object} event 形如 {type, data}
 */
function noteEvent(state, event) {
	if (!state || !event || !event.type) return state;
	const d = event.data || {};
	switch (event.type) {
		case "turn/start":
			state.turn = d.turn ?? state.turn + 1;
			state.stepInTurn = 0;
			state.lastSettledStep = 0;
			state.currentTurnChangedFiles = false;
			// P1-17：G1 连续零推进/指纹重现账目按 turn 清零——旧账不跨 turn
			// 带入（评估报告 §3.1/img 误杀根因之一：上一 turn 的累计在下一 turn
			// 继续滚，加上重启词规避指纹，导致非空转会话被 G1-B 拦下）。
			// 选择"重置"而非"保留跨 turn"：空转治理按 turn 口径对齐；若需跨 turn
			// 累积语义，另开配置开关。
			state.consecutiveZero = 0;
			state.consecutiveUnproductive = 0;
			state.fingerprintSteps.clear();
			// #96 §3-9 有界内存:shingle 集合在上游跨 turn 从未清理(仅随 LRU 逐出释放),
			// 合并修复:turn 边界与 fingerprintSteps 同口径清零。
			state.fingerprintShingles.clear();
			state.recentSteps = []; // P1-15 滑窗同口径：账目不跨 turn 带入
			state.turnTargets.clear();
			state.stepTargetKeys.clear();
			state.softStopTurn = null;
			// P1-22：G2 账目整体按 turn 清零——recentCalls 记录 globalStepSeq，
			// 跨 turn 保留会让新 turn 的第一个正常调用被上一 turn 的同键历史判满
			// （「G2 跨 turn 生效」误杀根因）；consecutiveFail 同理，自动续跑的
			// 新 turn（无真人消息介入）若继承上一 turn 的连续失败会被 G2-B 首调即拒。
			for (const rec of state.toolTargets.values()) {
				rec.recentCalls = [];
				rec.calls = 0;
				rec.consecutiveFail = 0;
			}
			// stall-2 类别禁用（watcher 语义裁决）同样以 globalStepSeq 计时，遗留到
			// 新 turn 会让 read/grep 在全新任务里继续被拒；按 turn 一并解除。
			state.categoryDenials.length = 0;
			break;
		case "step/start": {
			// 结算上一步（幂等且顺序安全，见 settleLastStep）。
			settleLastStep(state, typeof d.step === "number" ? d.step : state.stepInTurn + 1);
			advanceStepBoundary(state, d.turn, d.step);
			state.stepInTurn = d.step ?? state.stepInTurn + 1;
			state.stepHadText = false;
			state.stepReasoning = "";
			state.stepChangedFile = false;
			state.stepTargetKeys.clear();
			break;
		}
		case "turn/end":
			// turn 结束（正常/blocked/aborted）清除未消费 pending 项（计划书 §2.2）。
			state.pendingReject = null;
			break;
		case "assistant/message": {
			for (const b of blocksOf(d.message)) {
				if (b.type === "text" && typeof b.text === "string" && b.text.trim()) state.stepHadText = true;
				if (b.type === "reasoning" && typeof b.text === "string" && b.text.length > (state.stepReasoning?.length || 0)) {
					state.stepReasoning = b.text;
				}
			}
			break;
		}
		case "tool/call": {
			// 仅建立 callId→目标键 映射供结果关联；调用计数由 pre-execute 钩子
			// 在放行时维护，避免钩子与事件两条路径重复计数。
			const key = targetKey(d.name, d.arguments);
			state.pendingKeyByStep.set(d.callId ?? `${d.step}:${key}`, key);
			state.stepTargetKeys.add(key);
			break;
		}
		case "tool/result": {
			// callId 真实形状（dsh-llm lib/types/message.js:92-100）：message 无顶层
			// callId，标识在 source.callId 与 toolCallId。旧实现 d.message?.callId 恒
			// undefined → pendingKeyByStep 永不命中、永不删除（评估报告 §3.3）。
			const msg = d.message;
			const callId = msg?.source?.callId ?? msg?.toolCallId ?? msg?.callId;
			let key = callId != null ? state.pendingKeyByStep.get(callId) : null;
			if (callId != null) state.pendingKeyByStep.delete(callId);
			if (key == null) {
				const keys = [...state.pendingKeyByStep.values()];
				key = keys.length ? keys[keys.length - 1] : null;
			}
			const err = failureSignature(msg);
			if (d.step != null) state.stepHadSuccess.set(d.step, !err.error);
			// G2-B 自我强化排除：governor 自己 deny 产生的错误结果既不计入
			// 连续失败也不清零（跳过维护，绝不自证循环）。deny 标记在事件 data
			// 顶层 error（见 isSelfDenialResult 文档），故传整个事件 data。
			if (isSelfDenialResult(d)) break;
			if (key) {
				const rec = state.toolTargets.get(key) || { calls: 0, consecutiveFail: 0, recentCalls: [] };
				rec.consecutiveFail = err.error ? rec.consecutiveFail + 1 : 0;
				// P1-18：G2-A 恢复靠滑窗（recentCalls 按 globalStepSeq 滚动，
				// 见 evaluateG2），此处只维护连续失败计数 G2-B；不再硬清零 calls。
				state.toolTargets.set(key, rec);
			}
			break;
		}
		case "workspace/changes":
		case "file/change":
			state.currentTurnChangedFiles = true;
			state.stepChangedFile = true;
			state.consecutiveZero = 0;
			state.consecutiveUnproductive = 0;
			state.fingerprintSteps.clear();
			break;
		case "user/message":
			// 真实用户介入重置全部计数并清除 pending（插件 spliced 注入不算）。
			if (d.source?.kind === "user") {
				state.consecutiveZero = 0;
				state.consecutiveUnproductive = 0;
				state.fingerprintSteps.clear();
				// 重置全部 G2 账目：连续失败计数与 G2-A 滑窗调用历史。
				for (const v of state.toolTargets.values()) {
					v.consecutiveFail = 0;
					v.recentCalls = [];
					v.calls = 0;
				}
				// 真人介入同样解除上一轮遗留的 stall-2 类别禁用。
				state.categoryDenials.length = 0;
				state.pendingReject = null;
			}
			break;
		default:
			break;
	}
	return state;
}

/**
 * 记录一次助手步骤结束后的"是否有推进"，供 G1-A/G1-B 判定。
 * 只读空转维度（G1-A unproductive）：只读类工具（read/grep/browser 只读/web_fetch）
 * 成功但本步无文本、无文件变更时既不递增也不清零 consecutiveZero，而是记入
 * consecutiveUnproductive——持续翻页空转最终会被 G1-A 拦下，但不会误伤
 * "读几步后产出结论"的正常取证节奏（一旦有文本/写类产出即清零）。
 * @param {object} state
 * @param {object} stepInfo {{step:number, hasText:boolean, reasoning:string, successfulTool:boolean, fileChange:boolean}}
 */
function noteAssistantStep(state, stepInfo) {
	const progressed = stepInfo.hasText || stepInfo.successfulTool || stepInfo.fileChange;
	state.consecutiveZero = progressed ? 0 : state.consecutiveZero + 1;

	// 只读空转账目：成功且无产出（无文本/无文件变更）的步骤计一步；文本或
	// 文件变更清零。successfulTool 但 productiveTool=false 且无文本 → 空转+1。
	const hadDelivery = stepInfo.hasText || stepInfo.fileChange;
	if (hadDelivery || stepInfo.novelTarget === true) state.consecutiveUnproductive = 0;
	else if (stepInfo.successfulTool === true) state.consecutiveUnproductive += 1;
	else state.consecutiveUnproductive = 0; // 失败/无工具的步骤由 consecutiveZero 口径负责

	// P1-15：G1-A 近 N 步滑窗（覆盖隔步空转：单步看似有 reasoning 但整体失能）。
	state.recentSteps.push({ successfulTool: stepInfo.successfulTool === true, reasoningLen: (stepInfo.reasoning || "").length });
	if (state.recentSteps.length > CONFIG.g1aWindowSize) state.recentSteps.shift();

	// P1-15：语义指纹——先用 shingle 集做 Jaccard 命中（抗共同前缀规避），
	// 未命中任何既有桶再回退到原前缀指纹桶计数（兼容既有记录与负例语义）。
	const shingles = shingleSet(stepInfo.reasoning || "");
	const fp = reasoningFingerprint(stepInfo.reasoning || "");
	let fpSteps = 0;
	if (!stepInfo.fileChange) {
		// 阶段一：语义相似（Jaccard≥阈值）的文本归入同一"结论重现"桶。
		let bucketKey = null;
		if (shingles.size > 0) {
			for (const existing of state.fingerprintSteps.keys()) {
				if (existing.startsWith("s:")) {
					const j = jaccardSimilarity(shingles, state.fingerprintShingles?.get(existing) || new Set());
					if (j >= FINGERPRINT_JACCARD_MIN) { bucketKey = existing; break; }
				}
			}
			if (!bucketKey) {
				// 新语义桶键：s:<首个 shingle 哈希>（与既有 "fp" 前缀桶区分）。
				bucketKey = "s:" + ([...shingles][0] || "0");
				if (!state.fingerprintShingles.has(bucketKey)) state.fingerprintShingles.set(bucketKey, shingles);
			}
		} else if (fp) {
			// 阶段二：无可分句 → 回退原前缀指纹（如旧记录继续可命中）。
			bucketKey = fp;
		}
		if (bucketKey) {
			if (!state.fingerprintSteps.has(bucketKey)) state.fingerprintSteps.set(bucketKey, new Set());
			state.fingerprintSteps.get(bucketKey).add(stepInfo.step);
			fpSteps = state.fingerprintSteps.get(bucketKey).size;
		}
	}
	return {
		g1a: state.consecutiveZero >= CONFIG.g1aZeroSteps,
		g1aUnproductive: state.consecutiveUnproductive >= CONFIG.g1aUnproductiveSteps,
		g1b: fpSteps >= CONFIG.g1bFingerprintSteps,
		fingerprint: fp,
		fpSteps,
		consecutiveZero: state.consecutiveZero,
		consecutiveUnproductive: state.consecutiveUnproductive
	};
}

/**
 * 结算"最后一步"（幂等且顺序安全）：把最后一个已开始且未结算的步的交付
 * 证据交给 noteAssistantStep。beforeStep = 即将开始的步号——只结算严格早于
 * 它的步：pre-step(S) 先到时结算 S-1（第 S-1 步已完整结束）；step/start(S)
 * 先到时它已结算过 S-1，pre-step(S) 不得提前结算第 S 步（结果未到）。
 */
function settleLastStep(state, beforeStep) {
	const target = state.stepInTurn;
	const isNewBoundary = typeof beforeStep === "number" ? target < beforeStep : true;
	if (target > 0 && isNewBoundary && target > state.lastSettledStep) {
		// P1-18：stepHadSuccess 只在结算当步读取一次，读取后即删，
		// 避免 Map 随会话总步数单调增长（长跑后无界，评估报告 P1-18）。
		const hadSuccess = state.stepHadSuccess.get(target);
		if (state.stepHadSuccess.has(target)) state.stepHadSuccess.delete(target);
		// G1-A 新颖目标豁免：本步访问了本 turn 尚未出现过的目标（新文件、新检索词、
		// 新页面）属于"取证推进"，不是"原地翻页空转"。旧判据把任何没有文本输出的
		// 只读步一律计成空转，长调查（连读十几个不同文件定位缺陷）必然被误杀。
		let novelTarget = false;
		for (const key of state.stepTargetKeys) {
			if (!state.turnTargets.has(key)) {
				state.turnTargets.add(key);
				novelTarget = true;
			}
		}
		state.stepTargetKeys.clear();
		noteAssistantStep(state, {
			step: target,
			hasText: state.stepHadText === true,
			reasoning: state.stepReasoning || "",
			successfulTool: hadSuccess === true,
			fileChange: state.stepChangedFile === true,
			novelTarget
		});
		state.lastSettledStep = target;
	}
}

/** G1 规则 → 冻结阻断码。 */
function g1Code(rule) {
	if (rule === "G1-A") return BLOCK_CODES.G1_A;
	if (rule === "G1-B") return BLOCK_CODES.G1_B;
	if (rule === "G1-C") return BLOCK_CODES.G1_C;
	throw new Error(`unknown G1 rule ${rule}`);
}

/**
 * G1 判定（pre-step 上依据当前计数）。
 * @param {object} state
 * @returns {{hit:boolean, rule:string|null, detail:object}}
 */
function evaluateG1(state) {
	if (state.stepInTurn + 1 >= CONFIG.g1cMaxStepsPerTurn) {
		return { hit: true, rule: "G1-C", detail: { nextStep: state.stepInTurn + 1, max: CONFIG.g1cMaxStepsPerTurn } };
	}
	if (state.consecutiveZero >= CONFIG.g1aZeroSteps) {
		return { hit: true, rule: "G1-A", detail: { consecutiveZero: state.consecutiveZero, n: CONFIG.g1aZeroSteps } };
	}
	// 只读空转判据：连续 N 步"成功但无交付"（只读成功、零文本、零文件变更）。
	// 覆盖事故 session-7acba9a1 模式：每步都有成功的翻页 read/browser_execute，
	// 旧判据（progressed=hasText||successfulTool||fileChange）被成功只读清零。
	if (state.consecutiveUnproductive >= CONFIG.g1aUnproductiveSteps) {
		return { hit: true, rule: "G1-A", detail: { consecutiveUnproductive: state.consecutiveUnproductive, n: CONFIG.g1aUnproductiveSteps, kind: "unproductive-read-loop" } };
	}
	// P1-15：G1-A 近 N 步滑窗双判据（覆盖事故 step28-30 隔步空转）。
	// 窗内成功工具占比≤阈值 且 reasoning 总字数<阈值 → 判滑窗失速。
	if (state.recentSteps.length >= CONFIG.g1aWindowSize) {
		const win = state.recentSteps.slice(-CONFIG.g1aWindowSize);
		const successCount = win.filter((s) => s.successfulTool).length;
		const successRatio = successCount / win.length;
		const reasoningChars = win.reduce((a, s) => a + s.reasoningLen, 0);
		if (successRatio <= CONFIG.g1aSuccessRatioMax && reasoningChars < CONFIG.g1aReasoningMin) {
			return { hit: true, rule: "G1-A", detail: { windowN: win.length, successRatio: +successRatio.toFixed(2), reasoningChars, maxRatio: CONFIG.g1aSuccessRatioMax, minReasoning: CONFIG.g1aReasoningMin } };
		}
	}
	if (!state.currentTurnChangedFiles) {
		for (const [fp, steps] of state.fingerprintSteps) {
			if (steps.size >= CONFIG.g1bFingerprintSteps) {
				return { hit: true, rule: "G1-B", detail: { fpSteps: steps.size, k: CONFIG.g1bFingerprintSteps, fingerprint: fp.slice(0, 16) } };
			}
		}
	}
	return { hit: false, rule: null, detail: {} };
}

/**
 * G2 判定（pre-execute 上，先于真实执行计数）。
 * @param {object} state
 * @param {string} key
 * @returns {{hit:boolean, rule:string|null, detail:object}}
 */
function evaluateG2(state, key) {
	const rec = state.toolTargets.get(key) || { calls: 0, consecutiveFail: 0, recentCalls: [] };
	// P1-20：终态提交工具豁免（G2-B / G2-A 均只观测不拦截）。
	// 键形如 `fusion_submit_result::#811c9dc5`，工具名即 `::` 之前的部分。
	// 理由见 WORKFLOW_TERMINAL_TOOL 注释：拦截它等于让外部工作流永远收不到提交。
	const toolName = key.includes("::") ? key.slice(0, key.indexOf("::")) : "";
	const terminalTool = WORKFLOW_TERMINAL_TOOL.test(toolName);
	// P1-18：G2-A 改滑窗语义（评估报告 §3.1 事故根因：同目标调用计数永久
	// 累加、无成功出口）。以会话级 globalStepSeq 为时间轴，仅统计滑窗内
	// （最近 g1aWindowSize 步）的同键放行调用；滑出窗自然衰减，成功结果
	// 不硬清零（窗滚动即恢复），避免 g2aSameTargetCalls 后永久拦截。
	const window = Math.max(1, CONFIG.g1aWindowSize);
	const win = (rec.recentCalls || []).filter((s) => state.globalStepSeq - s < window);
	rec.recentCalls = win;
	const inWindow = win.length;
	const willBeCalls = inWindow + 1;
	if (terminalTool) {
		// hadFailure 仅用于观测：无任何失败历史时不必每次落 exempt 日志（防刷屏）。
		const hadFailure = rec.consecutiveFail > 0 || inWindow > 0;
		return {
			hit: false,
			rule: null,
			detail: {
				calls: inWindow,
				willBe: willBeCalls,
				window,
				key,
				terminalToolExempt: true,
				hadFailure,
				consecutiveFail: rec.consecutiveFail
			}
		};
	}
	if (rec.consecutiveFail >= CONFIG.g2bConsecutiveFailures) {
		return { hit: true, rule: "G2-B", detail: { consecutiveFail: rec.consecutiveFail, f: CONFIG.g2bConsecutiveFailures, key } };
	}
	if (willBeCalls > CONFIG.g2aSameTargetCalls) {
		return { hit: true, rule: "G2-A", detail: { calls: inWindow, willBe: willBeCalls, m: CONFIG.g2aSameTargetCalls, window, key } };
	}
	return { hit: false, rule: null, detail: { calls: inWindow, willBe: willBeCalls, window, key } };
}


/** 工具名 → 类别（未知工具返回 null）。 */
function toolCategory(name) {
	return CATEGORY_BY_TOOL.get(name) ?? null;
}


/** soft-cut 抑制升级视作的高置信类（cot-anchor 移植段三类预算口径）。 */
const SOFTCUT_HIGH_CONFIDENCE = new Set(["pseudoTool", "confirmed-repeat", "confirmedRepeat"]);


// ═══════════════════════ §2 「单流内」引擎(源自 dsh-cot-anchor) ═══════════════════════


/**
 * 内核能力的"插座探测"结果缓存 —— 只在首次 `apply` 时算一次。
 *
 * ## 为什么需要它（2026-10-05 事故）
 *
 * 本插件的"生成中途截停"能力，全部挂在宿主钩子 `agent/soft-cut` 上。该钩子
 * 是上游**自 0.1.5-rc.3 起主动移除**的（0.1.5-rc.1/rc.2 有，0.1.6 / 0.1.7 /
 * 0.2.0 / 0.2.1-alpha.1 全无）。升级到 0.2.0-rc.2 后，`ctx.on("agent/soft-cut", …)`
 * 注册的是一个**永不触发**的钩子名：插件加载无报错、日志照常、`tools/post-execute`
 * 的锚点注入也照常工作，唯独截停静默失效。
 *
 * 事故代价是真实的：模型把异常指令和巨量重复内容直接吐进正文，turn 被干停，
 * 全靠用户手动中断（见 docs/soft-cut-missing-rootcause-20261005.md）。
 *
 * ## 移植补丁后的状态（2026-10-06 补记）
 *
 * "上游已移除"只描述**未打补丁的官方内核**。若已用随包工具
 * `tools/apply-softcut-port.mjs` 把软切移植回内核（内核源码中带
 * `DSH-SOFT-CUT-PORT` 标记），钩子恢复、本插件注册的回调正常触发——
 * 实测在 0.2.0 系列已移植内核上单会话触发 4 次（见
 * docs/softcut-kernel-port.md「移植后的一次实测确认」）。能力有无一律以
 * probe 结果（present / absent / unknown）为准，不要据本注释的版本论断
 * 反推运行时状态。
 *
 * 教训不是"插件坏了"，而是"**东西悄悄坏了，没有任何提示**"。因此这里主动探测
 * 一次，把能力的有无明明白白暴露到启动日志和设置页，而不是等故障倒推。
 *
 * ## 探测手段
 *
 * cordis 没有公开的事件自省接口（`ctx.events._hooks` 是内部实现，不作依赖），
 * 所以改为**直接读内核包源码**：解析 `@deepseek-ai/dsh-agent-loop`，在其
 * `lib/index.js` 中查找钩子名字面量。探测失败（包解析不到、读不到、无该文件）
 * 一律返回 `"unknown"`，**绝不让探测本身影响插件加载**。
 */

/**
 * 承载"生成中途截停"能力的宿主钩子名。未打补丁的官方内核自 0.1.5-rc.3 起
 * 移除；经 tools/apply-softcut-port.mjs 移植后恢复（见上方头注释）。
 */
const SOFT_CUT_HOOK = "agent/soft-cut";

/** 0.2.0 起仍存在的流式通知钩子（仅 emit 通知，不能返回 cut 决策）。 */
const ASSISTANT_STREAM_HOOK = "agent/assistant-stream";

/**
 * D9：pre-step waterfall 钩子（现役内核 dsh-agent-loop 的 preStep 每步发起）。
 * 插件在 await next() 之后向 decision.messages 追加结论锚点，使无工具调用的
 * turn 也能获得结论回流。内核是否真提供该钩子由 probeKernelHook 探测上报。
 */
const PRE_STEP_HOOK = "agent/pre-step";

/** 探测结果的三种状态。 */
const CAPABILITY_UNKNOWN = "unknown";
const CAPABILITY_PRESENT = "present";
const CAPABILITY_ABSENT = "absent";

/**
 * 在宿主内核里查找一个钩子名是否仍然存在。
 *
 * @param {string} hookName - 形如 `agent/soft-cut` 的钩子名字面量。
 * @returns {"present"|"absent"|"unknown"} 存在 / 不存在 / 无法确定。
 */
function probeKernelHook(hookName) {
	// 候选解析基点，按可靠性排序：进程入口最贴近真实运行的内核；
	// 其后是 cwd 与插件自身，用于入口不可用的场合。
	const bases = [];
	if (typeof process !== "undefined" && Array.isArray(process.argv) && process.argv[1]) {
		bases.push(process.argv[1]);
	}
	if (typeof process !== "undefined" && typeof process.cwd === "function") {
		try {
			bases.push(join(process.cwd(), "package.json"));
		} catch {
			// cwd 不可用（已被删除等）：跳过该基点。
		}
	}
	for (const base of bases) {
		try {
			const require_ = createRequire(base);
			const kernelPath = require_.resolve("@deepseek-ai/dsh-agent-loop");
			const source = readFileSync(kernelPath, "utf8");
			return source.includes(hookName) ? CAPABILITY_PRESENT : CAPABILITY_ABSENT;
		} catch {
			// 该基点解析或读取失败：换下一个基点。
		}
	}
	return CAPABILITY_UNKNOWN;
}

/**
 * Strong conclusion markers — sentence OPENERS (start of sentence), not mere
 * substrings.  Kept deliberately narrow to avoid pulling in mid-reasoning
 * fragments that merely contain a marker.
 */
const CONCLUSION_OPENERS = [
	// Chinese, anchored at sentence start
	/^因此/,
	/^所以/,
	/^综上/,
	/^结论[是：:]/,
	/^由此(可知|可见)/,
	/^这说明/,
	/^这表明/,
	/^这(就)?意味(着|：)/,
	/^也就是说/,
	/^等价(地|于)/,
	/^因此结论/,
	/^综上(所述)?/,
	/^总结[：:]/,
	// English, anchored at sentence start
	/^therefore/i,
	/^thus[, ]/i,
	/^hence[, ]/i,
	/^in conclusion/i,
	/^consequently/i,
	/^as a result/i,
	/^this (shows|means|implies|indicates) that/i,
	/^it follows that/i,
	/^to summarize/i,
	/^we conclude/i,
	/^the (bottom line|takeaway) is/i
];

/** Characters that signal a sentence is NOT a clean conclusion (throwaway). */
const WEAK_SENTENCE_PATTERNS = [
	/[？！?]/u, // questions / exclamations
	/^(\s*[-*•÷\d.,]|\])/u, // list bullets / code-ish fragments
	/\b(if|whether|maybe|perhaps|could|might)\b/i, // hedged / conditional
	/\b(let'?s|let me|i'?ll|i will|i am going to|i need to|i want to|i should|i must)\b/i, // action intent, not conclusion
	// "the decisive route: ask the user …" / "fastest decisive route is to …"
	// are next-action announcements, not established conclusions.
	/\b(?:fastest\s+|quickest\s+|alternative\s+)?decisive\s+(?:route|move|step|way|approach|path)\b/i,
	/\broute\s*:\s*(?:ask|use|check|get|grep|read|write|run|try|find|obtain|reproduce|open|inspect|make|take)\b/i,
	/^[\s\S]{0,2}$/u, // too short
	/\b(?:if|whether|unless|assuming|suppose|supposing)\b/i, // conditional
	/\b(?:if|如果|除非|假设)\b/u, // conditional (Chinese)
	/[?？]\s*$/u, // trailing question mark
	/\b(?:not sure|uncertain|maybe|perhaps)\b/i, // self-doubt
	/不确定|可能|也许|或许/u, // self-doubt (Chinese)
	/[\s\S]*```[\s\S]*$/u // unclosed code fence (block runs to end of sentence)
];

/**
 * Discourse filler removed ONLY for measuring whether a sentence carries any
 * factual payload.  Removal here never alters model output and never deletes
 * these words from reasoning — Wait/Actually/Hmm are structural control
 * markers in the chain itself; the sole question is whether, after the marker
 * is set aside, any proposition remains.  Keeping this list narrow avoids
 * diluting real content words.
 */
const DISCOURSE_FILLER_PATTERNS = [
	/\bactually\b/ig,
	/\bwait\b/ig,
	/\bhmm+\b/ig,
	/\bhold on\b/ig,
	/\blet me reconsider\b/ig,
	/\bi mean\b/ig,
	/\byou know\b/ig,
	/\bokay\b/ig,
	/\bok\b/ig,
	/\bright\b/ig,
	/^(?:so|well|now|and|but)[\s,，-]*/i,
	/^(?:嗯|好的?|等等|其实|实际上|那个|这个)[\s,，。：:、-]*/
];

/**
 * Residual letter/digit count below which a sentence is treated as having no
 * proposition after its discourse scaffolding is removed.  "Actually, wait."
 * leaves zero content characters; a factual "Wait, the kernel skips marking in
 * verbose mode." leaves a full clause and stays well above the floor.
 */
const MIN_RESIDUAL_CONTENT_CHARS = 6;

/**
 * Correction/retraction signals.  These mark the single most valuable content a
 * reasoning chain can hold: the model realising its earlier idea was wrong.  An
 * anchor that preserves "X was wrong, use Y instead" is exactly what stops the
 * next phase from re-deriving the discarded idea.
 */
const CORRECTION_PATTERNS = [
	/其实/, /实际上/, /等等/, /不对/, /错了/, /搞错/, /误(解|判|以为)/, /修正/, /推翻/, /并非/,
	/\bactually\b/i, /\bwait\b/i, /\bcorrection\b/i, /\bwas wrong\b/i, /\bmistaken\b/i, /\brevert\b/i
];

/**
 * Concrete-content signals.  A sentence naming a file, path, line number,
 * identifier or quantity is almost always usable regardless of how it opens —
 * this is what makes the extractor work on models that state things plainly
 * instead of writing "therefore".
 */
const DENSITY_PATTERNS = [
	/`[^`]+`/, // inline code
	/[\w.-]+\.(?:js|ts|mjs|cjs|jsx|tsx|json|md|yml|yaml|m|py|css|html)\b/i, // file name
	/[\w.-]+[\\/][\w.-]+/, // path
	/(?:line|第)\s*\d+/i, // line reference
	/\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\b/, // dotted identifier
	/\d/ // any quantity
];

/** Hedging that marks a sentence as provisional rather than settled. */
const HEDGE_PATTERNS = [
	/\b(?:maybe|perhaps|possibly|might|could|unsure|not sure|probably)\b/i,
	/\bnot \d+%?\s*sure\b/i,
	/\bnot (?:fully|entirely|quite) (?:sure|certain)\b/i,
	/\buncertain\b/i,
	/也许/, /或许/, /可能/, /不确定/, /大概/
];

/** Score contributed by an explicit conclusion marker; clears the tier on its own. */
const OPENER_TIER_SCORE = 100;
/**
 * Historic numeric floor for fallback-tier admission, superseded by
 * `hasContentSignal` (admission now requires a concrete content signal, not a
 * raw score).  Kept as documentation of the tier's original tuning; the
 * position bonus inside `scoreSentence` still contributes to ranking within
 * both tiers but can no longer admit a sentence on its own.
 */
const FALLBACK_TIER_SCORE = 8;
/**
 * Minimum length for a fallback-tier sentence.  Short lead-ins ("先看了两处代码。")
 * carry no conclusion value and are excluded regardless of position.
 */
const FALLBACK_MIN_CHARS = 12;

/**
 * Explicit conclusion-action signals required alongside a correction word for
 * a sentence to enter the fallback tier (P1-9).  These are unambiguous
 * "the model has settled on X" markers: deciding to adopt a change, retracting
 * a previous claim as false, confirming a proposition.
 */
const CONCLUSION_ACTION_PATTERNS = [
	/决定(采用|使用|切换|走)/, /改为/, /确认.{0,20}为真/, /推翻/, /作废/,
	/\b(?:decide|decided|deciding) to (?:use|adopt|switch|go with)\b/i,
	/\b(?:retract|revoke|withdraw|abandon|discard) (?:that|this|the previous|my earlier)\b/i,
	/\bconfirm(?:ed|ing)?\b.{0,20}\b(?:is|are|was|were) (?:true|correct)\b/i
];

/**
 * Conclusion-predicate signals: a sentence that names WHAT the conclusion is
 * ("根因是…", "改法是…", "The fix is…") carries concrete content even when it
 * mentions no file, path or number.  Kept tighter than bare modal verbs
 * ("需要/应该") so an action-intent lead-in like "我需要确认一下参数" stays out
 * of the fallback tier.
 */
const CONCLUSION_PREDICATE_PATTERNS = [
	/根因(是|为)/, /原因(是|为)/, /问题(是|在于)/, /改法(是|为)/,
	/修复(是|为|方式|办法)/, /解决(办法|方式是|方法)/, /做法(是|为)/,
	/方案(是|为)/, /关键(是|在于)/, /核心(是|在于)/, /症结(是|在于)/,
	/结论(是|为)/, /要点(是|为)/, /之所以/,
	/\bthe (fix|issue|root cause|problem|solution|key|point) is\b/i,
	/\bthis is because\b/i, /\bthe reason is\b/i, /\bthat'?s why\b/i,
	/\bit boils down to\b/i
];

/**
 * Whether a sentence reads as throwaway rather than a settled conclusion.
 * Fallback-tier admission requires BOTH a content signal and NOT a weak
 * sentence, so a churning "Actually, let me just re-run first." (correction
 * word + action intent) stays out while a true "Actually, the issue is X."
 * gets in.
 * @param {string} sentence
 * @returns {boolean}
 */
function isWeakSentence(sentence) {
	return WEAK_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Whether a sentence is pure discourse scaffolding with no proposition left
 * once markers/fillers are set aside ("Actually, wait.", "Hmm.", "OK so—").
 * Such lines are correction/discourse-shaped, so they can clear
 * `hasContentSignal` via the correction patterns, yet they state nothing
 * established and must never be re-injected as a "conclusion".
 *
 * Factual sentences that merely OPEN with a marker ("Wait, the kernel skips
 * marking in verbose mode.") retain a full clause after stripping and are not
 * rejected.
 * @param {string} sentence
 * @returns {boolean}
 */
/**
 * Strip discourse scaffolding (Wait/Actually/Hmm/OK/fillers) from one sentence
 * and return the residual text together with its letter/digit count.  Shared
 * by `isEmptyDiscourseSentence` (pure-marker rejection) and `hasContentSignal`
 * (FIX-02 residual-proposition admission) so the two call sites can never drift
 * into two gauges.  Stripping never mutates model output; it only measures what
 * proposition remains after the markers are set aside.
 * @param {string} sentence
 * @returns {{residual:string, contentChars:number}}
 */
function residualProposition(sentence) {
	let residual = sentence;
	for (const pattern of DISCOURSE_FILLER_PATTERNS) {
		residual = residual.replace(pattern, " ");
	}
	const contentChars = (residual.match(/[\p{L}\p{N}]/gu) || []).length;
	return { residual, contentChars };
}

function isEmptyDiscourseSentence(sentence) {
	return residualProposition(sentence).contentChars < MIN_RESIDUAL_CONTENT_CHARS;
}

/**
 * Whether a sentence carries a concrete content signal beyond its position.
 * Fallback-tier admission requires this, so a trailing "我先把思路记下来。" that
 * merely scores its position bonus can never be mistaken for a conclusion.
 * Position is a ranking hint inside a tier, never an admission signal.
 * @param {string} sentence
 * @returns {boolean}
 */
function hasContentSignal(sentence) {
	// A correction word alone is no longer a content signal (P1-9): it must
	// also carry an explicit conclusion action ("决定采用…", "改为…", "确认 X
	// 为真") or a conclusion predicate ("根因是…").  Otherwise "Actually, let me
	// just try again." would enter the fallback tier as a conclusion.
	const correctionHit = CORRECTION_PATTERNS.some((pattern) => pattern.test(sentence));
	const explicitActionHit = CONCLUSION_ACTION_PATTERNS.some((pattern) => pattern.test(sentence));
	const predicateHit = CONCLUSION_PREDICATE_PATTERNS.some((pattern) => pattern.test(sentence));
	if (correctionHit && explicitActionHit) return true;
	if (predicateHit) return true;
	for (const pattern of DENSITY_PATTERNS) {
		if (pattern.test(sentence)) return true;
	}
	// FIX-02（方案 A）：correction 词领起、剥掉话语脚手架（Wait/Actually/
	// Hmm/OK 等）后残片仍是完整命题（字母数字字符数 >=
	// MIN_RESIDUAL_CONTENT_CHARS，与 isEmptyDiscourseSentence 共用同一常量与
	// 同一份残片计算），且残片本身不是疑问/条件/弱句/自我不确定句时放行。
	// 纯标记句（"Actually, wait."）残片 <6 字符，继续在此被拦截；疑问句、
	// if/如果/unless 条件句、自我不确定句由 WEAK/HEDGE 判据否决。
	if (correctionHit) {
		const { residual, contentChars } = residualProposition(sentence);
		// 剥词后行首常残留 "Actually," 的逗号/破折号等脚手架标点；弱句判据的
		// 行首列表符号正则会把这种残留标点误判成列表残片，故判定前只剔除
		// 残片行首的空白与标点（字符数口径仍用未修剪的 contentChars）。
		const residualPropositionText = residual.replace(/^[\s\p{P}\p{S}]+/u, "");
		if (contentChars >= MIN_RESIDUAL_CONTENT_CHARS
			&& !isWeakSentence(residualPropositionText)
			&& !HEDGE_PATTERNS.some((pattern) => pattern.test(residualPropositionText))) {
			return true;
		}
	}
	return false;
}

/**
 * Score one sentence as a candidate conclusion.  Explicit discourse markers
 * dominate by design: they clear `OPENER_TIER_SCORE` alone, so the softer
 * features below can only reorder candidates inside a tier and can never move a
 * sentence between tiers by accident.
 * @param {string} sentence
 * @param {number} index - position within the reasoning text.
 * @param {number} total - total sentence count.
 * @returns {number}
 */
function scoreSentence(sentence, index, total) {
	let score = 0;
	if (CONCLUSION_OPENERS.some((pattern) => pattern.test(sentence))) score += OPENER_TIER_SCORE;
	if (CORRECTION_PATTERNS.some((pattern) => pattern.test(sentence))) score += 30;

	let density = 0;
	for (const pattern of DENSITY_PATTERNS) {
		if (pattern.test(sentence)) density += 1;
	}
	score += Math.min(density, 4) * 8;

	// Later sentences are likelier to hold the settled conclusion.
	score += total > 1 ? Math.round((index / (total - 1)) * 15) : 15;

	if (HEDGE_PATTERNS.some((pattern) => pattern.test(sentence))) score -= 25;
	if (WEAK_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence))) score -= 40;
	return score;
}

/**
 * Extract the most valuable conclusion sentences from a reasoning block.
 *
 * Tiered selection rather than a single keyword gate:
 *  - Tier 1 — sentences opening with an explicit marker ("所以…", "therefore…").
 *    When any exist they are the only candidates, which keeps the long-standing
 *    behavior (and its tests) stable.
 *  - Tier 2 — when NO marker exists anywhere, fall back to the highest-scoring
 *    declarative sentences instead of returning nothing.  This is the case the
 *    old keyword-only gate silently dropped: a model that simply states
 *    "根因是 CSS 覆盖了定位" without any discourse marker.
 * @param {string} reasoning - full reasoning text.
 * @param {number} minReasoningChars - skip entirely when reasoning is shorter.
 * @param {number} maxPoints - max conclusions to keep.
 * @param {number} maxPointChars - cap per point.
 * @param {{ctx?:object,sessionId?:string|null,turn?:number|null,step?:number|null}} [evidence]
 *     optional event evidence for D4 point-truncated events; absent in unit
 *     tests, where points are still kept whole but no event is emitted.
 * @returns {string[]}
 */
function extractConclusions(reasoning, minReasoningChars, maxPoints, maxPointChars, evidence) {
	if (typeof reasoning !== "string" || reasoning.length < minReasoningChars) return [];

	const sentences = splitSentences(reasoning);
	if (sentences.length === 0) return [];

	const scored = sentences.map((text, index) => ({
		text,
		index,
		score: scoreSentence(text, index, sentences.length)
	}));

	let pool = scored.filter((item) => item.score >= OPENER_TIER_SCORE);
	if (pool.length === 0) {
		pool = scored.filter((item) => item.text.length >= FALLBACK_MIN_CHARS
			&& hasContentSignal(item.text)
			&& !isWeakSentence(item.text)
			&& !isEmptyDiscourseSentence(item.text));
	} else {
		// Explicit-opener tier still drops a pure marker line ("So, wait, hmm.")
		// that opens with a conclusion marker but states nothing.
		pool = pool.filter((item) => !isEmptyDiscourseSentence(item.text));
	}
	// P1-9 admission hard gate: hedge and weak signals reject a sentence from
	// EITHER tier — openers only contribute ranking score, they never waive
	// this gate.  This keeps "Actually, I'm not 100% sure about the
	// interaction." (opener + hedge = 90 after score penalty) out of anchors.
	pool = pool.filter((item) => !isWeakSentence(item.text)
		&& !HEDGE_PATTERNS.some((pattern) => pattern.test(item.text)));
	if (pool.length === 0) return [];

	pool.sort((a, b) => b.score - a.score || b.index - a.index);

	const picked = [];
	const seen = new Set();
	for (const item of pool) {
		if (picked.length >= maxPoints) break;
		const key = item.text.slice(0, 40).toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		picked.push(item);
	}

	// Restore reading order so the rendered anchor reads like the original.
	picked.sort((a, b) => a.index - b.index);
	// D4「宁可不切」：超长点整条保留（不再静默硬切），同时发
	// cot-anchor/point-truncated 事件记录"本应截断"的事实（载荷含
	// suppressReason 与 evidenceSeq）。
	return picked.map((item) => {
		if (item.text.length > maxPointChars) {
			emitPointTruncatedEvent(evidence, maxPointChars, item.text);
		}
		return item.text;
	});
}

/**
 * Split reasoning text into sentences on terminal punctuation, preserving the
 * sentence including its trailing stop.  Newlines and semicolons are NOT treated
 * as boundaries because reasoning often wraps clauses across lines.  A period
 * immediately following a digit is NOT a boundary either: numbered steps are
 * written as "1. ... 2. ..." and splitting there truncates a conclusion at its
 * first list item (the same rule also keeps decimals like "3.14" intact).
 * A period (or Chinese stop) whose next token is another numbered item
 * ("do x. 2. do y." / "参数。 2. 再执行") is kept as well, so a step body
 * ending in a stop does not split the list.  Recognized numbering marks are
 * ".", "、" and ")".
 * An ASCII period is a boundary ONLY when followed by whitespace or the end
 * of the text: a period glued to the next word character belongs to code or
 * a dotted identifier ("card.openCard", "file.js", "obj.method"), never a
 * sentence stop, so splitting there truncated conclusions mid-token.
 * A period that is itself adjacent to another period is NEVER a boundary: a
 * run of periods is an ellipsis ("(j1,k1),(j2,k1),...,(jL,k1)") or a dotted
 * leader, and treating the last dot as a sentence stop truncated enumerations
 * at the "..." and dropped everything after it.
 * Quote-aware (P1-3, 2026-10-22): terminal punctuation INSIDE a quoted span
 * ("现在写正式报告。", 「…」, '…', "…") is not a boundary.  Without this a
 * quote's inner 。 ended one sentence and the remainder — often opening with a
 * Tier-1 opener like "因此" — surfaced as a fake standalone sentence that fed
 * the conclusion extractor (observed in production reasoning drafts).  Inner
 * stops are masked to Unicode private-use placeholders before splitting and restored
 * afterwards, so sentence text itself is unchanged.
 * @param {string} text - raw reasoning text.
 * @returns {string[]} sentences, trimmed, blanks removed.
 */
const QUOTE_OPEN_TO_CLOSE = new Map([
	["\u201C", "\u201D"],
	["\u2018", "\u2019"],
	["\u300C", "\u300D"],
	["\u300E", "\u300F"],
]);
const TOGGLE_QUOTES = new Set(['"', "'"]);
const QUOTED_STOP_MASK = new Map([
	["。", "\uE000"],
	["！", "\uE001"],
	["？", "\uE002"],
	["!", "\uE003"],
	["?", "\uE004"],
	[".", "\uE005"],
]);
const QUOTED_STOP_UNMASK = new Map([...QUOTED_STOP_MASK].map(([plain, masked]) => [masked, plain]));
const QUOTED_STOP_UNMASK_RE = /[\uE000-\uE005]/g;

function maskQuotedSentenceStops(text) {
	let masked = "";
	const pendingCloseStack = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (pendingCloseStack.length > 0 && ch === pendingCloseStack[pendingCloseStack.length - 1]) {
			pendingCloseStack.pop();
			masked += ch;
			continue;
		}
		if (QUOTE_OPEN_TO_CLOSE.has(ch)) {
			pendingCloseStack.push(QUOTE_OPEN_TO_CLOSE.get(ch));
			masked += ch;
			continue;
		}
		if (TOGGLE_QUOTES.has(ch)) {
			if (pendingCloseStack.length > 0 && pendingCloseStack[pendingCloseStack.length - 1] === ch) {
				pendingCloseStack.pop();
			} else {
				pendingCloseStack.push(ch);
			}
			masked += ch;
			continue;
		}
		const maskedStop = QUOTED_STOP_MASK.get(ch);
		if (maskedStop !== undefined && pendingCloseStack.length > 0) {
			masked += maskedStop;
			continue;
		}
		masked += ch;
	}
	return masked;
}

function unmaskQuotedSentenceStops(sentence) {
	return sentence.replace(QUOTED_STOP_UNMASK_RE, (maskedStop) => QUOTED_STOP_UNMASK.get(maskedStop));
}

function splitSentences(text) {
	const masked = maskQuotedSentenceStops(text.replace(/\n+/g, " "));
	const raw = masked.split(/(?<=[。！？!?](?!\s*\d+[.、)])|(?<![\d.])\.(?!\.)(?!\s*\d+[.、)])(?=\s|$))\s*/u);
	return raw.map((s) => unmaskQuotedSentenceStops(s.trim())).filter((s) => s.length > 0);
}

// --- D4/D5/D6 事件与校验基础设施 ---------------------------------------------
// 插件侧可观测事件统一走 ctx.emit(eventName, payload)。事件名钉死（改名必须
// 同步本仓 spec(docs/specs/cot-anchor-governor-merge.md)），载荷统一携带 sessionId/turn/step/evidenceSeq 四元组；
// 纯函数提取器拿不到会话句柄时对应字段为 null（不省略，保证载荷形状稳定）。
const EVENT_REFLOW_MISJUDGED = "cot-anchor/reflow-misjudged";
const EVENT_POINT_TRUNCATED = "cot-anchor/point-truncated";
const EVENT_LENGTH_CONSERVATION_FAILED = "cot-anchor/length-conservation-failed";
const EVENT_STRUCTURE_UNBALANCED = "cot-anchor/structure-unbalanced";
// P1-20 可观测事件：锚点注入/去重拦截/软切实际 take/被 inbox 续跑。
const EVENT_ANCHOR_DEDUP_SKIPPED = "cot-anchor/anchor-dedup-skipped";
const EVENT_SOFTCUT_TAKEN = "cot-anchor/softcut-taken";

/** Monotonic evidence sequence for event payloads（D4 工程要求：事件必带 evidenceSeq）. */
let evidenceSeqCounter = 0;
function nextEvidenceSeq() {
	evidenceSeqCounter += 1;
	return evidenceSeqCounter;
}

/**
 * Build the common evidence header every cot-anchor event carries.
 * @param {string|null} sessionId
 * @param {number|null} turn
 * @param {number|null} step
 * @returns {{evidenceSeq:number,sessionId:string|null,turn:number|null,step:number|null}}
 */
function evidenceBase(sessionId, turn, step) {
	return {
		evidenceSeq: nextEvidenceSeq(),
		sessionId: sessionId ?? null,
		turn: typeof turn === "number" ? turn : null,
		step: typeof step === "number" ? step : null
	};
}

/**
 * Send one cot-anchor event through the host context.  Never throws: a missing
 * `ctx.emit` (old host) or an emit failure is logged and swallowed so events
 * can never break the injection flow itself.
 * @param {object|undefined} ctx - host context.
 * @param {string} eventName - one of the EVENT_* constants.
 * @param {object} payload - already carries the evidence header.
 */
function emitCotAnchorEvent(ctx, eventName, payload) {
	if (!ctx || typeof ctx.emit !== "function") return;
	try {
		ctx.emit(eventName, payload);
	} catch (error) {
		console.warn(`[dsh-stall-governor] 事件发送失败 ${eventName}：${error?.message ?? error}`);
	}
}

/**
 * D4: emit the point-truncated event for one over-long conclusion point.
 * 「宁可不切」口径下点整条保留（keptWhole:true），事件只记录"本应截断"的
 * 事实；`evidence` 缺省（单测直调提取器）时只保留不发。
 * @param {{ctx?:object,sessionId?:string|null,turn?:number|null,step?:number|null}|undefined} evidence
 * @param {number} maxPointChars
 * @param {string} originalText
 */
function emitPointTruncatedEvent(evidence, maxPointChars, originalText) {
	if (!evidence || typeof evidence !== "object") return;
	emitCotAnchorEvent(evidence.ctx, EVENT_POINT_TRUNCATED, {
		...evidenceBase(evidence.sessionId, evidence.turn, evidence.step),
		suppressReason: "over-max-point-chars",
		maxPointChars,
		originalChars: originalText.length,
		keptWhole: true,
		preview: originalText.slice(0, 80)
	});
}

/**
 * D5 长度守恒：锚点正文必须能由其声称携带的结论条目逐字重建（标题行 +
 * "i. " 编号 + 换行 + 条目原文）。任何漂移都意味着注入管线损坏，调用方应
 * 放弃注入并发 length-conservation-failed 事件，绝不带病注入。
 * @param {string} body - rendered anchor body.
 * @param {string[]} points - the conclusion points rendered into it.
 * @returns {{ok:boolean,expectedChars:number,actualChars:number}}
 */
function checkLengthConservation(body, points) {
	if (typeof body !== "string" || !Array.isArray(points)) {
		return { ok: false, expectedChars: 0, actualChars: 0 };
	}
	const headerBreak = body.indexOf("\n");
	const payload = headerBreak === -1 ? "" : body.slice(headerBreak + 1);
	const expected = points.map((p, i) => `${i + 1}. ${p}`).join("\n");
	return {
		ok: payload === expected,
		expectedChars: expected.length,
		actualChars: payload.length
	};
}

/**
 * D6 结构配平：括号/全角括号不配平的正文注入后会污染后续生成。纯函数，
 * 与 insideUnclosedCodeFence（代码围栏奇偶）配合使用：本函数管括号族，
 * 围栏交给 insideUnclosedCodeFence。
 * @param {string} text
 * @returns {{ok:boolean,unbalanced:string[]}} unbalanced 为残余的开括号样本（最多 3 个）。
 */
function checkStructuralBalance(text) {
	if (typeof text !== "string") return { ok: true, unbalanced: [] };
	const pairs = { "(": ")", "[": "]", "{": "}", "（": "）", "【": "】", "《": "》" };
	const closers = new Set(Object.values(pairs));
	const stack = [];
	for (const ch of text) {
		if (pairs[ch]) stack.push(ch);
		else if (closers.has(ch)) {
			const open = stack.pop();
			if (!open || pairs[open] !== ch) return { ok: false, unbalanced: [ch] };
		}
	}
	if (stack.length > 0) return { ok: false, unbalanced: stack.slice(-3) };
	return { ok: true, unbalanced: [] };
}

/**
 * Build the anchor body from conclusions.
 * @param {string[]} points
 * @param {boolean} [softCut] - use the mid-stream continuation wording.
 * @returns {string|null} rendered anchor text, or null when empty.
 */
function renderAnchor(points, softCut = false) {
	if (points.length === 0) return null;
	const lines = points.map((p, i) => `${i + 1}. ${p}`).join("\n");
	if (softCut) {
		return `COT anchor — conclusions established above, before this continuation. Do not re-derive them; build on them and continue:\n${lines}`;
	}
	return `COT anchor — conclusions established before the last tool call. Do not re-derive these; build on them:\n${lines}`;
}

/**
 * Gate for the transition soft-cut: at least one settled conclusion marked by
 * an EXPLICIT conclusion opener ("所以/因此/综上/therefore …") must already
 * exist before the transition phrase.
 *
 * Why Tier-1 only: the transition cut means "phase A reached conclusions, the
 * model is now starting phase B — split and anchor".  Allowing the Tier-2
 * fallback (any declarative sentence carrying a file name / backtick / number
 * counts as a "conclusion") made the gate fire on ordinary technical reasoning
 * — such prose almost always contains those density signals, so a cut landed
 * at 5–10 % of the generation with nothing actually settled.  Tier-2 fallback
 * stays available for the post-execute anchor, where erring toward reminding
 * is cheap; the mid-stream cut is destructive and must stay conservative.
 * @param {string} reasoning
 * @param {number} minReasoningChars
 * @returns {boolean}
 */
function hasExplicitConclusion(reasoning, minReasoningChars) {
	if (typeof reasoning !== "string" || reasoning.length < minReasoningChars) return false;
	return splitSentences(reasoning).some((sentence) =>
		CONCLUSION_OPENERS.some((pattern) => pattern.test(sentence))
	);
}

/**
 * Walk the surface backwards for the most recent assistant message's reasoning.
 * @param {object} session
 * @returns {string} joined reasoning text, or "" when none.
 */
function latestReasoningText(session) {
	const nodes = session.surface?.nodes;
	if (!nodes || nodes.length === 0) return "";

	for (let i = nodes.length - 1; i >= 0; i--) {
		const event = session.eventAt(nodes[i]);
		if (!event || event.type !== "assistant/message") continue;
		const blocks = event.data?.message?.content;
		if (!Array.isArray(blocks)) continue;
		const reasoning = blocks.filter((b) => b.type === "reasoning").map((b) => b.text || "").join("\n");
		return reasoning;
	}
	return "";
}

/**
 * Walk the surface backwards for the most recent assistant message's thinking
 * content as an anchor source, DECRADING to the text block when no reasoning
 * block exists.
 *
 * Rationale (2026-10-03): with the current model, roughly 80% of assistant
 * messages carry NO reasoning block — the model streams its thinking directly
 * into the text block.  Anchor extraction that only reads `type==="reasoning"`
 * therefore returns empty in most turns and cot-anchor silently stops
 * reminding.  This fallback feeds the SAME scoring/extraction pipeline (which
 * already filters weak sentences via isWeakSentence / hasContentSignal), so
 * extracting "settled conclusions" from a text block is semantically safe: a
 * conclusion reached in text is just as established as one reached in
 * reasoning.  Prefer reasoning when present (stable long-standing behavior);
 * text is used only as a fallback so the reminder mechanism keeps working on
 * reasoning-less turns.
 * @param {object} session
 * @returns {string} joined thinking text (reasoning preferred, else text), or "" when none.
 */
function latestThinkingText(session) {
	const nodes = session.surface?.nodes;
	if (!nodes || nodes.length === 0) return "";

	for (let i = nodes.length - 1; i >= 0; i--) {
		const event = session.eventAt(nodes[i]);
		if (!event || event.type !== "assistant/message") continue;
		const blocks = event.data?.message?.content;
		if (!Array.isArray(blocks)) continue;
		const reasoning = blocks.filter((b) => b.type === "reasoning").map((b) => b.text || "").join("\n");
		if (reasoning.length > 0) return reasoning;
		const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
		if (text.length > 0) return text;
	}
	return "";
}

/**
 * Walk the surface backwards for the most recent assistant message's
 * provider/model, used as the LLM-refinement fallback route.
 * @param {object} session
 * @returns {{provider?:string, model?:string}|null}
 */
function latestAssistantSource(session) {
	const nodes = session.surface?.nodes;
	if (!nodes || nodes.length === 0) return null;

	for (let i = nodes.length - 1; i >= 0; i--) {
		const event = session.eventAt(nodes[i]);
		if (!event || event.type !== "assistant/message") continue;
		const source = event.data?.message?.source;
		if (source && (source.provider || source.model)) {
			return { provider: source.provider, model: source.model };
		}
	}
	return null;
}

/**
 * Deep-freeze a plain object so inbox mutation can never alias or double-commit
 * the same anchor under a shared reference.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
	if (value === null || typeof value !== "object") return value;
	for (const key of Object.keys(value)) deepFreeze(value[key]);
	return Object.freeze(value);
}

/**
 * Build one anchor context entry: stable unique id + deep-frozen, matching the
 * official repeat-tool-reminder notice shape.
 * @param {string} text
 * @param {string} summary
 */
function buildAnchorContext(text, summary) {
	return deepFreeze(structuredClone({
		id: randomUUID(),
		role: "user",
		content: [{ type: "text", text }],
		source: {
			...PLUGIN_SOURCE,
			form: "notice",
			summary
		}
	}));
}

/**
 * 命令执行纪律全文（最高优先级提醒）。
 *
 * v0.2.1 起不再作为 tools/post-execute 的独立 user 通知注入（旧实现每次工具
 * 执行后单独堆叠一条 `cot-anchor: exec-discipline` 消息），而是经
 * systemPrompt.context 注册为运行时上下文快照（"Current runtime context…"）
 * 中的一个固定段：每轮只出现一次、位置在记忆规则之后、用户唠叨之前，且为
 * 常量前缀，有利于 KV 前缀缓存命中。
 *
 * 发布版为插件自带通用纪律（不引用任何用户本机路径）；本机用户如需个人化
 * 纪律，可自行修改本数组后重启，或在设置中关闭「随锚点注入命令执行纪律块」。
 */
const EXEC_DISCIPLINE_TEXT = [
	"⓪ 命令执行纪律（最高优先，高于一切）：跑任何命令（shell/构建/安装/下载/测试/长任务）都不许盲等，且必须核验结果。",
	"① 单次等待 ≤10 秒；禁止超长阻塞等待、禁止长延时 sleep 后再检查。",
	"② 每轮必须查并打印一个『增长型标量』——目标文件/目录是否出现、字节数是否变大、日志是否追加、输出行数是否增加。",
	"③ 『进程还在』『任务 state=running』不算进展证据，禁止据此继续等；连续 2 轮零增长即判僵死，",
	"用精确 PID 中断（禁止按命令名通配批量杀）并立刻换办法（换镜像源→换工具/协议→复用本机缓存→降级最小子集→报告用户）。",
	"④ 起长任务前把精确 PID 落盘。⑤ 长任务按固定短间隔（≤10 秒）轮询等待，禁止盲等。",
	"⑥ 命令结束必须核验：看退出码、看产物是否真的生成、看日志关键行，不以『命令跑了没报错』当成功。",
	"⑦ 输出为空/被吞/返回 -1 时，第一动作是读该命令本应写出的报告或产物判成功，不要追加复查命令。",
	"⑧ 同一命令同样参数失败最多重试 2 次，之后换办法或上报。"
].join("");

/**
 * 纪律段在运行时上下文快照中的排序键。
 * auto-memory 记忆规则段 order=10000（其尾部 surface 为 10001），
 * dsh-naonao 用户唠叨段 order=100000；取 20000 保证纪律段位于
 * 「记忆规则之后、naonao 之前」，并留出充足间隔。
 */
const EXEC_DISCIPLINE_CONTEXT_ORDER = 20000;

/**
 * Transition sentences that mark the START of a new reasoning phase inside a
 * single generation ("long think A → I will now… → long think B").  These are
 * the soft-cut triggers: when the model emits one just after already reaching
 * conclusions, the loop should split here and inject an anchor so phase B does
 * not re-derive phase A's conclusions.  Kept deliberately as a small tail scan:
 * the trigger must appear in the most recent tail of the generated text.
 *
 * P1-4 tightened (2026-10-22): every pattern now
 * REQUIRES an execution verb after the trigger word (limited bridge words
 * between them), so zero-width matches are impossible — the old Chinese
 * pattern `现在(我|我们)?(开始|来|先|准备)?` fired on a bare "现在" and the
 * English `(now|next|then)…(i|let's…)` fired on status sentences like "Now I
 * have the full transition branch chain."  Both shapes poisoned real analysis
 * output.  The bridge list is enumerated (subject/auxiliary/particle), NOT an
 * arbitrary-character window, except the 把/给/对/从/用/按-object slot which
 * allows ≤4 chars before the verb; regex backtracking resolves the
 * dual role of 开始/着手/动手 (auxiliary vs. verb itself): "下面开始逐条修复"
 * matches via the verb arm after the bridge arm backtracks.
 *
 * P1-4-r2 (2026-10-22, regression fix): the verb lists were initially too
 * narrow — real transitions use verbs outside the first cut (做/干/弄/调/补/
 * 换/覆盖/回填/构造/合并/转换/迁移/发布/接入/适配/筛选/迭代/剪枝/去重/缓存/
 * 挂载/绑定/注册/调整/校正/检索/索引/加密/验收/审计/监控/推送/订阅 …, and
 * rewrite/replace/rerun/retest/patch/wire/relocate/prune/revert/mock/stub/
 * render/mount/register/emit/publish/merge/rebase/pin/watch/boot/probe/
 * profile/benchmark/assert/instrument/split/hoist/cache/prefetch on the EN
 * side), and the subject bridge lacked the extremely common 让 ("现在让我开始
 * 改…").  Genuine phase-B openings silently stopped matching.  Both lists are
 * widened again while keeping the load-bearing property: a verb is still
 * REQUIRED, so zero-width bare-trigger matches remain impossible.
 */
const TRANSITION_EXEC_VERBS_CN =
	"修改|改|删|写|生成|落地|替换|调用|跑|更新|添加|加|建|实现|修复|重构|输出|创建|新建|提交|执行|检查|查看|读|看|验证|测试|运行|安装|下载|构建|编译|分析|处理|计算|梳理|整理|确认|核对|扫描|排查|定位|审查|求解|推导|列出|汇总|继续|进入|切换|着手|动手|开始|发起|启动|部署|保存|导出|落盘|总结|归纳|完善|清理|清洗|比对|对照|测量|观察|跟踪|安排|记录|打开|关闭|制定|撰写|编写|编制|出具|交付|发送|拉取|抓取|提取|诊断|拆分|拆解|拆|展开|做|干|弄|调|刷|补|换|退|覆盖|回填|补齐|构造|组装|打通|复核|回测|截断|合并|转换|编码|解码|备份|恢复|迁移|升级|降级|回滚|发布|上线|接入|对接|适配|筛选|过滤|排序|分组|统计|拟合|迭代|回溯|剪枝|去重|归一|缓存|挂载|绑定|注册|调整|校正|修正|补偿|抑制|增强|缩放|映射|变换|差分|卷积|查找|检索|索引|哈希|加密|解密|验收|评审|审计|监控|告警|上报|推送|订阅|装载|卸载|裁剪|扩充|精简|润色|改写|重写|移植";
const TRANSITION_EXEC_VERBS_EN =
	"start|begin|proceed|move|switch|turn|head|go|check|look|read|write|run|verify|test|try|fix|implement|build|create|make|update|execute|apply|refactor|clean|sync|commit|push|download|install|configure|inspect|dive|dig|extract|parse|analyze|compare|compute|calculate|finish|complete|continue|resume|report|summarize|deliver|draft|design|plan|work|attack|tackle|get|handle|address|resolve|debug|trace|derive|validate|confirm|review|audit|explore|examine|scan|search|find|fetch|load|save|edit|modify|delete|remove|add|show|walk|rewrite|replace|rerun|retest|recheck|revisit|patch|wire|relocate|reorder|prune|revert|drop|swap|tune|align|normalize|sanitize|mock|stub|log|print|render|mount|unmount|register|unregister|expose|import|scaffold|generate|produce|emit|publish|ship|land|merge|rebase|tag|version|bump|pin|unpin|watch|listen|serve|host|boot|restart|stop|clear|reset|init|setup|teardown|probe|profile|benchmark|assert|measure|instrument|wrap|unwrap|split|join|merge|hoist|inline|cache|prefetch|precompile|warm|cooldown";
// subject / auxiliary / particle bridge allowed between trigger and verb;
// the 把/给/对/从/用/按 arm opens a short object slot (把字句 inverts word order,
// ≤4 chars so a full clause cannot hide an unrelated verb inside the window).
// P1-4-r2 (2026-10-22): the subject arm accepts an optional 让 prefix
// ("现在让我开始改…" — 让 is extremely common in real reasoning transitions and
// its absence made whole classes of genuine phase-B openings undetectable), and
// a `\s*` gap is tolerated between bridge and verb because Latin-script verbs
// are routinely space-separated in mixed CJK prose ("现在我要 rewrite 这个模块").
const TRANSITION_BRIDGE_CN =
	"(?:(?:让)?(?:那我|咱|我|我们|咱们))?(?:(?:先|直接|马上|立即|就|再|开始|着手|动手|准备|打算|要|将|会|得|需要))?(?:(?:去|来))?\\s*(?:(?:把|给|对|从|用|按)[^。！？!?;；\\n]{0,4}?)?";

const TRANSITION_PATTERNS = [
	/(^|[\n。！？!?.;；])\s*接下来[，,、]?/u.source + TRANSITION_BRIDGE_CN + "\\s*(" + TRANSITION_EXEC_VERBS_CN + ")",
	/(^|[\n。！？!?.;；])\s*下一步[，,、]?/u.source + TRANSITION_BRIDGE_CN + "\\s*(" + TRANSITION_EXEC_VERBS_CN + ")",
	/(^|[\n。！？!?.;；])\s*下面[，,、]?/u.source + TRANSITION_BRIDGE_CN + "\\s*(" + TRANSITION_EXEC_VERBS_CN + ")",
	/(^|[\n。！？!?.;；])\s*现在[，,、]?/u.source + TRANSITION_BRIDGE_CN + "\\s*(" + TRANSITION_EXEC_VERBS_CN + ")",
	/(^|[\n。！？!?.;；])\s*那我就?[，,、]?/u.source + TRANSITION_BRIDGE_CN + "\\s*(" + TRANSITION_EXEC_VERBS_CN + ")",
	/(^|[\n。！？!?.;；])\s*那么[，,、]?/u.source + TRANSITION_BRIDGE_CN + "\\s*(" + TRANSITION_EXEC_VERBS_CN + ")",
	/(^|[\n。！？!?.;；])\s*我先[，,、]?/u.source + TRANSITION_BRIDGE_CN + "\\s*(" + TRANSITION_EXEC_VERBS_CN + ")",
	// 裸 "let me"（let me check/read/verify 这类普通工作短语）不是阶段转折，
	// 曾在真实英文推理中造成大量提前软切断；只有显式宣布进入新阶段时才算转折，
	// 与中文侧要求"接下来/下一步/现在开始"的口径对齐。
	`(^|[\\s.。;；])\\blet\\s+me\\s+(now|start|begin|move on|proceed|go ahead)\\b`,
	`(^|[\\s.。;；])\\b(now|next|then)\\b[, ]?\\s+(?:i\\s+will|i\\s+am\\s+going\\s+to|i'?ll|let'?s|let\\s+me|i|we)\\b[^.!?\n]{0,24}?\\b(${TRANSITION_EXEC_VERBS_EN})\\b`,
	`(^|[\\s.。;；])\\bi\\s+(?:will|am\\s+going\\s+to|'ll)\\s+now\\b[^.!?\n]{0,16}?\\b(${TRANSITION_EXEC_VERBS_EN})\\b`
].map((entry) => (typeof entry === "string" ? new RegExp(entry, "iu") : entry));

/**
 * Decide whether the current generation prefix should be soft-cut so an anchor
 * can be injected before the next reasoning phase.  Requires BOTH enough prior
 * text (real conclusions already reified) AND a transition sentence near the
 * newest tail, AND that the transition has actually started to unfold.
 *
 * The unfold rule exists because soft-cut is consulted mid-stream (every
 * ~32 new chars): the moment the model emits "我先" the transition pattern
 * fires, but the thought has barely begun.  Cutting there truncates the
 * generation at the transition's first two characters, and the conclusion
 * extractor then has to work with a broken tail ("所以步骤： 1. 先") — the
 * exact corrupt anchor observed in production logs.  So we require enough
 * FOLLOW-ON content after the transition word before cutting.
 *
 * The threshold is deliberately NOT terminal punctuation: streaming output may
 * end a sentence with a right paren, a quote, a code fence, or simply not have
 * produced the full stop yet — none of those mean the model is stuck at the
 * transition word.
 * @param {string} fullVisibleText - all visible text (text + reasoning) generated so far.
 * @param {number} minReasoningChars - minimum length before which soft-cut is never triggered.
 * @returns {boolean}
 */
function wantsSoftCut(fullVisibleText, minReasoningChars) {
	if (typeof fullVisibleText !== "string" || fullVisibleText.length < minReasoningChars) return false;
	const tail = fullVisibleText.slice(-SOFT_CUT_SCAN_TAIL);

	// Locate the LAST transition match and its end offset within the tail.
	// Patterns carry no /g flag, so loop with a global copy to walk all matches.
	// transitionVerb keeps that same match's execution verb (its LAST capture
	// group): since P1-4 the verb is part of the match, so the follow text no
	// longer starts with the verb — the investigation gate below would otherwise
	// never see it ("我先看一下配置" matched "我先看", leaving "一下配置…").
	let transitionEnd = -1;
	let transitionVerb = "";
	for (const pattern of TRANSITION_PATTERNS) {
		const globalPattern = new RegExp(pattern.source, `${pattern.flags.includes("g") ? "" : "g"}${pattern.flags.includes("i") ? "i" : ""}${pattern.flags.includes("u") ? "u" : ""}`);
		let match;
		while ((match = globalPattern.exec(tail)) !== null) {
			if (match.index + match[0].length > transitionEnd) {
				transitionEnd = match.index + match[0].length;
				transitionVerb = match.length > 1 ? match[match.length - 1] : "";
			}
		}
	}
	if (transitionEnd < 0) return false;

	// A transition that is only a connective cascade mid-sentence is not a cut.
	if (CASCADING_PATTERNS.some((pattern) => pattern.test(tail))) return false;

	// The transition must have started to unfold: enough characters after the
	// transition word, so a bare "我先" (2 chars) never triggers a cut.
	const followLen = tail.length - transitionEnd;
	if (followLen < SOFT_CUT_MIN_FOLLOW_CHARS) return false;

	// The transition must be an EXECUTION announcement, not an ongoing
	// investigation.  A transition whose leading action is investigative
	// ("我先读一下 X", "next i will check the call chain") is the model still
	// researching — cutting there severs ordinary continuing text.  Only an
	// execution announcement (write/edit/refactor/run/…) is the phase-B cut
	// this detector targets.  The matched verb is prepended so the gate judges
	// the announced action itself, not the object that follows it.
	//
	// 修复④：保留单次调查前缀放行（设计初衷：放走一次性的"我先看看配置"），
	// 但若最近尾窗内同一调查前缀重复 ≥ INVESTIGATIVE_PREFIX_REPEAT_MAX 次
	// 且动作动词远多于执行动词（典型空转特征），则收紧为可切。
	const tightenInfo = shouldTightenInvestigativePrefix(fullVisibleText);
	if (transitionLeadsToInvestigation(transitionVerb + tail.slice(transitionEnd))) {
		if (!tightenInfo.triggered) return false;
		// 触发收紧：跳过 investigation gate，让 transition 判定继续通过
	}

	// The transition must be in the LAST sentence-ish chunk, not buried mid-answer.
	const lastBreak = Math.max(tail.lastIndexOf("。"), tail.lastIndexOf("！"), tail.lastIndexOf("？"), tail.lastIndexOf("\n"), tail.lastIndexOf("."), tail.lastIndexOf(";"), tail.lastIndexOf("；"));
	if (lastBreak >= 0 && tail.slice(lastBreak + 1).length > SOFT_CUT_TRANSITION_WINDOW) return false;
	return true;
}

let SOFT_CUT_SCAN_TAIL = 160;
let SOFT_CUT_TRANSITION_WINDOW = 48;
/**
 * Maximum character distance between the last Tier-1 conclusion opener and
 * the last transition marker within the tail scan window.  When the gap
 * exceeds this threshold, the conclusion is treated as a mid-phase mini-
 * conclusion ("所以 X is the root cause") followed by more analysis text,
 * not a phase-A → phase-B boundary.  This guards against the classic
 * false-positive: the model reaches a small sub-conclusion, continues
 * analyzing, then announces an execution step — each of "所以" and
 * "接下来" individually fires their detector, but together they span a
 * whole sub-phase and the cut lands mid-phase.
 */
let SOFT_CUT_GAP_THRESHOLD = 80;

/** Over-long CoT soft-cut threshold: fullVisibleText length beyond which a
 *  reminder cut fires. 0 means effectively disabled (checked at the hook site). */
let OVER_LONG_COT_THRESHOLD = 8000;

/**
 * Finds the LAST Tier-1 conclusion opener inside the tail scan window and
 * returns its index relative to the tail start, or null if none matches.
 * The original CONCLUSION_OPENERS use /^ anchor because splitSentences feeds
 * them one sentence at a time.  Here we search mid-tail, so we strip the ^
 * anchor and additionally require the character immediately before the match
 * to be a sentence boundary (whitespace / punctuation / newline) — otherwise
 * "我以为所以 X" would falsely fire on the "所以" buried mid-sentence.
 */
function findTier1OpenerInTail(tailText) {
	let bestMatch = null;
	for (const openerPattern of CONCLUSION_OPENERS) {
		const relaxed = new RegExp(
			openerPattern.source.replace(/^\^/, ""),
			`${openerPattern.flags.includes("g") ? "" : "g"}${openerPattern.flags.includes("i") ? "i" : ""}${openerPattern.flags.includes("u") ? "u" : ""}`
		);
		let match;
		while ((match = relaxed.exec(tailText)) !== null) {
			const contextBefore = tailText.slice(Math.max(0, match.index - 3), match.index);
			const precedingChar = contextBefore.at(-1) ?? "";
			if (contextBefore === "" || /[。！？!?.;；\n\s]/.test(precedingChar)) {
				if (bestMatch === null || match.index > bestMatch.index) {
					bestMatch = { index: match.index, text: match[0] };
				}
			}
		}
	}
	return bestMatch;
}

/**
 * Finds the LAST transition marker inside the tail scan window and returns
 * its index relative to the tail start, or null if none matches.  Mirrors
 * the transition-identity loop inside wantsSoftCut.
 */
function findTransitionInTail(tailText) {
	let bestMatch = null;
	for (const transitionPattern of TRANSITION_PATTERNS) {
		const globalPattern = new RegExp(
			transitionPattern.source,
			`${transitionPattern.flags.includes("g") ? "" : "g"}${transitionPattern.flags.includes("i") ? "i" : ""}${transitionPattern.flags.includes("u") ? "u" : ""}`
		);
		let match;
		while ((match = globalPattern.exec(tailText)) !== null) {
			if (bestMatch === null || match.index > bestMatch.index) {
				bestMatch = { index: match.index, text: match[0] };
			}
		}
	}
	return bestMatch;
}

/**
 * Returns the character distance between the last Tier-1 opener and the last
 * transition marker inside the tail scan window, or null when either is
 * missing.  When transition precedes Tier-1 the gap is 0 — still OK, the gap
 * check only rejects when Tier-1 is far ahead of transition (the
 * "conclusion in the middle, then analysis, then transition" false-positive).
 */
function computeTier1ToTransitionGap(fullText) {
	const tailText = fullText.slice(-SOFT_CUT_SCAN_TAIL);
	const tier1 = findTier1OpenerInTail(tailText);
	const transition = findTransitionInTail(tailText);
	if (!tier1 || !transition) return null;
	if (transition.index <= tier1.index) return 0;
	return transition.index - tier1.index;
}

/**
 * When the gap exceeds SOFT_CUT_GAP_THRESHOLD, the conclusion marker and the
 * execution announcement span a whole sub-phase of analysis in the middle of
 * the reasoning — soft-cut should be refused.
 *
 * fail-closed (P0-2, 2026-10-22): gap === null means the tail window holds a
 * transition marker but NO Tier-1 opener within reach (wantsSoftCut already
 * guarantees a transition exists at this point, so null can only mean the
 * opener is absent or farther back than the scan tail).  That is exactly the
 * "conclusion somewhere far behind, long analysis, then transition" shape the
 * gap guard exists to reject — returning true here let those cuts through
 * (observed in production reasoning drafts).  Refuse the cut instead.
 */
function isGapWithinThreshold(fullText) {
	const gap = computeTier1ToTransitionGap(fullText);
	if (gap === null) return false;
	return gap <= SOFT_CUT_GAP_THRESHOLD;
}

/**
 * Minimum characters AFTER the transition word before a soft-cut is allowed.
 * "我先" alone (2 chars) means the thought just started — cut nothing.  A real
 * follow-on like "我先看一下配置" (7) or longer means the transition is
 * unfolding and the cut lands on a boundary the extractor can handle.
 */
let SOFT_CUT_MIN_FOLLOW_CHARS = 6;

/**
 * Cascading conjunctions that introduce a transition WITHOUT starting a new
 * phase ("…, and now i will…", "so now let's reduce the formula case").  These
 * are continuation/connective phrases, not the "conclusions reached, move to
 * execution" cut the plugin targets.  When a transition is fronted by one of
 * these conjunctions the cut is skipped.
 */
const CASCADING_PATTERNS = [
	/(^|[，,\s])(?:and|so|but|because)\s+(?:now|next|then)\b/i,
	/(^|[，,\s])(?:and|so|but|because)\s+(?:let'?s|let\s+me)\b/i,
	/(^|[，,\s])(?:and|so|but|because)\s+i\s+(?:will|'ll|am\s+going\s+to)\b/i
];

/**
 * Tokens that can LEAD a transition announcement; stripped from the follow text
 * before testing whether the leading action is investigative.
 */
const INVESTIGATIVE_TRANSITION_PREFIXES = ["我先", "接下来我", "接下来", "下一步我", "下一步", "下面我", "下面", "现在开始", "现在就", "然后我", "然后", "我接下来", "那就先", "先将"];

// ── 修复④：transition 调查前缀分组复核 ──
// INVESTIGATIVE_TRANSITION_PREFIXES 单次放行（放走"我先看看配置"），但"让我 curl 一下"
// 被它被动放行后若反复出现（≥ 前缀重复上限）且无执行动词，就收紧为可切。
// 这些前缀在泄漏样本 tail3000 里出现 25 次（"我先"15 + "然后"8 + 其他 2），动作动词
// 计数 53，执行动词计数仅 1，明显失衡。
const INVESTIGATIVE_PREFIX_REPEAT_MAX = 6;  // 最近尾窗内同一前缀命中 ≥ 此值触发收紧
const INVESTIGATIVE_PREFIX_WINDOW_CHARS = 8000;  // 计数窗口与 REPEAT_WINDOW_CHARS 同阶
const INVESTIGATIVE_EXEC_VERBS = new Set([
	"write", "edit", "rewrite", "refactor", "delete", "replace", "deploy",
	"implement", "update", "build", "run", "create", "add", "make", "fix",
	"move", "open", "创建", "写", "改", "执行", "调用", "生成", "删除",
	"替换", "重构", "部署", "更新", "编译", "跑"
]);

/**
 * 修复④：最近尾窗内 INVESTIGATIVE_TRANSITION_PREFIXES 各前缀的分组命中计数。
 * @param {string} fullVisibleText
 * @returns {{prefix:string, count:number}[]} 按 count 降序
 */
function countInvestigativePrefixes(fullVisibleText) {
	if (typeof fullVisibleText !== "string") return [];
	const tail = fullVisibleText.slice(-INVESTIGATIVE_PREFIX_WINDOW_CHARS);
	const counts = new Map();
	for (const p of INVESTIGATIVE_TRANSITION_PREFIXES) {
		const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
		re.lastIndex = 0;
		const m = tail.match(re);
		if (m && m.length > 0) counts.set(p, m.length);
	}
	return [...counts.entries()]
		.map(([prefix, count]) => ({ prefix, count }))
		.sort((a, b) => b.count - a.count);
}

/**
 * 修复④：动作动词（tool verb）与执行动词（exec verb）计数对比。
 * 动作动词 = curl/fetch/web_fetch/访问/打开/探/查/验证/试一下；执行动词 = 写/改/创建/执行...
 * 动作动词走正则（中英文混合，带边界），执行动词同样走正则字面量覆盖 CJK + Latin。
 * @param {string} text
 * @returns {{actionCount:number, execCount:number}}
 */
function countActionVsExecVerbs(text) {
	if (typeof text !== "string") return { actionCount: 0, execCount: 0 };
	const tail = text.slice(-CHURN_WINDOW_CHARS);
	// 动作动词：工具名(curl/fetch/web_fetch) + 执行类单字(访问/打开) + 探/查 的独立形式
	// 探/查 排除合成词中的裸字（检查/查看/探查/查核/查寻/确认/探察/探测 里的"探/查"不算独立动作动词）
	// 负向后视 排除前字 + 负向前瞻 排除后字（两边都防）
	const actionRe = /(?:\bcurl\b|\bfetch\b|\bweb[-_ ]?fetch\b|访问|打开|验证|试一下|看看|探一下|查一下|(?<![检确勘观])探(?!察|测|查|究)|(?<![检查核询])查(?!查|找|核|询|看|实))/gi;
	actionRe.lastIndex = 0;
	const actionCount = (tail.match(actionRe) || []).length;
	const execRe = /(?:\bwrite\b|\bedit\b|\brewrite\b|\brefactor\b|\bdelete\b|\breplace\b|\bdeploy\b|\bimplement\b|\bupdate\b|\bbuild\b|\brun\b|\bcreate\b|\badd\b|\bmake\b|\bfix\b|\bmove\b|创建|写|改|执行|调用|生成|删除|替换|重构|部署|更新|编译|跑)/gi;
	execRe.lastIndex = 0;
	const execCount = (tail.match(execRe) || []).length;
	return { actionCount, execCount };
}

/**
 * 修复④：是否触发"调查前缀收紧"。
 * 条件：① 某调查前缀在最近窗口内重复 ≥ INVESTIGATIVE_PREFIX_REPEAT_MAX 次；
 *      ② 动作动词计数 ≥ 执行动词计数 × 5（动作远多于执行，典型空转特征）。
 * 触发时 wantsSoftCut 里不再被 transitionLeadsToInvestigation 放行。
 * @param {string} fullVisibleText
 * @returns {{triggered:boolean, topPrefix:string|null, repeatCount:number, actionCount:number, execCount:number}}
 */
function shouldTightenInvestigativePrefix(fullVisibleText) {
	const prefixCounts = countInvestigativePrefixes(fullVisibleText);
	const top = prefixCounts[0];
	const { actionCount, execCount } = countActionVsExecVerbs(fullVisibleText);
	const repeatOK = top && top.count >= INVESTIGATIVE_PREFIX_REPEAT_MAX;
	const actionDom = actionCount >= execCount * 5 && actionCount > 0;
	return {
		triggered: repeatOK && actionDom,
		topPrefix: top?.prefix ?? null,
		repeatCount: top?.count ?? 0,
		actionCount,
		execCount
	};
}

/**
 * Single-character investigative verbs (Chinese) and their 2-char look-ahead
 * steps.  A transition whose leading action is one of these ("我先读…", "下一步我看…")
 * is the model STILL researching — cut is skipped.  Execution verbs (改/写/删/
 * 生成/落地/替换/调用/跑/更新/加/建) are intentionally absent.
 */
const INVESTIGATIVE_CJK_VERB_CHARS = ["读", "看", "查", "审", "核", "找", "搜", "翻", "查证", "确认", "验证", "确认一下"];

/**
 * True when the text right after a transition word leads with an investigative
 * (research/verify) action rather than an execution one.  Used to stop the
 * transition soft-cut from severing ordinary continuing-research text.
 *
 * The predicate is deliberately structural, not regex-heavy: a CJK verb char
 * has no word boundary (`\b`), so we strip any leading transition prefix and
 * test the first actionable token against a small verb set.  "我先读…" reads
 * "我先" (prefix) + "读" (verb) -> investigative -> skip cut.
 * @param {string} followText - the characters after the transition word.
 * @returns {boolean}
 */
function transitionLeadsToInvestigation(followText) {
	if (typeof followText !== "string") return false;
	let rest = followText.trimStart();
	for (const p of INVESTIGATIVE_TRANSITION_PREFIXES) {
		if (rest.startsWith(p)) { rest = rest.slice(p.length).trimStart(); break; }
	}
	// Leading execution announcement (English) never counts as investigation.
	if (/^(?:write|edit|rewrite|refactor|delete|replace|deploy|implement|update|build|run|create|add|make|fix|move|open)\b/i.test(rest)) return false;
	if (/^(?:(?:i|let'?s|we|you)\s+)?(?:read|look at|check|verify|confirm|review|inspect|search|find|examine|look up|go through|re-read)\b/i.test(rest)) return true;
	// English leading execution verb neither investigative (handled above).
	// CJK: peel a leading subject / modal / adverb chain ("我已/我要/我去/我再重新…")
	// then test the leading verb.  Loops because the prefix chain can be long.
	for (let guard = 0; guard < 6; guard++) {
		const before = rest;
		rest = rest.replace(/^(?:我|我们|他|她|它|咱们|就|要|去|来|想|打算|准备|先|再|重新|还|还在|又|已|已经|刚|正在|赶快|赶紧|立刻|马上|于是|然后|现在|试着|再继续|继续)\s*/, "");
		if (rest === before) break;
	}
	if (/^(?:write|edit|rewrite|refactor|delete|replace|deploy|implement|update|build|run|create|add|make|fix|move|open)\b/i.test(rest)) return false;
	const first = rest.length > 0 ? rest[0] : "";
	return INVESTIGATIVE_CJK_VERB_CHARS.includes(first);
}

/**
 * Degenerate-loop detection ("原地打转"): a weak model can emit the SAME block
 * over and over inside one generation (observed: one 587-char tool-call snippet
 * repeated 403 times ≈ 240k chars) until the output budget is gone.  This is a
 * different failure than the A→transition→B case, but it rides the same
 * soft-cut path: when a period is found, the loop is cut and an anchor is
 * injected; `trimTo` additionally tells the kernel to persist only ONE copy of
 * the repeated block instead of replaying the whole runaway tail back to the
 * model on the next request.
 *
 * Detection is deliberately windowed: the kernel consults a listener every
 * ~32 new chars, so scanning the whole prefix would be O(n²) on a 240k-char
 * runaway.  A short probe is matched inside the trailing window only, from
 * which the period is derived, then the period is verified backwards.
 */
let REPEAT_PROBE_CHARS = 128;
/** Only the trailing slice is searched — bounds each check to O(window). */
let REPEAT_WINDOW_CHARS = 16000;
/**
 * Period floor.  Deliberately low: a real observed runaway was a ~60-char cycle
 * ("OK. / Let me write. / Now. / Final. / Output. / Writing. / Go.") repeated
 * hundreds of times.  A short period is NOT evidence of normal writing — the
 * repeat COUNT is what separates a loop from ordinary emphasis (see the two
 * thresholds below).
 */
let REPEAT_MIN_PERIOD = 12;
/**
 * A tokenizer-level death loop can collapse to an even shorter period: a
 * corrupted closing tag ("</…>") repeatedly re-emitted as a stream of
 * `er4er4er4…` (period 3) is one observed instance.  Periods this short were
 * previously rejected outright (`period < REPEAT_MIN_PERIOD`), so a genuine
 * biological loop of 2–11 chars sailed past every detector even when it ran
 * for thousands of characters.  We relax that gate for ultra-short periods
 * but hold them to a MUCH higher repeat count, because 2–3 char cycles are
 * also ordinary emphasis / padding ("===", "aaaa", "-----") that only becomes
 * pathological at a pathological frequency.  Separation: a short period
 * repeated dozens of times is never normal writing.
 */
let REPEAT_ULTRA_SHORT_MIN_COUNT = 30;
/** Periods below this are held to the stricter repeat count. */
let REPEAT_SHORT_PERIOD = 96;
/** Periods longer than this are not the runaway pattern we target. */
let REPEAT_MAX_PERIOD = 8000;
/**
 * A LONG block repeated this many times is already a runaway.  Set to 2 rather
 * than 3 on purpose: repeating several hundred bytes verbatim is never normal
 * prose (quotation and summaries paraphrase), so the cheaper miss costs more
 * than the rare false cut.  Interference is further bounded by the kernel's
 * per-turn cut cap.
 */
let REPEAT_MIN_COUNT = 2;
/**
 * A SHORT cycle must repeat many more times before it counts, but still tuned
 * aggressively: ordinary prose may repeat a short phrase two or three times,
 * five identical cycles is already a stuck model.
 */
let REPEAT_MIN_COUNT_SHORT = 5;
/** Below this prefix length the detector never runs (avoids short-answer false hits). */
let REPEAT_MIN_TEXT_CHARS = 800;

/**
 * Find a degenerate repeating tail in the generated text.
 *
 * Two stages, because the kernel calls this on every ~32 new characters:
 *  1. Cheap windowed pre-filter — a short probe is matched inside the trailing
 *     window (never the full prefix), giving the period.  This rejects normal
 *     prose in O(window).
 *  2. Expensive-but-rare exact localization — only once a period is confirmed
 *     does it walk the WHOLE text.  Backward doubling jumps (1, 2, 4, 8, … full
 *     periods at a time) find the true start of the run in O(n) with a tiny
 *     constant, so a 240k-char runaway still resolves to a single kept copy.
 *     It runs at most once per cut in practice: the cut aborts the stream.
 * @param {string} fullVisibleText - all visible text (text + reasoning) so far.
 * @returns {{period:number,count:number,trimTo:number}|null} loop info, or null.
 */
function findRepeatingTail(fullVisibleText) {
	if (typeof fullVisibleText !== "string" || fullVisibleText.length < REPEAT_MIN_TEXT_CHARS) return null;
	const textLength = fullVisibleText.length;

	// --- stage 1: windowed period pre-filter ---------------------------------
	const windowStart = Math.max(0, textLength - REPEAT_WINDOW_CHARS);
	const window = fullVisibleText.slice(windowStart);
	if (window.length < REPEAT_PROBE_CHARS * 2) return null;
	const probe = window.slice(-REPEAT_PROBE_CHARS);
	const previous = window.lastIndexOf(probe, window.length - REPEAT_PROBE_CHARS - 1);
	if (previous < 0) return null;
	const period = window.length - REPEAT_PROBE_CHARS - previous;
	if (period > REPEAT_MAX_PERIOD) return null;
	// Single-char cycles ("=====", "aaaa", "\n\n\n") are ordinary emphasis or
	// padding and are never held up as a loop, so the ultra-short branch starts
	// at period 2.  Everything below the normal short-period floor flows to
	// stage 2 where it is gated by the much higher ultra-short count.
	if (period < 2) return null;

	// --- stage 2: confirm the last two blocks really are identical ------------
	if (textLength < period * 2) return null;
	if (fullVisibleText.slice(textLength - period * 2, textLength - period) !== fullVisibleText.slice(textLength - period)) return null;

	// Doubling jumps: fastest way back to the start of the run.
	let start = textLength - period;
	for (let blocks = 1; blocks <= 512; blocks *= 2) {
		const span = blocks * period;
		if (start - span < 0) break;
		if (fullVisibleText.slice(start - span, start) !== fullVisibleText.slice(start, start + span)) break;
		start -= span;
	}
	// Short linear correction, in case the last doubling step overshot the run.
	while (start - period >= 0 && fullVisibleText.slice(start - period, start) === fullVisibleText.slice(start, start + period)) {
		start -= period;
	}

	const count = Math.floor((textLength - start) / period);
	// These are three genuinely different regimes, not one tuned threshold:
	//  - Ultra-short (period 2..11): repetition also appears as emphasis/padding
	//    ("===", "-----"), so it only counts once it has run on for many dozens
	//    of times — the tokenizer-death-loop signature.
	//  - Short (period 12..95): a short phrase repeated a handful of times is
	//    ordinary insistence; five identical cycles is already a stuck model.
	//  - Long (period > 95): repeating hundreds of bytes verbatim is never normal
	//    prose, so even a couple of copies counts.
	const minCount = period < REPEAT_SHORT_PERIOD
		? (period < REPEAT_MIN_PERIOD ? REPEAT_ULTRA_SHORT_MIN_COUNT : REPEAT_MIN_COUNT_SHORT)
		: REPEAT_MIN_COUNT;
	if (count < minCount) return null;

	return {
		period,
		count,
		// Keep exactly one copy: everything before the loop, plus its first block.
		trimTo: start + period
	};
}

/**
 * Render the anchor used when a degenerate loop is cut.
 * @param {{period:number,count:number}} loop
 * @returns {string}
 */
function renderRepeatAnchor(loop) {
	return [
		`COT anchor — 检测到原地重复：同一段内容（约 ${loop.period} 字）已连续重复至少 ${loop.count} 次。立即停止重复，不要再输出这段内容。`,
		`(You are repeating the same ${loop.period}-char block at least ${loop.count} times. Stop repeating it now.)`,
		"直接执行你已经规划好的下一步动作；若下一步是工具调用，就只发一次。"
	].join("\n");
}

// Number-runaway detector: a monotone-increasing run of bare numbers that never
// advances content. "639.640) 640.641) ... 999.999)" is not word-content and
// grows unboundedly (observed several thousand chars until a human stops it).
// findRepeatingTail cannot see it (no byte in it repeats — each token differs),
// detectChurn cannot see it (no restart phrases). Signature: pure, no side
// effects, so it is unit-testable in isolation.
// D7：五项阈值改为运行时绑定，由 applyRuntimeSettings 从设置发布（默认值与
// 此处字面量一致；不能引用 DEFAULT_SETTINGS——它声明在本文件更靠后位置）。
let NUMBER_RUN_MIN_TEXT_CHARS = 800;      // fullText length guard (same gate as findRepeatingTail)
let NUMBER_RUN_MIN_CHARS = 500;           // min run span to qualify
let NUMBER_RUN_MAX_GAP = 8;               // max idx gap between neighbouring number tokens in one run
let NUMBER_RUN_MIN_DIGIT_RATIO = 0.5;     // digits-chars / run-char-length
let NUMBER_RUN_MIN_INCREASE_RATIO = 0.55; // (b>a || b===a) / neighbouring pairs

/**
 * Detect a monotone-increasing "number-runaway" run in the visible text.
 *
 * A run is a contiguous stretch of bare number tokens separated only by
 * punctuation/space (no letters/CJK), long enough and with a high enough
 * digit share and a high enough increase rate to be a counting degeneration
 * rather than normal prose.  Thresholds are tuned for a real positive sample
 * (a Doubao trace whose reasoning tail ran "639.640) 640.641) …" for ~7000
 * chars, stopping only when the user interrupted).
 *
 * @param {string} fullVisibleText reasoning+tail concatenated visible text.
 * @returns {{chars:number,digitRatio:number,increaseRatio:number,trimTo:number}|null}
 *     hit info (trimTo = run start) or null when nothing qualifies.
 */
function detectNumberRunaway(fullVisibleText) {
	if (typeof fullVisibleText !== "string" || fullVisibleText.length < NUMBER_RUN_MIN_TEXT_CHARS) return null;
	const DIGIT_RE = /\b\d{1,4}\b/g;
	const toks = [];
	let m;
	while ((m = DIGIT_RE.exec(fullVisibleText)) !== null) {
		toks.push({ v: Number(m[0]), idx: m.index });
	}
	if (toks.length < 2) return null;
	// group consecutive tokens into runs; a new run starts whenever the gap is
	// too wide or a letter/CJK sits between the two tokens.
	const runs = [];
	let cur = [toks[0]];
	for (let i = 1; i < toks.length; i++) {
		const prevTok = toks[i - 1], nowTok = toks[i];
		const gap = nowTok.idx - (prevTok.idx + String(prevTok.v).length);
		if (gap <= NUMBER_RUN_MAX_GAP) {
			const between = fullVisibleText.slice(prevTok.idx + String(prevTok.v).length, nowTok.idx);
			if (!/[A-Za-z\u4e00-\u9fff]/.test(between)) { cur.push(nowTok); continue; }
		}
		runs.push(cur);
		cur = [nowTok];
	}
	runs.push(cur);
	// evaluate each run
	for (const run of runs) {
		if (run.length < 2) continue;
		const runStart = run[0].idx;
		const lastTok = run[run.length - 1];
		const runEnd = lastTok.idx + String(lastTok.v).length;
		const span = runEnd - runStart;
		if (span < NUMBER_RUN_MIN_CHARS) continue;
		let digitChars = 0;
		for (const t of run) digitChars += String(t.v).length;
		const digitRatio = digitChars / span;
		if (digitRatio < NUMBER_RUN_MIN_DIGIT_RATIO) continue;
		let inc = 0;
		for (let i = 1; i < run.length; i++) {
			if (run[i].v >= run[i - 1].v) inc++;
		}
		const increaseRatio = inc / (run.length - 1);
		if (increaseRatio < NUMBER_RUN_MIN_INCREASE_RATIO) continue;
		return { chars: span, digitRatio, increaseRatio, trimTo: runStart };
	}
	return null;
}

/**
 * Render the anchor used when a number-runaway run is cut.
 * @param {{chars:number}} nr
 * @returns {string}
 */
function renderNumberRunawayAnchor(nr) {
	return [
		`COT anchor — 检测到数字递增流退化：你已连续输出约 ${nr.chars} 字符的递增数字流，而没有推进任何内容。立即停止数数，不要再输出"序号→更大数字"的流水。`,
		"回到你退化前正在写的那句话，直接给结论或执行下一步；若下一步是工具调用，就只发一次。",
		`(You are emitting a ${nr.chars}-char monotone-increasing number stream. Stop counting; resume from the last real sentence.)`
	].join("\n");
}

// ── 修复②：n-gram 语义指纹循环检测 ──
// 现有 findRepeatingTail 找字节级相同块，措辞漂移型循环（每句数字变、动词结构不变）
// 抓不到。本修复用数字归一 + n-gram 频率旁路，运行时零 LLM。

/**
 * 修复②：短语级重复的 n-gram 粒度下限（字符级滑窗粒度，默认 5）。
 * 运行时可经 DEFAULT_SETTINGS.ngramPhraseMin 覆盖（applyRuntimeSettings 写回本绑定；
 * 声明处保持字面量是因为 DEFAULT_SETTINGS 在本文件更靠后位置，模块加载期不可引用）。
 */
let NGram_PHRASE_MIN = 5;
/** 修复②：高频短语最小出现次数（默认 5；运行时可经 ngramMinCount 覆盖）。 */
let NGram_MIN_COUNT = 5;
/** 修复②：最高频短语覆盖尾窗的占比下限（默认 0.05；运行时可经 ngramCoverageRatio 覆盖）。 */
let NGram_COVERAGE_RATIO = 0.05;
/**
 * 修复③（误软切回归）：英文词轨的 token 与短语形态守卫。
 * 事故样本（cot-anchor 误软切样例 1/2/3）里最高频 gram 分别是 "s l"（公式
 * S·l 的单字母变量）与 "t t"（补丁脚本的 «T» 制表符占位符）——它们都不是
 * 英文单词，只是结构字符；词轨把它们当词后，2-gram 在千字级尾窗里随便就
 * 凑够 5 次、5% 覆盖率，于是每次写公式/写补丁都会被误切。
 * 因此词轨改为：token 至少 2 个字母（单字母变量/占位符永不入表）；gram 取
 * 相邻 4 词（2~3 词搭配在技术文本/表格列骨架里天然高频，4 词才构成"句子
 * 骨架"重复）；再叠加最短字母数守卫，滤掉 "cn cl n l" 这类公式变量组合。
 */
const NGram_WORD_TOKEN_MIN_CHARS = 2;
const NGram_WORD_GRAM_SIZE = 4;
/** 词轨 gram 的最少字母总数（不含空格）：4 个两字母词的 8 字母组合属公式变量，不是短语。 */
const NGram_WORD_MIN_LETTERS = 10;
/** 字符轨 gram 至少包含的 CJK 字数：纯符号/版本号/DIGIT 组合（"«t»«t"、"vDIGI"）不是语义短语。 */
const NGram_CJK_MIN_CHARS = 2;
/**
 * 修复③（第二轮）：上下文稳定性下限（词轨/字符轨共用）。
 * 真正的语义循环是把同一句骨架反复吐出来，命中短语的左右邻居高度一致；
 * 而"标识符/术语复用"（样例 3 的 "dsh patch chat" 7 次）左邻分别来自
 * patchmarker / window / says / oldpatchmarker / marker / string / contains，
 * 每次上下文都不同。要求最高频左右邻组合占命中次数的 ≥65%，把后者挡掉。
 * 阈值从 50% 提到 65%（第六轮真实轨迹复盘）：UI 错误文案 "failed to load
 * plugins" 在调试文本里出现 8 次、最高频上下文恰好占 50%，是标签复用不是循环；
 * 而真正重复整句骨架的样本里该比例通常接近 100%，65% 留有充分余量。
 */
const NGram_CONTEXT_MIN_RATIO = 0.65;
/** 修复③（第三轮）：词轨逐个候选校验的上限，避免尾窗内几千个 gram 全做上下文扫描。 */
const NGram_WORD_CANDIDATE_LIMIT = 12;
/**
 * 修复③（第七轮，长上下文稀释）：覆盖率的分母改用「命中区间」而不是整个尾窗。
 *
 * 尾窗固定 16000 字符，但一个 turn 的 `reasoning+text` 可能长达十几万字符。
 * 只要 turn 够长，即使模型在末尾真的把同一句重复 30 次，也凑不够 5%——真实
 * 会话回放实测：240k 字符的 turn 末尾追加 30 次中文整句（60 次短语命中），
 * count=60、coverage 仅 1.9%，完全不触发；英文侧稍好（5.8%）但同样被摊薄。
 *
 * 语义上要判的是「重复有多密集」，而不是「重复占全文多大比例」：把分母换成
 * 首次命中到末次命中的跨度（即重复集中在多长的区间里）。跨度天然 ≥ 命中总
 * 长度（count × gramSize，overlap 除外），所以覆盖率不会因此虚高到 1 以上。
 *
 * 但不能只用密度口径：短 turn（2~5k 字符）里一个术语出现 5~7 次、每次都挨得
 * 很近时，跨度分母会把占比抬到 5% 以上（真实轨迹回放：`远程不存在` 7 次、
 * 计划书术语 `blocked followup user turn` 5 次、状态字段骨架 7 次全部误判）。
 * 因此保留旧口径（分母 = 整个尾窗）与新口径取**最大值**，并给密度分母设下限，
 * 让"短文本里少量集中出现"仍按旧比例判定，"超长 turn 末尾成段打转"才被密度
 * 口径救回（实测 240k 字符 turn 内重复 30 次可命中，旧口径只有 1.9%）。
 */
const NGram_DENSITY_MIN_CHARS = 800;
const NGram_DENSITY_MIN_TOKENS = 600;

const NGram_STOPWORDS = new Set([
	"的", "了", "是", "我", "你", "他", "她", "它", "们", "这", "那", "就", "也", "都",
	"要", "会", "能", "可以", "让", "把", "给", "对", "从", "用", "到", "在", "和", "与",
	"为", "于", "以", "及", "或", "不", "没", "有", "一", "一个", "一些", "什么", "怎么",
	"怎样", "为什么", "因为", "所以", "但是", "然而", "不过", "而且", "然后", "现在",
	"好，", "好。", "好", "那么", "接下来", "现在就",
	// 运行状态标签（LISTENING=True / PID=xxx / exit code）——泄漏样本每段都重复，
	// 但它本身不是循环证据，必须过滤让真正的循环短语（好+动词+工具名）浮出来
	"listening", "true", "false", "pid", "digit", "DIGIT", "running", "exit", "code",
	"web_fetch", "curl", "fetch", "web", "localhost",
	// 英文技术高频词（每个词只保留一次）——settings/entry/path 这类术语在技术文本
	// 尾窗内天然高频，本身不是循环证据；且其常见搭配（"the settings" 等）两个词全在
	// 表内，stopCharRatio 守卫会一并过滤，让真正的动词结构循环浮出来
	"settings", "config", "path", "entry", "state", "field", "value", "file", "data",
	"plugin", "session", "context", "window", "token", "model", "result", "check", "call",
	"step", "text", "full", "visible", "use", "used", "need", "find", "found", "read",
	"write", "test", "line", "log",
	// 通用英文虚词
	"the", "and", "for", "with", "this", "that", "from", "have", "has", "was", "were",
	"will", "can", "could", "should", "would", "but", "not", "are", "is", "in", "on",
	"of", "to"
]);

/**
 * 修复②：数字归一 + 小写 + 去标点空白，为 n-gram 指纹做准备。
 * PID=31760 → PID=DIGIT、端口号 / 路径里的数字同样处理。
 * 用字面量 DIGIT 而不是 <D>：尖括号属于要被 strip 的标点，归一符不能被自毁。
 * 先替换数字再 strip 标点——顺序关键。
 * @param {string} text
 * @returns {string}
 */
function normalizeForNGram(text) {
	if (typeof text !== "string") return "";
	return text
		.toLowerCase()
		.replace(/\d+/g, "DIGIT")
		// 修复③（第五轮）：连字符/下划线/路径分隔符做「粘合」而不是切分——
		// 标识符必须保持原子 token。否则 no-blind-wait-polling、
		// D:\dsh\dsh-cot-anchor\lib\index.js 会被拆成 4 个以上普通词，
		// 在长会话里按短语重复计数（真实轨迹实测：技能名 x6、文件路径 x7）。
		// 粘合后它们变成单个长 token，无法组成 4 词 gram；正常带连字符的英文
		// （re-analyze）成为单 token，不影响真循环检测。
		.replace(/[-_\/\\]/g, "")
		// 其余标点仍替换为空格（下划线等已在上一行粘合，不在此字符类中）
		.replace(/[，,。.！!？?；;:：""''（）()【】\[\]<>《》—–]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * 修复②：从频次 Map 取最高频 gram（含总 gram 数），供字符轨 / 英文词轨共用。
 * @param {Map<string, number>} gramCount
 * @param {number} totalGrams
 * @returns {{maxCount:number, maxGram:string, totalGrams:number, gramCount:Map<string, number>}}
 */
function pickMaxFromCountMap(gramCount, totalGrams) {
	let maxCount = 0;
	let maxGram = "";
	for (const [g, c] of gramCount) {
		if (c > maxCount) { maxCount = c; maxGram = g; }
	}
	return { maxCount, maxGram, totalGrams, gramCount };
}

/**
 * 修复③（第三轮）：英文词级 n-gram 频率统计。相邻 N 个英文词为一个 gram
 * （默认 4 词），如 "verify checksum before releasing"。英文单词是原子 token：
 * 单词内部子串（"setti"/"etting"）永远不会成为 gram；单字母结构字符（S·l 的
 * "s"/"l"、«T» 的 "t"）在 token 抽取阶段就被长度守卫挡掉。
 * 修复③（第四轮）：只在**同一句/同一子句**内组 gram。中文句子间隔不让英文词
 * 假装相邻——否则中文主体里零散的 settings/session/anchor/tool 会被拼成
 * "settings tool session anchor" 这类跨句假短语（F 用例 30.8% 覆盖率误报）。
 * @param {string[][]} segments 按句/子句切分后的英文词序列
 * @param {number} gramSize 词数（相邻 N 词）
 * @returns {{maxCount:number, maxGram:string, totalGrams:number, gramCount:Map<string, number>}|null}
 */
function computeWordGramFingerprint(segments, gramSize) {
	const gramCount = new Map();
	let totalGrams = 0;
	for (const words of segments) {
		for (let i = 0; i <= words.length - gramSize; i++) {
			const gram = words.slice(i, i + gramSize).join(" ");
			let v = gramCount.get(gram) ?? 0;
			gramCount.set(gram, ++v);
			totalGrams++;
		}
	}
	if (totalGrams === 0) return null;
	return pickMaxFromCountMap(gramCount, totalGrams);
}

/**
 * 修复③（第四轮）：按句/子句切分尾窗原文，再逐段抽取英文词。
 * 切分符覆盖中英文句读与换行；数字/下划线等仍由 normalizeForNGram 处理。
 * 目的：词级 gram 只在同一句/子句内形成，中文间隔不再让英文术语"假装相邻"。
 * @param {string} rawText
 * @returns {string[][]} 每段的英文词序列（长度 ≥1）
 */
function extractEnglishWordSegments(rawText) {
	const segments = [];
	const wordRe = new RegExp(`[a-z]{${NGram_WORD_TOKEN_MIN_CHARS},}`, "g");
	for (const part of rawText.split(/[。！？!?；;：:，,、.\n\r]+/)) {
		if (part.trim().length === 0) continue;
		const words = normalizeForNGram(part).match(wordRe);
		if (words && words.length > 0) segments.push(words);
	}
	return segments;
}

/**
 * 修复③（第六轮）：剔除引号/反引号包裹的片段。
 * 真实轨迹实测：模型在正文里 5 次引用会话开头的 "Let me understand the task"
 * 做起点核对，被词轨当成循环。引号内的内容是**被引用对象**（标识符/旧文本），
 * 不是模型自己在重复的骨架；统计前先剔除，避免引用型误切。
 * 只处理成对的双引号、中文引号、单引号（‘’）与反引号；
 * ASCII 单引号与英文缩写撇号冲突，不处理。
 * @param {string} text
 * @returns {string}
 */
function stripQuotedSegments(text) {
	if (typeof text !== "string") return "";
	return text
		.replace(/"[^"\n]{0,500}"/g, " ")
		.replace(/“[^”\n]{0,500}”/g, " ")
		.replace(/‘[^’\n]{0,500}’/g, " ")
		.replace(/`[^`\n]{0,500}`/g, " ");
}

/**
 * 修复③（第八轮）：剔除三引号代码块（```…```，可跨行）。
 * 模型把日志、命令输出、表格、补丁粘进正文时，里面天然有大量重复行；
 * 这些是**引用数据**，不是模型自己在重复的推理骨架。单引号剔除
 * （stripQuotedSegments）只覆盖行内的 `…`，跨行块会漏过去——真实轨迹里
 * 粘贴失败日志后按短语高频误判，即属此类。
 * 不设长度上限：非贪婪匹配天然在下一个 ``` 处收尾，而输入的尾窗本身只有
 * 16000 字符；设上限反而会把超过上限的长堆栈块漏在正文里（真实轨迹实测：
 * 一段 6000+ 字符的 Unity 异步堆栈被漏掉，"end of stack trace" 命中 6 次）。
 * @param {string} text
 * @returns {string}
 */
function stripFencedBlocks(text) {
	if (typeof text !== "string") return "";
	return text.replace(/```[\s\S]*?```/g, " ");
}

/**
 * 修复③（第八轮）：剔除 markdown 表格行。
 * 表格行（含 ≥2 个竖线）是结构化数据，同一列标签在每行重复出现是表格的
 * 正常形态，不是推理骨架在打转。真实轨迹实测：清单表格里"增补 P1-x"这类
 * 单元格被数字归一后互相等价，字符轨命中 11 次（"增补pDI"，稳定性 1.00）。
 * @param {string} text
 * @returns {string}
 */
function stripTableRows(text) {
	if (typeof text !== "string") return "";
	return text.replace(/^[^\n]*\|[^\n]*\|[^\n]*$/gm, " ");
}

/**
 * 修复③（第八轮）：剔除堆栈帧/分隔线这类"数据行"。
 * 尾窗可能从一段超长代码块的中间开始（块的开 ``` 在前一屏之外），此时
 * stripFencedBlocks 找不到配对的起始标记，块内文字会残留在正文里。真实轨迹
 * 实测：Unity 异步堆栈里 `--- End of stack trace … ---` 重复 6 次、上下文
 * 完全一致，被词轨判成循环。堆栈帧与分隔线是工具输出，不是推理骨架，直接剔除。
 * @param {string} text
 * @returns {string}
 */
function stripTraceLines(text) {
	if (typeof text !== "string") return "";
	return text
		.replace(/^\s*at [^\n]*$/gm, " ")
		.replace(/^\s*---[^\n]*---\s*$/gm, " ")
		.replace(/^\s*File "[^"]*", line \d+[^\n]*$/gm, " ");
}

/**
 * 修复②：尾窗 n-gram 频率统计（双轨）。
 * 输入尾窗原文，内部先归一化再切分，同时产出两套指纹：
 *  - charFp：字符级 n-gram（原实现，保留中文/混合文本检测能力），gram 为无空白字符窗；
 *    gram 必须含 ≥NGram_CJK_MIN_CHARS 个 CJK 字——纯符号/版本号/DIGIT 组合不是语义短语；
 *  - wordFp：英文词级 4-gram（同一句/子句内相邻四个英文词为一个 gram，单字母 token 不参与）；
 * 以及英文 token 数（供覆盖率分母使用）。
 * 判定逻辑不在本函数内做——detectNGramLoop 是唯一决策入口。
 * @param {string} rawText 尾窗原文（未归一化）
 * @param {number} nGramSize 字符级短语粒度
 * @returns {{charFp:object|null, wordFp:object|null, wordSegments:string[][], englishTokenCount:number, totalTokenCount:number, hasEnglishWords:boolean}|null}
 */
function computeNGramFingerprint(rawText, nGramSize) {
	if (typeof rawText !== "string" || rawText.length < nGramSize * 4) return null;
	// 修复③（第六轮）：统计前剔除引号内被引用文本（见 stripQuotedSegments）。
	// 修复③（第八轮）：依次剔除三引号代码块、表格行、堆栈帧、行内引号段。
	const scanText = stripQuotedSegments(stripTraceLines(stripTableRows(stripFencedBlocks(rawText))));
	const normText = normalizeForNGram(scanText);

	// 轨 1：字符级 n-gram（原逻辑不变 + 英文词内部子串隔离）。
	// 隔离规则：gram 完全由英文字母组成时跳过（normalize 已小写化，/^[a-z]+$/ 即纯英文）。
	// 纯英文 gram 一定是某个英文词的内部子串或跨词片段，英文语义统一交给词轨判定；
	// 字符轨只保留含 CJK/数字/符号的 gram，避免中英混合文本里 "sessi"/"ancho" 这类
	// 英文词子串被独立计数而误报（本会话实测复现：count 16、coverage 8.8% 触发 cut）。
	// 修复③：再要求 gram 含 ≥2 个 CJK 字。事故样本里字符轨最高频是 "«t»«t"（制表符
	// 占位符）与 "vDIGI"（版本号归一后的片段），它们不含 CJK、纯属结构重复；
	// 不设此守卫时，词轨修好后字符轨仍可能接棒误切。
	const charGramCount = new Map();
	let charTotalGrams = 0;
	for (let i = 0; i <= normText.length - nGramSize; i++) {
		const gram = normText.slice(i, i + nGramSize);
		// 跳过含空白的 gram（normalize 已把标点换成空格，避免跨标点短语虚高）
		if (gram.includes(" ") || gram.includes("\n") || gram.includes("\t")) continue;
		// 跳过纯英文 gram：英文词内部子串隔离（方案 1）
		if (/^[a-z]+$/.test(gram)) continue;
		// 修复③：CJK 字数守卫（见上）
		const cjkCount = [...gram].filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length;
		if (cjkCount < NGram_CJK_MIN_CHARS) continue;
		let v = charGramCount.get(gram) ?? 0;
		charGramCount.set(gram, ++v);
		charTotalGrams++;
	}
	const charFp = charTotalGrams === 0 ? null : pickMaxFromCountMap(charGramCount, charTotalGrams);

	// 轨 2：英文词级 4-gram——按句/子句切分后，在各段内抽 [a-z]{2,} 英文词
	// （单字母变量/占位符不入表），相邻 NGram_WORD_GRAM_SIZE 个词为一个 gram。
	// 跨句不组 gram，避免中文主体把零散英文术语拼成假短语。
	const wordSegments = extractEnglishWordSegments(scanText);
	const allWords = wordSegments.flat();
	const wordFp = allWords.length >= NGram_WORD_GRAM_SIZE
		? computeWordGramFingerprint(wordSegments, NGram_WORD_GRAM_SIZE)
		: null;

	// 英文 token 占比统计（供 detectNGramLoop 词轨覆盖率分母 / 上下文守卫用）。
	const englishTokenCount = allWords.length;
	const cjkCount = (normText.match(/[\u4e00-\u9fff]/g) || []).length;
	const totalTokenCount = englishTokenCount + cjkCount;
	return {
		charFp,
		wordFp,
		wordSegments,
		englishTokenCount,
		totalTokenCount,
		// 方案 1：英文词轨并行——只要有英文词就具备走词轨的条件，不再要求英文主导。
		hasEnglishWords: englishTokenCount > 0
	};
}

/**
 * 修复②：按频次降序取第一个非停用词 gram（字符轨专用）。跳过命中停用词表的
 * gram；含停用词字符 ≥60% 的 gram 同样跳过（stopCharRatio 守卫——对中文单字
 * 停用词有效，gram 拆成字符逐个比对）。
 * @param {Map<string, number>} gramCount
 * @returns {{gram:string, count:number}|null}
 */
function pickHighestNonStopwordGram(gramCount) {
	const sorted = [...gramCount.entries()].sort((a, b) => b[1] - a[1]);
	for (const [gram, count] of sorted) {
		if (NGram_STOPWORDS.has(gram)) continue;
		// 停用词比例守卫：若 gram 中 ≥60% 字符在停用词表里，同样跳过
		const stopCharRatio = [...gram].filter((ch) => NGram_STOPWORDS.has(ch)).length / gram.length;
		if (stopCharRatio >= 0.6) continue;
		return { gram, count };
	}
	return null;
}

/**
 * 修复③：按频次降序列出全部合格词级 gram（英文 4-gram 专用）。
 * 词级 gram 形如 "verify checksum before releasing"。修复③（第三轮）不再
 * "含任一停用词即丢弃"——"please verify the checksum" 这类带冠词的正常短语
 * 会因此整条消失（P 用例漏检）。改为要求 **至少 2 个实词**（不在停用词表）：
 * 纯虚词组合（"the settings path from"）与公式变量组合（4 个两字母词）被滤掉，
 * 含冠词但骨架完整的短语保留。返回全部候选而非只取第一名：最高频的可能是
 * 上下文噪声，真正循环骨架会排在后面，由 detectNGramLoop 逐个校验稳定性。
 * @param {Map<string, number>} gramCount
 * @param {number} gramSize 词数
 * @returns {{gram:string, count:number}[]}
 */
function listEligibleWordGrams(gramCount, gramSize) {
	const sorted = [...gramCount.entries()].sort((a, b) => b[1] - a[1]);
	const out = [];
	for (const [gram, count] of sorted) {
		const words = gram.split(" ");
		if (words.length !== gramSize) continue;
		const contentWords = words.filter((w) => !NGram_STOPWORDS.has(w)).length;
		if (contentWords < 2) continue;
		const letters = words.reduce((sum, w) => sum + w.length, 0);
		if (letters < NGram_WORD_MIN_LETTERS) continue;
		out.push({ gram, count });
	}
	return out;
}

/**
 * 修复③（第二轮）：词轨命中短语的上下文稳定性。
 * 统计该 gram 每次出现时「前一个词 | 后一个词」的分布，返回最高频组合占比。
 * 真循环重复整句骨架 → 邻居一致 → 占比接近 1；术语/标识符复用 → 占比很低。
 * 修复③（第四轮）：按句段统计，段首/段尾以 ^/$ 记上下文，不跨句拼接。
 * @param {string[][]} segments 按句/子句切分后的英文词序列
 * @param {string} gram 已命中的词级 gram
 * @param {number} gramSize 词数
 * @returns {number} 最高频上下文占比（0~1）
 */
function wordGramContextStability(segments, gram, gramSize) {
	const parts = gram.split(" ");
	const ctx = new Map();
	let total = 0;
	for (const words of segments) {
		for (let i = 0; i + gramSize <= words.length; i++) {
			let same = true;
			for (let k = 0; k < gramSize; k++) {
				if (words[i + k] !== parts[k]) { same = false; break; }
			}
			if (!same) continue;
			const key = `${words[i - 1] ?? "^"}|${words[i + gramSize] ?? "$"}`;
			ctx.set(key, (ctx.get(key) ?? 0) + 1);
			total++;
		}
	}
	if (total === 0) return 0;
	return Math.max(...ctx.values()) / total;
}

/**
 * 修复③（第三轮）：字符轨命中短语的上下文稳定性。
 * 与词轨同一思路，邻居换成「前一个字符 | 后一个字符」。中文术语复用
 * （"配置项说明" 出现在不同句子里，前后字各不相同）占比很低；
 * 中文真循环重复整句 → 前后字一致 → 占比接近 1。
 * 修复③（第八轮）：右侧改为取 3 个字符。表格行 `| 配置项说明：超时时间 |` 里
 * gram 两侧紧贴空格/竖线，只取 1 个字符时邻居恒定（对抗用例：15 行同标签表格
 * 稳定性 1.00，误判为循环）；取 3 个字符后，标点之后的单元格正文进入上下文，
 * 行与行之间不再"稳定"。
 * 左侧仍只取 1 个字符：中文真循环常以变化的连接词开头（首先/其次/然后…），
 * 左扩 3 会把连接词差异算进上下文而漏检（对抗用例 P4 复现）。左侧紧邻的
 * 单字符足以区分"句首变化"与"整句重复"。
 * @param {string} text 已归一化的尾窗文本
 * @param {string} gram 已命中的字符 gram
 * @returns {number} 最高频上下文占比（0~1）
 */
function charGramContextStability(text, gram) {
	const LEFT = 1;
	const RIGHT = 3;
	const ctx = new Map();
	let total = 0;
	let i = text.indexOf(gram);
	while (i >= 0) {
		const before = i > 0 ? text.slice(Math.max(0, i - LEFT), i) : "^";
		const after = i + gram.length < text.length ? text.slice(i + gram.length, i + gram.length + RIGHT) : "$";
		const key = `${before}|${after}`;
		ctx.set(key, (ctx.get(key) ?? 0) + 1);
		total++;
		i = text.indexOf(gram, i + 1);
	}
	if (total === 0) return 0;
	return Math.max(...ctx.values()) / total;
}

/**
 * 修复③（第七轮）：字符轨命中区间长度——首次命中起点到末次命中终点。
 * 用于覆盖率分母（把"重复有多密集"而不是"占全文多大比例"作为判据）。
 * 只有一次命中时区间即 gram 长度。
 * @param {string} text 已归一化的尾窗文本
 * @param {string} gram 已命中的字符 gram
 * @returns {number}
 */
function charGramSpanLength(text, gram) {
	const first = text.indexOf(gram);
	if (first < 0) return 0;
	const last = text.lastIndexOf(gram);
	return last + gram.length - first;
}

/**
 * 修复③（第七轮）：词轨命中区间长度（以 token 计）——首次命中起点到末次命中共多少个
 * 英文 token。相邻句子之间不组 gram，但游标照常累计，区间因此可能跨越句子间隔。
 * @param {string[][]} segments 按句/子句切分后的英文词序列
 * @param {string} gram 已命中的词级 gram
 * @param {number} gramSize 词数
 * @returns {number}
 */
function wordGramSpanTokens(segments, gram, gramSize) {
	const parts = gram.split(" ");
	let cursor = 0;
	let firstStart = -1;
	let lastEnd = -1;
	for (const words of segments) {
		for (let i = 0; i + gramSize <= words.length; i++) {
			let same = true;
			for (let k = 0; k < gramSize; k++) {
				if (words[i + k] !== parts[k]) { same = false; break; }
			}
			if (!same) continue;
			if (firstStart < 0) firstStart = cursor + i;
			lastEnd = cursor + i + gramSize;
		}
		cursor += words.length;
	}
	if (firstStart < 0) return 0;
	return lastEnd - firstStart;
}

/**
 * 修复②：判定是否为"语义漂移型循环"——按频次逐个取合格 gram 候选，要求
 * 出现次数 ≥ NGram_MIN_COUNT、覆盖尾窗比例 ≥ NGram_COVERAGE_RATIO，且
 * 命中短语的上下文稳定（同一句骨架反复出现，而非术语/标识符在不同句里复用）。
 * 双轨分支（互斥，不许混合）：
 *  - 英文词轨（含英文词即可）：只走英文词级 4-gram 路径，绝不回退字符
 *    5-gram——否则 "settings" 的任意 5 字符子串（"setti" 等）会被独立计数而误报。
 *    词级覆盖率 = count × 4 / min(英文 token 总数, 命中区间 token 数)——两种口径
 *    取最大值（见 NGram_DENSITY_MIN_TOKENS）；token 只计 ≥2 字母的词，
 *    单字母变量/占位符（"s"/"l"/"t"）既不进 gram 也不撑大分母。
 *  - 字符轨（中文/混合）：字符 n-gram 路径，覆盖率 = count × n / min(尾窗字符数,
 *    命中区间字符数)，同样两种口径取最大值；gram 必须含 ≥2 个 CJK 字，
 *    纯符号/版本号重复不参与。
 * 与 findRepeatingTail 并行，不破坏原逻辑。
 * @param {string} fullVisibleText
 * @returns {{maxGram:string,count:number,coverage:number}|null}
 */
function detectNGramLoop(fullVisibleText) {
	if (typeof fullVisibleText !== "string" || fullVisibleText.length < REPEAT_MIN_TEXT_CHARS) return null;
	const tail = fullVisibleText.slice(-REPEAT_WINDOW_CHARS);
	const norm = normalizeForNGram(tail);
	const fp = computeNGramFingerprint(tail, NGram_PHRASE_MIN);
	if (!fp) return null;

	// 轨 A（方案 1 并行）：英文词级 4-gram——只要文本含英文词就跑词轨。
	// 英文单词是原子 token，词轨本身不会产生 "sessi"/"ancho" 这类词内子串误报；
	// 覆盖率分母用英文 token 总数，避免中文主体把分母撑大掩盖英文真循环。
	if (fp.hasEnglishWords && fp.wordFp) {
		// 修复③（第三轮）：逐个候选校验，最多看前 NGram_WORD_CANDIDATE_LIMIT 个。
		// 最高频的候选可能恰是上下文噪声（"now/then/next" 开头的连接词 4-gram），
		// 真正循环的骨架排在后面；但同一表格单元格骨架也可能排在后面，故仍用
		// 上下文稳定性把关，稳定命中才返回。
		const candidates = listEligibleWordGrams(fp.wordFp.gramCount, NGram_WORD_GRAM_SIZE);
		for (const chosen of candidates.slice(0, NGram_WORD_CANDIDATE_LIMIT)) {
			if (chosen.count < NGram_MIN_COUNT) break;
			// 修复③（第七轮）：覆盖率同时按旧口径（整个尾窗）与密度口径（命中区间）
			// 计算并取最大值；密度分母带下限，避免短文本里集中出现的术语被抬过阈值。
			// 覆盖率不足只跳过该候选、不 break——候选按频次降序，区间更紧凑的
			// 候选可能排在后面（覆盖率和频次不同序）。
			const spanTokens = wordGramSpanTokens(fp.wordSegments, chosen.gram, NGram_WORD_GRAM_SIZE);
			const fullCoverage = chosen.count * NGram_WORD_GRAM_SIZE / fp.englishTokenCount;
			const densityCoverage = chosen.count * NGram_WORD_GRAM_SIZE / Math.max(spanTokens, NGram_DENSITY_MIN_TOKENS);
			const coverage = Math.max(fullCoverage, densityCoverage);
			if (coverage < NGram_COVERAGE_RATIO) continue;
			// 修复③（第二轮）：上下文稳定性守卫——命中短语必须在相近句骨架里反复出现，
			// 而不是作为术语/标识符在不同句子里被复用（样例 3：7 次命中全部左邻不同）。
			if (wordGramContextStability(fp.wordSegments, chosen.gram, NGram_WORD_GRAM_SIZE) >= NGram_CONTEXT_MIN_RATIO) {
				return { maxGram: chosen.gram, count: chosen.count, coverage };
			}
		}
	}

	// 轨 B（方案 1 并行）：字符级 n-gram——纯英文 gram 已在 computeNGramFingerprint
	// 中被隔离（英文词内部子串不再计入），字符轨只承担含 CJK 的文本。
	if (!fp.charFp) return null;
	const chosen = pickHighestNonStopwordGram(fp.charFp.gramCount);
	if (!chosen || chosen.count < NGram_MIN_COUNT) return null;
	// 修复③（第七轮）：同样两种口径取最大值，密度分母带下限（见上方常量注释）。
	const spanChars = charGramSpanLength(norm, chosen.gram);
	const fullCoverage = chosen.count * NGram_PHRASE_MIN / tail.length;
	const densityCoverage = chosen.count * NGram_PHRASE_MIN / Math.max(spanChars, NGram_DENSITY_MIN_CHARS);
	const coverage = Math.max(fullCoverage, densityCoverage);
	if (coverage < NGram_COVERAGE_RATIO) return null;
	// 修复③（第三轮）：字符轨同样要求上下文稳定——"配置项说明"这类术语在 12 个
	// 不同句子里复用（每次前后字都不同）不是循环；重复整句的中文真循环前后字一致。
	if (charGramContextStability(norm, chosen.gram) < NGram_CONTEXT_MIN_RATIO) return null;
	return { maxGram: chosen.gram, count: chosen.count, coverage };
}

/** 修复②：n-gram 锚点。 */
function renderNGramLoopAnchor(info) {
	return [
		`COT anchor — 语义循环（n-gram 指纹）：最近尾窗里高频短语「${info.maxGram}」重复出现 ${info.count} 次（覆盖占比约 ${(info.coverage * 100).toFixed(1)}%）。`,
		"数字每轮都在变但动词结构每轮相同，说明你在同一个行动提议上打转。",
		"立即停止。要么真的发出 tool_call，要么直接跳到结果。",
		`(NGram loop: phrase "${info.maxGram}" x${info.count}, coverage ${(info.coverage * 100).toFixed(1)}%. Stop cycling.)`
	].join("\n");
}

/**
 * Text spellings that a model invents for tool calls.  DSH has no parser for
 * any of these: a tool call only exists as a structured tool-call block
 * produced from the provider's native `tool_calls` field.  Text like
 * `<seed:tool_call><function name="edit">…` is therefore just prose — it is
 * never dispatched, the model sees no result, and a weak model can retry it
 * until the whole output budget is gone (observed: 403 identical copies).
 * Detecting it lets the plugin cut the attempt and explain the format instead
 * of merely asking the model to stop repeating.
 *
 * DETECTION IS PAIRED ON PURPOSE.  A single tag on its own is ambiguous — the
 * model may be DISCUSSING the format ("如果模型输出了 <seed:tool_call> 这种
 * 文本…") rather than attempting it, and cutting that analysis is a false
 * positive that derails a normal train of thought (observed in production:
 * a plain mention triggered the soft-cut three times in a row).  The strong
 * forms are unambiguous because they are complete call-shaped blocks; the weak
 * forms only count when a SECOND structural tag appears alongside, which prose
 * about the format does not produce.
 */
/**
 * Unambiguous: a COMPLETE call-shaped block (opener plus closer).  Bare
 * openers used to match when the model merely rehearses or quotes a call
 * inside reasoning/prose — the kernel concatenates text and reasoning into
 * one stream, so the channel cannot disambiguate; an unclosed draft followed
 * by the genuine structured call produced a false cut.  Requiring the closer
 * keeps this set to finished blocks; an opener-only runaway is still caught
 * by the repetition detector, and the weak path requires a closer too.
 */
const PSEUDO_STRONG_PATTERNS = [
	/<seed:tool_call>\s*<function\s+name\s*=[\s\S]{0,1200}?<\/function>\s*<\/seed:tool_call>/i,
	/<seed:call>\s*<function\s+name\s*=[\s\S]{0,1200}?<\/function>\s*<\/seed:call>/i,
	/<seed:tool_call>\s*<function\s+name\s*=[\s\S]{0,1200}?<\/seed:tool_call>/i,
	/<seed:call>\s*<function\s+name\s*=[\s\S]{0,1200}?<\/seed:call>/i,
	// 缺陷 5 辅助项（非本次修复生效路径）：外层包裹模式 300→1200、禁换行→允许
	// 换行，仅为覆盖其他含外层闭合的方言。对真实事故样本单独不生效：其外层闭标签
	// （idx=398）晚于 text 段末检查点（384），内核无流终检，放宽后真实节奏仍永不命中；
	// 真正截停靠支路一/二的块级信号。
	/<tool_call>\s*[\s\S]{0,1200}?<\/tool_call>/i,
	/<\|tool[▁_]?calls?[▁_]?begin\|>[\s\S]{0,400}<\|tool[▁_]?calls?[▁_]?end\|>/i,
	/antml:invoke\s*<\s*function[\s\S]{0,1200}?<\/antml:invoke>/i,
	/antml:invoke\s+name\s*=[\s\S]{0,1200}?<\/antml:invoke>/i
];
/** Ambiguous alone: only counts when another structural tag co-occurs. */
const PSEUDO_WEAK_PATTERNS = [
	/<seed:tool_call>/i,
	/<seed:call>/i,
	/<tool_call>/i,
	/<tool_use>/i,
	/<tool_calls>/i,
	/<\|tool[▁_]?calls?[▁_]?begin\|>/i
];
/** Co-occurrence form: a function tag WITH parameter tags is a call attempt, not prose about one. */
const PSEUDO_FUNCTION_TAG = /<function\s+name\s*=/i;
const PSEUDO_PARAMETER_TAG = /<parameter\s+name\s*=/i;
/**
 * 缺陷 5：MiniMax 系裸 invoke 方言信号——开标签带 name 属性、无 antml 前缀。
 * B3 噪声容忍：name 与 = 之间允许空白或至多 1 个提供商边界噪声单元（纯插入型
 * 流式边界标记，形如 `]<]minimax[>[`）。该容忍**仅对纯插入有效**：对字符被
 * 吞没的替换性破坏（事故 block3 的 `="` 被噪声吞没，剥噪直拼只能得到
 * `<invoke nameskill">`，不可逆）无效，支路二的块计数只能依赖完整的 block1/block2。
 * 注意：invoke-name 是独立信号，禁止加入 PSEUDO_WEAK_PATTERNS、禁止引入
 * function/parameter 共现支（否则"教程单块带一个 parameter"形态即误切）。
 */
const PSEUDO_INVOKE_NAME_TAG = /<invoke\s+name\s*(?:\]?<\]\w+\[\]?>?\[?)?\s*=/i;
/** 裸 invoke 闭标签（无 antml 前缀）；不匹配 antml:invoke（中间隔了 "antml:"）。 */
const PSEUDO_INVOKE_CLOSER = /<\/invoke>/i;
/**
 * 缺陷 5 支路二计数用：一个完整闭合的裸 invoke 块（开-闭非贪婪、允许换行、上限
 * 400 字符；开标签在 name 与 = 间容忍至多 1 个纯插入噪声单元）。仅用于计数，
 * 不单独作为命中条件。破损开标签（block3）无法起匹配，故事故样本计得 block1/2 两个。
 */
const PSEUDO_INVOKE_COMPLETE_BLOCK = /<invoke\s+name\s*(?:\]?<\]\w+\[\]?>?\[?)?\s*=[\s\S]{0,400}?<\/invoke>/gi;
/**
 * Closing structures proving the text-spelled block was actually FINISHED.
 * Required on the weak/co-occurrence path as well: an opener plus a function
 * or parameter tag also appears while the model rehearses an upcoming call in
 * its reasoning (the real structured call then follows and works), which must
 * not be cut.  An opener-only runaway without a closer is still stopped by the
 * repetition detector instead.
 */
const PSEUDO_CLOSER_PATTERNS = [
	/<\/seed:tool_call>/i,
	/<\/seed:call>/i,
	/<\/tool_call>/i,
	/<\|tool[▁_]?calls?[▁_]?end\|>/i,
	/<\/antml:invoke>/i,
	/<\/invoke>/i,
	/<\/function>/i
];
/** How much of the tail to scan for a call attempt (the observed block was 587 chars). */
let PSEUDO_TOOL_SCAN_TAIL = 4000;

/**
 * Decide whether the generated tail contains a FINISHED text-spelled tool call
 * attempt (as opposed to a mere mention of the format, or an unclosed draft in
 * reasoning).  Strong complete blocks count alone; weak single tags require
 * both a second structural tag and a closing structure.
 * @param {string} fullVisibleText - all visible text (text + reasoning) so far.
 * @returns {boolean}
 */
function hasPseudoToolCall(fullVisibleText) {
	if (typeof fullVisibleText !== "string" || fullVisibleText.length === 0) return false;
	const tail = fullVisibleText.slice(-PSEUDO_TOOL_SCAN_TAIL);
	if (PSEUDO_STRONG_PATTERNS.some((pattern) => pattern.test(tail))) return true;
	const weakHits = PSEUDO_WEAK_PATTERNS.filter((pattern) => pattern.test(tail)).length;
	const functionTag = PSEUDO_FUNCTION_TAG.test(tail);
	const parameterTag = PSEUDO_PARAMETER_TAG.test(tail);
	const invokeNameTag = PSEUDO_INVOKE_NAME_TAG.test(tail);
	const invokeCloser = PSEUDO_INVOKE_CLOSER.test(tail);
	const hasCloser = PSEUDO_CLOSER_PATTERNS.some((pattern) => pattern.test(tail));
	// Without a closing structure the block is either prose about the format or
	// an in-progress rehearsal — both must be left alone.
	if (!hasCloser) return false;
	// 既有两支原样保留：weak + function/parameter 共现，或 function+parameter 成对。
	// invoke-name 不引入这两支（"教程单块带一个 parameter"形态必须不命中）。
	if ((weakHits >= 1 && (functionTag || parameterTag))
		|| (functionTag && parameterTag)) return true;
	// 缺陷 5 支路一（有包裹三信号）：外层包裹开标签（weakHits，仍只由既有 6 个
	// PSEUDO_WEAK_PATTERNS 计数，invoke-name 不入该数组）+ 裸 invoke name 开标签。
	// hasCloser 前置门已保证存在闭标签。
	if (weakHits >= 1 && invokeNameTag) return true;
	// 缺陷 5 支路二（无包裹多块）：两个及以上完整闭合的裸 invoke 块（模型文本化
	// 并行调用的形态）。单块无包裹与教程示例客观同形，有意漏判，repeat 检测器仍
	// 兜重复形态。块正则仅用于计数，不单独作为命中条件。
	if (invokeNameTag && invokeCloser) {
		const completeBlocks = tail.match(PSEUDO_INVOKE_COMPLETE_BLOCK);
		if (completeBlocks !== null && completeBlocks.length >= 2) return true;
	}
	return false;
}

/**
 * Render the anchor that corrects an unrecognized tool call.
 * Deliberately does NOT quote the raw tag spellings (e.g. the seed-style
 * call tag): the anchor text itself becomes part of the visible text, and
 * spelling the trigger verbatim would re-trigger the detector on the very
 * next soft-cut check — a self-sustaining loop observed in production.
 * @param {boolean} alsoLooping - whether the same attempt was also repeating.
 * @param {{count:number}|null} loop - loop details when `alsoLooping`.
 * @returns {string}
 */
function renderPseudoToolAnchor(alsoLooping, loop) {
	const lines = [
		"COT anchor — 你刚才输出的工具调用是**文本**形式，系统不会识别、也不会执行它。",
		"不要再写尖括号拼出来的调用标签（比如 seed 风格或 function/parameter 标签）；它们只是普通文字。",
		"请直接发起工具调用（使用工具调用能力本身），一次就够，不要重复输出同一段内容。",
		"若确实无法发起工具调用，就用一句话说明你需要什么，不要再贴工具调用的文本。"
	];
	if (alsoLooping && loop) {
		lines.push(`（该无效调用已被识别为重复 ${loop.count} 次，重复部分已丢弃。）`);
	}
	lines.push("(Your tool call was written as plain text, so the Harness never executed it. Emit a real tool call instead — once.)");
	return lines.join("\n");
}

/**
 * 缺陷 4 修复：从工具参数校验错误中提取实际缺失/非法的参数名。
 * 字段路径复核（@deepseek-ai/dsh-tools 源码）：ToolArgsError 的 message 固定为
 * `invalid arguments: <violation; violation>`，violation 形如
 * `missing required property "description"`；较新版本在 error.info.violations 挂载
 * 原始字符串数组。实测宿主传出的 error 仅序列化 {name, code} 两键——错误串只出现在
 * result.content 文本里，故本函数按三个来源依次抽取（去重保序）：① info.violations；
 * ② content 文本中 /missing required property "…"/ 的字段名；③ error.message 中
 * 双引号内的字段名。三者都取不到实际字段时返回空数组——调用方据此降级为通用句式，
 * 禁止编造参数名。判据路径（error.name/code 或 info.name/code）在调用处另行校验。
 * @param {{name?:string, code?:string, message?:string, info?:{name?:string, code?:string, violations?:unknown}} | null | undefined} error
 * @param {unknown} [contentBlocks] - result.content（块数组；文本块参与抽取）。
 * @returns {string[]} 去重且保序的实际参数名；无字段时为空数组。
 */
function extractInvalidArgFields(error, contentBlocks) {
	const fields = [];
	const seen = new Set();
	const addField = (field) => {
		if (typeof field === "string" && field.length > 0 && !seen.has(field)) {
			seen.add(field);
			fields.push(field);
		}
	};
	// 源 ①：结构化 info.violations（较新内核形态，最可靠）。
	const infoViolations = error?.info?.violations;
	if (Array.isArray(infoViolations)) {
		const quotedField = /"([^"]+)"/g;
		for (const entry of infoViolations) {
			let match;
			while ((match = quotedField.exec(String(entry))) !== null) addField(match[1]);
		}
	}
	// 源 ②：result.content 文本（实测宿主把错误串放在这里）。只认
	// missing required property 句式，禁止对整段文本做泛引号扫描。
	const missingProperty = /missing required property "([^"]+)"/g;
	if (Array.isArray(contentBlocks)) {
		for (const block of contentBlocks) {
			const text = typeof block?.text === "string" ? block.text : "";
			let match;
			while ((match = missingProperty.exec(text)) !== null) addField(match[1]);
		}
	}
	// 源 ③：error.message 双引号字段（旧内核形态兜底）。
	if (typeof error?.message === "string" && error.message.length > 0) {
		const quotedField = /"([^"]+)"/g;
		let match;
		while ((match = quotedField.exec(error.message)) !== null) addField(match[1]);
	}
	return fields;
}

/**
 * 缺陷 4 修复：ToolArgsError 续步恢复锚点正文。四要素：①上一次工具调用未被执行；
 * ②缺失/非法参数名（取不到时降级通用句式，锚点不允许整条缺失）；③按参数要求重发
 * 且只发一次；④禁止把调用写成文本标签。该锚点不依赖 reasoning 长度。
 * @param {string|undefined} toolName - 工具名（exec.name；缺失时用通用指称）。
 * @param {string[]} fields - extractInvalidArgFields 的结果；空数组走通用句式。
 * @returns {string}
 */
function renderToolArgsErrorAnchor(toolName, fields) {
	const toolLabel = typeof toolName === "string" && toolName.trim() !== "" ? toolName.trim() : "上一次工具调用";
	if (fields.length > 0) {
		return [
			`COT anchor — 上一次工具调用未被执行：${toolLabel} 的参数校验未通过（缺失或非法参数：${fields.join("、")}）。`,
			"请对照该工具的完整参数 schema 补齐或修正上述参数后重新发起调用，且只重发一次，不要重复提交。",
			"禁止把工具调用写成尖括号拼出的文本标签；必须使用工具调用能力本身发起。",
			`(Your previous tool call was NOT executed: ${toolLabel} arguments failed validation (${fields.join(", ")}). Resend exactly once with schema-valid arguments via the real tool-call channel — never as text tags.)`
		].join("\n");
	}
	// 通用句式降级：抽不到参数名时仍必须给出可执行的恢复指引。
	return [
		`COT anchor — 上一次工具调用未被执行：${toolLabel} 的参数非法。`,
		"上一次工具调用参数非法，按工具完整参数要求重发一次；补齐全部必填参数，且只重发一次，不要重复提交。",
		"禁止把工具调用写成尖括号拼出的文本标签；必须使用工具调用能力本身发起。",
		`(Your previous tool call was NOT executed: ${toolLabel} arguments were invalid. Resend exactly once following the tool's full parameter requirements — never as text tags.)`
	].join("\n");
}

/**
 * "Churn" phrases: restart/transition words a stuck model emits over and over
 * while re-analyzing the SAME problem from scratch in slightly different words
 * ("Let me…", "Hmm.", "Wait. Actually, let me reconsider…").
 *
 * The periodic-loop detector cannot see this: nothing is byte-identical, so
 * there is no period to find.  But the restart words themselves recur at a
 * pathological rate.  The observed sample (another runaway) contained
 * "Let me" 638 times in 61k chars — roughly once every 95 characters, which
 * normal prose never approaches.  Counting only high-signal restart phrases
 * keeps the false-positive rate low: common words such as "ok", "now" or
 * "wait" are deliberately NOT counted.
 */
let CHURN_PHRASES = [
	/\blet me\b/gi,
	/\bhmm+\b/gi,
	/\breconsider\b/gi,
	/\bre-?read\b/gi,
	/\bi need to\b/gi,
	/让我(再|重新|先)?(想想|想一下|理一下|重新)/g,
	/再重新(看|想|分析)/g
];
/** Only the trailing slice is counted — the same window bound as the loop detector. */
let CHURN_WINDOW_CHARS = 3000;
/**
 * Hits required inside that window.  Tuned aggressively but NOT to the extreme:
 * this is the only heuristic trigger (the others detect content that is literally
 * pathological), and a hard problem legitimately restarts analysis several times.
 * Real data: the observed runaway scored 41–42 per window; ordinary technical
 * prose scores ~2.  18 ≈ one restart phrase every 165 chars leaves a wide margin
 * below the runaway while still firing earlier than the original 25.
 */
let CHURN_MIN_HITS = 18;
/** Churn is only meaningful in an already long generation (lowered to fire sooner). */
let CHURN_MIN_TEXT_CHARS = 800;

// ── 修复①：churn 行动提议分支 ──
// 现有 CHURN_PHRASES 全是"思维重启"（让我想想 / re-read / reconsider），
// 漏了"行动提议"——工具动词反复出现但零 tool_call 的异常形态。
// 阈值沿用 CHURN_MIN_HITS=18，普通技术文本行动动词命中 0-3/3000 字，泄漏样本约 75/3000。
const CHURN_ACTION_PHRASES = [
	/让我.{0,10}?(?:curl|fetch|web[-_ ]?fetch|试一下|访问|看看|探|查|验证|打开)/g,
	/我先.{0,10}?(?:curl|fetch|web[-_ ]?fetch|试一下|访问|看看|探|查)/g,
	/现在.{0,10}?(?:curl|fetch|试一下|访问|看看)/g,
	/直接.{0,6}?(?:curl|fetch|web[-_ ]?fetch|访问|打开)/g,
	/先.{0,6}?(?:curl|fetch|web[-_ ]?fetch|试一下|看看|访问|探|查)/g,
	/(?:curl|fetch|web[-_ ]?fetch).{0,3}?(?:一下|看看|试试)/g
];
const CHURN_ACTION_MIN_HITS = 18;

/**
 * Count restart-phrase hits in the trailing window.
 * @param {string} fullVisibleText
 * @returns {number}
 */
function countChurnHits(fullVisibleText, phrases) {
	const tail = fullVisibleText.slice(-CHURN_WINDOW_CHARS);
	const list = Array.isArray(phrases) ? phrases : CHURN_PHRASES;
	let hits = 0;
	for (const pattern of list) {
		pattern.lastIndex = 0;
		const matched = tail.match(pattern);
		if (matched) hits += matched.length;
	}
	return hits;
}

/**
 * Decide whether the model is churning — repeatedly restarting its analysis
 * without advancing — rather than writing distinct content.
 * @param {string} fullVisibleText
 * @returns {{hits:number}|null}
 */
function detectChurn(fullVisibleText) {
	if (typeof fullVisibleText !== "string" || fullVisibleText.length < CHURN_MIN_TEXT_CHARS) return null;
	const hits = countChurnHits(fullVisibleText);
	if (hits < CHURN_MIN_HITS) return null;
	return { hits };
}

/**
 * 修复①：检测"行动提议型空转"——尾窗内工具动词前缀 / 后缀形态的正则计数 ≥ 阈值。
 * 与 detectChurn 并行：CHURN_PHRASES 抓思维重启，CHURN_ACTION_PHRASES 抓行动提议。
 * @param {string} fullVisibleText
 * @returns {{hits:number}|null}
 */
function detectActionChurn(fullVisibleText) {
	if (typeof fullVisibleText !== "string" || fullVisibleText.length < CHURN_MIN_TEXT_CHARS) return null;
	const hits = countChurnHits(fullVisibleText, CHURN_ACTION_PHRASES);
	if (hits < CHURN_ACTION_MIN_HITS) return null;
	return { hits };
}

/**
 * Render the anchor that breaks a churn loop.
 * @param {{hits:number}} churn
 * @returns {string}
 */
function renderChurnAnchor(churn) {
	return [
		`COT anchor — 你正在原地空转：最近约 ${CHURN_WINDOW_CHARS} 字里出现了 ${churn.hits} 次"让我想想/重新分析"这类重启用语，说明你在反复重新分析同一个问题而没有推进。`,
		"立即停止重新分析。不要再复述已知信息、不要重新检查已经确认过的结论。",
		"直接给出当前结论，或执行你已经决定的下一步；只输出你尚未说过的内容。",
		`(You are churning: ${churn.hits} restart phrases in the last ~${CHURN_WINDOW_CHARS} chars. Stop re-analyzing; emit only what you have not said yet, then act.)`
	].join("\n");
}

/**
 * 修复①：行动提议型空转锚点。与 renderChurnAnchor 并列，用语明确指向"说了要调用但从未调用"。
 * @param {{hits:number}} churn
 * @returns {string}
 */
function renderActionChurnAnchor(churn) {
	return [
		`COT anchor — 行动提议空转：最近约 ${CHURN_WINDOW_CHARS} 字里出现了 ${churn.hits} 次"让我 curl / web_fetch"这类行动提议，但全程没有实际工具调用。`,
		"立即停止空喊工具名。不要再说\"让我 curl 一下\"、\"先试试 web_fetch\"这类没有执行的提议。",
		"要么真的发出 tool_call（带完整参数），要么直接跳到结果；不要再重复同一个行动提议。",
		`(Action-proposal stall: ${churn.hits} tool-verb proposals in the last ~${CHURN_WINDOW_CHARS} chars with zero real tool_call. Stop proposing — either emit the tool_call or give the result.)`
	].join("\n");
}

/**
 * Over-long CoT soft-cut anchor. Triggered purely on text length — a
 * "last-resort" reminder, not an anomaly detector like churn/repeat.
 * 2026-11-05: wording hardened from a gentle nudge into an explicit
 * two-way-only instruction, with per-turn escalation appended on repeats.
 */
/**
 * 渲染 over-long-cot 提醒锚点。
 * @param {number} reasoningChars - 计数口径内字符数（纯思考或 merged 全长估算）
 * @param {number} threshold - 阈值（设置值原样）
 * @param {boolean} hasStreams - 是否用内核分离计数
 * @param {number} occurrence - 本 turn 内第几次因过长被切（从 1 开始）
 * @returns {string}
 */
function renderOverLongCoTAnchor(reasoningChars, threshold, hasStreams, occurrence = 1) {
	const scope = hasStreams
		? `本次思考已达约 ${reasoningChars} 字（阈值 ${threshold}）`
		: `本次输出已达约 ${reasoningChars} 字（阈值 ${threshold}，含回答文本，思考部分估算）`;
	const lines = [
		`COT anchor — 停止生成思考内容：${scope}，已判定为过度思考。`,
		"从这一刻起，不要再写任何分析、排查、计划、复述，也不要写「我应该立即行动」「接下来我会…」这类表态——表态不等于执行。",
		"下一条消息只能是以下两种之一（二选一）：① 一次真实工具调用（选当前最可执行的一步，先做再判断）；② 直接给用户的最终答案（写出已确认结论，未确认项列为待办）。",
		"信息不足时选①中最小的可验证动作；不得以「再查一下 / 再确认一下」为理由继续输出文字。",
		"(Stop generating reasoning now. Your next message MUST be either one real tool call, or the final answer to the user. No analysis, no plans, no restating, no \"I should act now\" declarations. If information is insufficient, make the smallest verifiable tool call instead of writing more text.)"
	];
	return lines.join("\n") + renderOverLongEscalation(occurrence);
}

/**
 * 第 2 次及以后追加的升级指令。逐次加码，避免连续多次注入逐字相同的提醒
 * 被模型当成环境噪声或思考开场模板；不声称插件能强制中止（内核才持有剪刀）。
 * @param {number} occurrence - 本 turn 内第几次命中（>=1）
 * @returns {string} 第 1 次返回空串
 */
function renderOverLongEscalation(occurrence) {
	if (occurrence < 2) return "";
	const lines = ["",
		`本 turn 第 ${occurrence} 次因 CoT 过长被切断。上一次提醒之后你没有执行工具调用、也没有给出结论，而是继续分析——这正是再次被切断的原因。`];
	if (occurrence >= 3) {
		lines.push(`重复提醒已达 ${occurrence} 次：把上面的「二选一」当作硬约束。不要再写任何新的分析段落或行动计划，现在直接调用工具或输出最终答案。`);
	}
	if (occurrence >= 5) {
		lines.push("内核的启发式打断预算（与其他检测器共享）可能已接近上限，后续不一定再有提醒；这一次必须收尾。");
	}
	return lines.join("\n");
}

/** over-long-cot 每 turn 命中计数。与 churn 计数隔离，避免不同检测器互相污染。 */
const overLongCountBySession = new Map();
/** LRU 上限，与 churnCountBySession 同值。 */
const OVER_LONG_COUNT_MAP_LIMIT = 32;

function evictOverLongCountOldest() {
	if (overLongCountBySession.size <= OVER_LONG_COUNT_MAP_LIMIT) return;
	const oldestKey = overLongCountBySession.keys().next().value;
	if (oldestKey !== undefined) overLongCountBySession.delete(oldestKey);
}

/**
 * 递增并回传 occurrence；turn 大于上次记录时就地归零（同 turn 结算消息不误归零）。
 * 计数的是插件返回的 cut 决策，与内核是否采纳无关。
 */
function recordOverLongCut(sessionId, turn) {
	let state = overLongCountBySession.get(sessionId);
	if (!state) {
		state = { lastTurn: 0, count: 0 };
		overLongCountBySession.set(sessionId, state);
		evictOverLongCountOldest();
	}
	if (Number.isFinite(turn) && turn > state.lastTurn) {
		state.lastTurn = turn;
		state.count = 0;
	}
	state.count += 1;
	return state.count;
}

/** session/event 观察者的 turn 边界回调，与 resetChurnCountOnTurnBoundary 并列。 */
function resetOverLongCountOnTurnBoundary(sessionId, turn) {
	if (!Number.isFinite(turn)) return;
	const state = overLongCountBySession.get(sessionId);
	if (!state) {
		overLongCountBySession.set(sessionId, { lastTurn: turn, count: 0 });
		evictOverLongCountOldest();
		return;
	}
	if (turn > state.lastTurn) {
		state.lastTurn = turn;
		state.count = 0;
	}
}

/**
 * 缺陷 3 修复（2026-10-07 升级版）：churn 每 turn 命中计数。键 = sessionId，值为
 * { lastTurn, count }：count 是本 turn handler 返回 churn cut 决策的次数。计数口径
 * 是**插件返回 cut 决策**，不是内核实际采纳次数（插件观测不到内核预算裁决；决策被
 * 内核因预算 reject 时，其升级文案本就不进入 inbox，属预期无副作用，不做补偿）。
 * Map 有界：LRU 上限 32、超限逐出最旧 session，模式照搬 injectedReasoningBySession。
 * turn 归零有两条协同路径：① session/event 观察者识别 assistant/message，当
 * data.turn 大于该 session 上次记录值时重置（插件无 turn 生命周期事件，这是唯一
 * 可用的被动边界，禁止假设存在 turn/start 事件）；② churn 决策自身携带
 * payload.turn，首次决策即发现换 turn 时就地归零——后者消除"新 turn 的首个软切
 * 结算消息才触发被动重置"造成的一次计数偏移。
 */
const churnCountBySession = new Map();
/** churn 计数 Map 的上限（LRU：超限逐出最旧 session），与指纹去重 Map 同值。 */
const CHURN_COUNT_MAP_LIMIT = 32;

/** 超限时逐出最旧 session 记录（插入序，与指纹去重 Map 同一清理模式）。 */
function evictChurnCountOldest() {
	if (churnCountBySession.size <= CHURN_COUNT_MAP_LIMIT) return;
	const oldestKey = churnCountBySession.keys().next().value;
	if (oldestKey !== undefined) churnCountBySession.delete(oldestKey);
}

/**
 * 读取并递增该 session 的 churn cut 计数；session 尚无记录时按新档案建档。
 * @param {string} sessionId - 归一化后的会话键（缺省用空串兜底）。
 * @param {unknown} turn - payload.turn（waterfall 携带；缺失时跳过就地归零判定）。
 * @returns {number} 递增后的 occurrence（从 1 开始）。
 */
function recordChurnCut(sessionId, turn) {
	let state = churnCountBySession.get(sessionId);
	if (!state) {
		state = { lastTurn: 0, count: 0 };
		churnCountBySession.set(sessionId, state);
		evictChurnCountOldest();
	}
	if (Number.isFinite(turn) && turn > state.lastTurn) {
		state.lastTurn = turn;
		state.count = 0;
	}
	state.count += 1;
	return state.count;
}

/**
 * session/event 观察者的 turn 边界回调：assistant/message 携带的 data.turn 大于
 * 该 session 上次记录值时，把 churn 计数归零（新 turn 开始）。turn 缺失或非有限
 * 数值时不动作。
 * @param {string} sessionId - 归一化后的会话键。
 * @param {unknown} turn - event.data.turn（数字或缺失）。
 * @returns {void}
 */
function resetChurnCountOnTurnBoundary(sessionId, turn) {
	if (!Number.isFinite(turn)) return;
	const state = churnCountBySession.get(sessionId);
	if (!state) {
		churnCountBySession.set(sessionId, { lastTurn: turn, count: 0 });
		evictChurnCountOldest();
		return;
	}
	if (turn > state.lastTurn) {
		state.lastTurn = turn;
		state.count = 0;
	}
}

/**
 * 第 2 次及以后的 churn 锚点追加的升级指令；达 6 次时追加插件侧预算说明
 * （必须注明是插件发起计数，不得声称内核一定接受——内核可能因预算 reject）。
 * @param {number} occurrence - 本 turn 内这是第几次 churn cut 决策（>=1）。
 * @returns {string}
 */
function renderChurnEscalation(occurrence) {
	const lines = ["", `本 turn 第 ${occurrence} 次空转，下一步必须是一次真实工具调用或最终结论，禁止继续分析。`];
	if (occurrence >= 6) {
		lines.push("插件侧已发起 6 次空转打断（此为插件发起计数，内核可能因预算拒绝后续打断），此后仅字节级重复检测仍可能拦截。");
	}
	return lines.join("\n");
}

/**
 * True when the tail sits inside an unclosed fenced code block.  Cutting there
 * would persist a half-written code block and ask the model to continue from
 * the middle of it, which is worse than the churn we were trying to stop.
 * Only the HEURISTIC trigger backs off here: exact repetition and an invalid
 * tool call are garbage regardless of where they appear, so they still cut.
 * @param {string} fullVisibleText
 * @returns {boolean}
 */
function insideUnclosedCodeFence(fullVisibleText) {
	const tail = fullVisibleText.slice(-4000);
	const fences = tail.match(/```/g);
	return fences !== null && fences.length % 2 === 1;
}


// ---------------------------------------------------------------------------
// Runtime settings — editable from Settings → COT Anchor
// ---------------------------------------------------------------------------
//
// Every tunable lives here.  The detection functions read the mutable
// module-level bindings declared above; `applyRuntimeSettings` is the single
// writer, so the shipped defaults stay in one place and the Settings tab can
// change behavior without a restart.
//
// Node built-ins (fs) are imported at the top but only USED inside `apply` and
// the settings helpers below, never at module scope: the unit tests import this
// module with its `import`/`export` lines stripped, so any module-scope fs call
// would break them.

/** Shipped defaults for every tunable. */
const DEFAULT_SETTINGS = {	// Master switches
	enableSoftCut: true,
	// 外部插件经 stallGovernor 服务请求(上游为 cotAnchor 服务;derive-watcher 本机未安装,预留接口)
	// 软切的总开关。发布默认 true：让 cot-anchor + derive-watcher 三插件联动
	// 开箱即用；外部请求只占用启发式额度，不会触发硬中止。
	enableExternalSoftCut: true,
	// Per-detector switches
	enablePseudoTool: true,
	enableRepeat: true,
	enableChurn: true,
	enableTransition: true,
	enableNumberRunaway: true,
	enableOverLongCoT: false,
	// Notice/anchor shaping
	minReasoningChars: 250,
	maxPoints: 3,
	maxPointChars: 220,
	// D5：回流/注入内容长度守恒校验（默认开启）
	enableLengthConservationCheck: true,
	// D3：text/reasoning 分流模式（内核 text/reasoning 分流由子卡 C 提供；
	// 内核未就位前该设置仅登记，不伪造生效）
	transitionTextMode: "separateThreshold",
	// FIX-09：命令执行纪律块随锚点同车注入的独立开关。默认 true——开态与
	// 开关引入前的注入行为逐字一致；false 时仅不注入纪律块，结论锚点链
	// （提取/去重/守恒/配平/注入）不受影响。
	enableExecDisciplineBlock: true,
	// Transition (soft-cut) detector
	softCutScanTail: 160,
	softCutTransitionWindow: 48,
	softCutMinFollowChars: 6,
	softCutGapThreshold: 80,
	// Over-long CoT soft-cut: the length that triggers a reminder cut.
	// 0 = disabled. Default 8000 chars. This is the FINAL threshold in both
	// kernel counting modes — no implicit multiplier is applied at the hook site.
	overLongCoTThreshold: 8000,
	// Repetition detector
	repeatProbeChars: 128,
	repeatWindowChars: 16000,
	repeatMinPeriod: 12,
	repeatShortPeriod: 96,
	repeatMaxPeriod: 8000,
	repeatMinCount: 2,
	repeatMinCountShort: 5,
	repeatUltraShortMinCount: 30,
	repeatMinTextChars: 800,
	// NGram 语义指纹（修复②）参数：默认值与模块级 let 绑定字面量一致，
	// applyRuntimeSettings 写回对应绑定；schema 范围（见 SETTINGS_SCHEMA）覆盖默认值。
	ngramPhraseMin: 5,
	ngramMinCount: 5,
	ngramCoverageRatio: 0.05,
	// Churn detector
	churnWindowChars: 3000,
	churnMinHits: 18,
	churnMinTextChars: 800,
	// Number-runaway detector
	numberRunMinTextChars: 800,
	numberRunMinChars: 500,
	numberRunMaxGap: 8,
	numberRunMinDigitRatio: 0.5,
	numberRunMinIncreaseRatio: 0.55,
	// Invalid tool-call detector
	pseudoToolScanTail: 4000,
};

/** Currently applied settings (booleans are read directly from here). */
let settings = { ...DEFAULT_SETTINGS };

/** Notice/anchor shaping parameters, mirrored as mutable bindings. */
let MIN_REASONING_CHARS = DEFAULT_SETTINGS.minReasoningChars;
let MAX_POINTS = DEFAULT_SETTINGS.maxPoints;
let MAX_POINT_CHARS = DEFAULT_SETTINGS.maxPointChars;
// D3：text/reasoning 分流模式（内核侧由子卡 C 提供；未就位前仅登记不生效）
let TRANSITION_TEXT_MODE = DEFAULT_SETTINGS.transitionTextMode;

/**
 * Settings metadata: the single source of truth for the client form.  The
 * client renders rows from this list, so a new tunable only needs an entry
 * here plus a line in `applyRuntimeSettings`.
 */
const SETTINGS_SCHEMA = [
	{ key: "enableSoftCut", label: "允许生成中途打断（软切断）", type: "boolean", group: "总开关",
		hint: "关闭后只保留工具边界的注入，不再在生成过程中切断。" },
	{ key: "enableExternalSoftCut", label: "允许外部插件请求软切", type: "boolean", group: "总开关",
		hint: "开启后允许其他插件（如 dsh-derive-watcher 检测到二级语义停滞时）请求本插件在生成边界软切。外部请求只占用启发式额度，不会触发硬中止；默认开启（开箱即用）。" },

	{ key: "enablePseudoTool", label: "识别伪工具调用", type: "boolean", group: "打断判定",
		hint: "模型把工具调用写成文本（如 <seed:tool_call>）时打断并纠正格式。" },
	{ key: "enableRepeat", label: "识别重复/语义循环（n-gram 指纹）", type: "boolean", group: "打断判定",
		hint: "同一段内容被反复吐出，或尾窗内高频短语反复出现（注入提示「语义循环（n-gram 指纹）」）时打断，并裁掉落盘的重复部分。" },
	{ key: "enableChurn", label: "识别语义空转", type: "boolean", group: "打断判定",
		hint: "措辞不同但反复\"重新分析\"时打断（注入提示「原地空转」）；含只说不做的\"行动提议空转\"（注入提示「行动提议空转」）。属启发式判定，遇到未闭合代码块会自动让路。" },
	{ key: "enableTransition", label: "识别转折句", type: "boolean", group: "打断判定",
		hint: "\"接下来我要……\"这类转折句出现时打断，先注入结论锚点。" },
	{ key: "enableNumberRunaway", label: "识别数字递增流退化", type: "boolean", group: "打断判定",
		hint: "长段递增数字流（如 639.640) 640.641)…）连续多字且无实质内容时打断。启发式判定，仅在数字流足够长时触发。" },
	{ key: "enableOverLongCoT", label: "过长 CoT 软切", type: "boolean", group: "打断判定",
		hint: "当本轮 CoT 累计字符数达到下方阈值时软切并提醒模型「落实阶段性结论、避免过度思考」。属兜底提醒，独立于其他启发式检测。默认关闭。" },

	{ key: "minReasoningChars", label: "最少思考字数", type: "number", min: 50, max: 5000, group: "锚点内容",
		hint: "思考短于此长度时不提取结论、不注入。" },
	{ key: "maxPoints", label: "锚点最多结论条数", type: "number", min: 1, max: 8, group: "锚点内容" },
	{ key: "maxPointChars", label: "单条结论最大字数", type: "number", min: 40, max: 1000, group: "锚点内容" },
	{ key: "enableLengthConservationCheck", advanced: true, label: "长度守恒校验", type: "boolean", group: "锚点内容",
		hint: "注入前先核对锚点正文和每条结论逐字一致，防止摘要被截断或丢字；对不上就放弃这次注入。" },
	{ key: "transitionTextMode", advanced: true, label: "思考与正文如何分开（内核支持后生效）", type: "select", group: "锚点内容",
		options: [
			{ value: "separateThreshold", label: "按字数阈值自动分开（默认）" },
			{ value: "disable", label: "不分开，整段当作正文处理" }
		],
		hint: "决定怎么把模型的「思考」和「正文」区分开来。内核还没支持这一项，选什么都不会改变行为，先按默认放着即可。" },
	{ key: "enableExecDisciplineBlock", label: "随锚点注入命令执行纪律块", type: "boolean", group: "锚点内容",
		hint: "默认开启。开启时会把「执行命令要守规矩」这段提醒和结论摘要一起插回上下文；关闭就完全不插这段提醒，结论摘要和其他识别、去重功能都不受影响。" },

	{ key: "overLongCoTThreshold", advanced: true, label: "CoT 长度阈值（字符）", type: "number", min: 0, max: 100000, group: "过长 CoT 参数",
		hint: "本轮 CoT 累计字符数达到此值即触发软切提醒，设置值直接生效、不会被放大。默认 8000；设为 0 即关闭（同关闭上方开关效果一致）。内核未分流 text/reasoning 时按整段输出长度估算（含回答文本）；只想统计纯思考字数，请把内核切到 separateThreshold 模式。" },

	{ key: "numberRunMinTextChars", advanced: true, label: "数字流启用最小文本长度", type: "number", min: 100, max: 50000, group: "数字流参数" },
	{ key: "numberRunMinChars", advanced: true, label: "数字流最短跨度", type: "number", min: 50, max: 20000, group: "数字流参数" },
	{ key: "numberRunMaxGap", advanced: true, label: "数字流最大间隙", type: "number", min: 1, max: 200, group: "数字流参数",
		hint: "相邻数字 token 之间允许的最大字符间隔。" },
	{ key: "numberRunMinDigitRatio", advanced: true, label: "数字流最小数字占比", type: "number", min: 0, max: 1, group: "数字流参数" },
	{ key: "numberRunMinIncreaseRatio", advanced: true, label: "数字流最小递增占比", type: "number", min: 0, max: 1, group: "数字流参数" },

	{ key: "repeatMinCount", advanced: true, label: "长块重复次数阈值", type: "number", min: 2, max: 10, group: "重复循环参数",
		hint: "长内容（超过下方\"短周期分界\"）重复达到此次数即判定打转。" },
	{ key: "repeatMinCountShort", advanced: true, label: "短周期重复次数阈值", type: "number", min: 2, max: 30, group: "重复循环参数",
		hint: "短内容循环需重复更多次才判定打转；调低则更激进。" },
	{ key: "repeatUltraShortMinCount", advanced: true, label: "超短周期重复次数阈值", type: "number", min: 5, max: 200, group: "重复循环参数",
		hint: "周期 2~11 字的极小循环（如 `er4er4…` token 卡死）须重复到这么多次才判定；正常强调/分隔线（====、-----）不构成威胁。" },
	{ key: "repeatMinPeriod", advanced: true, label: "最小周期字数", type: "number", min: 4, max: 500, group: "重复循环参数" },
	{ key: "repeatShortPeriod", advanced: true, label: "短周期分界字数", type: "number", min: 16, max: 2000, group: "重复循环参数" },
	{ key: "repeatMaxPeriod", advanced: true, label: "最大周期字数", type: "number", min: 500, max: 50000, group: "重复循环参数" },
	{ key: "repeatWindowChars", advanced: true, label: "重复检查窗口", type: "number", min: 1000, max: 60000, group: "重复循环参数",
		hint: "只在文本尾部这段长度内做周期性预筛（性能保护）。" },
	{ key: "repeatProbeChars", advanced: true, label: "周期探针长度", type: "number", min: 16, max: 2000, group: "重复循环参数" },
	{ key: "repeatMinTextChars", advanced: true, label: "启用最小文本长度", type: "number", min: 500, max: 50000, group: "重复循环参数" },
	{ key: "ngramPhraseMin", advanced: true, label: "n-gram 短语最小长度（字符）", type: "number", min: 3, max: 20, group: "重复循环参数",
		hint: "字符级 n-gram 的滑窗粒度（中文路径）。默认 5；调高要求更长的短语才计数（更保守）。英文路径固定按相邻 4 个词（每词 ≥2 字母），不受此项影响。" },
	{ key: "ngramMinCount", advanced: true, label: "n-gram 最高频短语最小出现次数", type: "number", min: 2, max: 50, group: "重复循环参数",
		hint: "最高频短语至少出现这么多次才判定循环；调低更激进、调高更保守。" },
	{ key: "ngramCoverageRatio", advanced: true, label: "n-gram 短语覆盖占比下限", type: "number", min: 0.01, max: 0.5, group: "重复循环参数",
		hint: "最高频短语占用尾窗的最小比例，0.05=5%；调高则更保守。" },

	{ key: "churnMinHits", advanced: true, label: "空转词命中阈值", type: "number", min: 5, max: 100, group: "语义空转参数",
		hint: "窗口内出现这么多次\"让我想想/重新分析\"类用语即判定空转；调低则更激进。" },
	{ key: "churnWindowChars", advanced: true, label: "空转统计窗口", type: "number", min: 500, max: 20000, group: "语义空转参数" },
	{ key: "churnMinTextChars", advanced: true, label: "启用最小文本长度", type: "number", min: 500, max: 50000, group: "语义空转参数" },

	{ key: "softCutScanTail", advanced: true, label: "转折句扫描窗口", type: "number", min: 40, max: 2000, group: "转折句参数" },
	{ key: "softCutTransitionWindow", advanced: true, label: "转折词距句末窗口", type: "number", min: 8, max: 500, group: "转折句参数" },
	{ key: "softCutMinFollowChars", advanced: true, label: "转折词后最少展开字数", type: "number", min: 2, max: 200, group: "转折句参数",
		hint: "转折词（如\"我先\"）之后至少输出这么多字才允许切断，防止在句子刚开头就切断思考、截出半句结论。" },
	{ key: "softCutGapThreshold", advanced: true, label: "结论-转折最大间距", type: "number", min: 0, max: 400, group: "转折句参数",
		hint: "Tier-1 结论标记（如\"所以\"）与后续转折宣告（如\"接下来\"）之间允许的最大字符距离。超过则认为是子阶段小结论而非阶段边界，拒绝软切。默认 80。" },
	{ key: "pseudoToolScanTail", advanced: true, label: "伪调用扫描窗口", type: "number", min: 200, max: 20000, group: "伪工具调用参数" },
];

/**
 * Merge a settings patch, clamp numbers, and publish the values into the
 * mutable bindings the detectors read.  Unknown keys are dropped; invalid
 * numbers fall back to the shipped default.
 * @param {object|null|undefined} raw - partial settings from config or the UI.
 * @returns {object} the effective settings after clamping.
 */
function applyRuntimeSettings(raw) {
	const incoming = raw && typeof raw === "object" ? raw : {};
	const known = {};
	for (const key of Object.keys(DEFAULT_SETTINGS)) {
		if (Object.prototype.hasOwnProperty.call(incoming, key)) known[key] = incoming[key];
	}
	const merged = { ...DEFAULT_SETTINGS, ...known };
	const specOf = new Map(SETTINGS_SCHEMA.map((entry) => [entry.key, entry]));
	const clampNumber = (key) => {
		const spec = specOf.get(key);
		// 整数默认键四舍五入取整；比值类键（默认值本身是小数，如 0.5/0.55）保留小数精度，
		// 否则 Math.round 会把 0.5/0.55 抬成 1，阈值永远落空（D7 修复中发现）。
		const round = Number.isInteger(DEFAULT_SETTINGS[key]) ? Math.round : Number;
		const value = round(Number(merged[key]));
		if (!Number.isFinite(value)) return DEFAULT_SETTINGS[key];
		const low = spec?.min ?? 0;
		const high = spec?.max ?? Number.MAX_SAFE_INTEGER;
		return Math.min(high, Math.max(low, value));
	};
	const flag = (key) => merged[key] !== false;
	const text = (key) => typeof merged[key] === "string" ? merged[key].trim() : DEFAULT_SETTINGS[key];

	for (const key of Object.keys(DEFAULT_SETTINGS)) {
		const type = specOf.get(key)?.type;
		if (type === "boolean") merged[key] = flag(key);
		else if (type === "text") merged[key] = text(key);
		else merged[key] = clampNumber(key);
	}

	// D3：transitionTextMode 枚举白名单。非法值回退默认 separateThreshold，
	// 拒绝半生效状态（开关按字面理解，但行为不可预期）。
	if (!TRANSITION_TEXT_MODES.has(merged.transitionTextMode)) {
		merged.transitionTextMode = DEFAULT_SETTINGS.transitionTextMode;
	}

	// One-time migration for settings persisted before the timeout was raised.
	// A stored value equal to the old default means the user never touched the
	// field, so it is safe to lift it to the new default; any other value is an
	// explicit choice and is left alone.


	settings = merged;
	MIN_REASONING_CHARS = merged.minReasoningChars;
	MAX_POINTS = merged.maxPoints;
	MAX_POINT_CHARS = merged.maxPointChars;
	SOFT_CUT_SCAN_TAIL = merged.softCutScanTail;
	SOFT_CUT_TRANSITION_WINDOW = merged.softCutTransitionWindow;
	SOFT_CUT_MIN_FOLLOW_CHARS = merged.softCutMinFollowChars;
	SOFT_CUT_GAP_THRESHOLD = merged.softCutGapThreshold;
	OVER_LONG_COT_THRESHOLD = merged.overLongCoTThreshold;
	REPEAT_PROBE_CHARS = merged.repeatProbeChars;
	REPEAT_WINDOW_CHARS = merged.repeatWindowChars;
	REPEAT_MIN_PERIOD = merged.repeatMinPeriod;
	REPEAT_SHORT_PERIOD = merged.repeatShortPeriod;
	REPEAT_MAX_PERIOD = merged.repeatMaxPeriod;
	REPEAT_MIN_COUNT = merged.repeatMinCount;
	REPEAT_MIN_COUNT_SHORT = merged.repeatMinCountShort;
	REPEAT_ULTRA_SHORT_MIN_COUNT = merged.repeatUltraShortMinCount;
	REPEAT_MIN_TEXT_CHARS = merged.repeatMinTextChars;
	// NGram 语义指纹（修复②）三参数发布（此前为 const 硬编码，设置不可调）
	NGram_PHRASE_MIN = merged.ngramPhraseMin;
	NGram_MIN_COUNT = merged.ngramMinCount;
	NGram_COVERAGE_RATIO = merged.ngramCoverageRatio;
	CHURN_WINDOW_CHARS = merged.churnWindowChars;
	CHURN_MIN_HITS = merged.churnMinHits;
	CHURN_MIN_TEXT_CHARS = merged.churnMinTextChars;
	PSEUDO_TOOL_SCAN_TAIL = merged.pseudoToolScanTail;
	// D7：numberRun* 五键发布（此前只存 settings、检测函数读不到）
	NUMBER_RUN_MIN_TEXT_CHARS = merged.numberRunMinTextChars;
	NUMBER_RUN_MIN_CHARS = merged.numberRunMinChars;
	NUMBER_RUN_MAX_GAP = merged.numberRunMaxGap;
	NUMBER_RUN_MIN_DIGIT_RATIO = merged.numberRunMinDigitRatio;
	NUMBER_RUN_MIN_INCREASE_RATIO = merged.numberRunMinIncreaseRatio;
	// D3：transitionTextMode 发布（内核未就位前仅登记）
	TRANSITION_TEXT_MODE = merged.transitionTextMode;
	return settings;
}

/** D3：transitionTextMode 合法枚举；白名单外的值一律回退默认 separateThreshold。 */
const TRANSITION_TEXT_MODES = new Set(["disable", "separateThreshold"]);



// --- 外部插件软切请求：挂起表 + 钩子现场消费 -----------------------------
// 背景：agent/soft-cut 是内核在模型流式生成期间周期性回调的钩子，只有在钩子
// 现场返回 { kind: "cut" } 的决策才会被内核采纳。外部插件（如
// dsh-derive-watcher 检测到二级语义停滞）直接调用本模块函数时并不处在钩子
// 现场，即便当场给出 cut 决策内核也看不到。因此采用「挂起请求 + 钩子现场
// 消费」模式（参照 dsh-step-governor 的 pendingReject：rejectStep 只置
// pending 标记，在下一个钩子边界消费）。
//
// soft-cut 钩子没有 step 计数可供判废，挂起请求改用时间 TTL：30 秒足以覆盖
// 一次生成的探测窗口，过期请求作废，避免陈旧请求切断很久之后的无关生成。
const EXTERNAL_SOFT_CUT_TTL_MS = 30000;
/** 外部锚点附带的最近可见文本最大字符数（按字符截取尾部）。 */
const EXTERNAL_ANCHOR_MAX_CHARS = 2000;
/** 有最近可见文本时的固定中文引导语；锚点正文紧随其后。 */
const EXTERNAL_ANCHOR_PREFIX =
	"外部停滞检测请求在此软切：停止当前重复路径，基于以下最近可见文本重新组织下一步：\n\n";
/** 调用方未提供可用文本时的固定中文兜底锚点（不捏造任何任务事实）。 */
const EXTERNAL_ANCHOR_FALLBACK =
	"检测到语义停滞的外部软切请求，要求立即停止当前重复论述，用新的一步推进任务。";
/**
 * 外部软切挂起表：键为 sessionId，值为待消费的软切请求。
 * 同一 sessionId 的新请求覆盖旧请求；消费一次性完成。
 * @type {Map<string, {anchorText:string, reason:string|null, requestedAt:number, ttlMs:number, evidenceSeq:number|null, turn:number|null, step:number|null}>}
 */
const externalSoftCutPending = new Map();
/**
 * 内核 soft-cut 钩子能力探测结果缓存：apply 时探测一次后回填，
 * requestExternalSoftCut 与钩子注册共用同一结论，避免重复读内核源码。
 * apply 未执行（如纯模块测试）时保持 unknown，按规格 unknown 与 present 同等受理。
 * @type {"present"|"absent"|"unknown"}
 */
let kernelSoftCutProbe = CAPABILITY_UNKNOWN;

/**
 * 受理外部插件的软切请求：只做校验并挂起，真正的 cut 决策在下一个
 * agent/soft-cut 钩子现场由 consumeExternalSoftCut 消费后给出。
 *
 * @param {object} payload - 外部请求载荷。
 * @param {string} payload.sessionId - 目标会话 ID，必填非空字符串。
 * @param {number} [payload.turn] - 触发请求时的轮次（仅随事件上报）。
 * @param {number} [payload.step] - 触发请求时的步骤（仅随事件上报）。
 * @param {string} [payload.fullVisibleText] - 最近可见文本，用于生成锚点。
 * @param {string} [payload.reason] - 外部停滞原因码。
 * @param {number} [payload.evidenceSeq] - 外部证据序号。
 * @param {number} [payload.ttlMs] - 自定义挂起有效期（毫秒）。
 * @returns {{accepted:false, reason:string}|{accepted:true, delivery:"pending-next-soft-cut", ttlMs:number, requestedAt:number}}
 */
function requestExternalSoftCut(payload) {
	const sessionId = payload?.sessionId;
	if (typeof sessionId !== "string" || sessionId.length === 0) {
		return { accepted: false, reason: "invalid-session-id" };
	}
	// 能力门：内核缺失 soft-cut 钩子时受理也永远无法兑现，直接拒绝。
	// 复用 apply 时探测并缓存的 kernelSoftCutProbe，与钩子注册判断同源；
	// unknown 与 present 同等受理（无法确定时不阻断外部干预）。
	if (kernelSoftCutProbe === CAPABILITY_ABSENT) {
		return { accepted: false, reason: "soft-cut-capability-absent" };
	}
	// 设置门：外部干预属跨插件动作，按开关放行；发布默认 true（开箱即用）。
	if (settings.enableExternalSoftCut !== true) {
		return { accepted: false, reason: "disabled" };
	}
	const ttlMs = Number.isFinite(payload?.ttlMs) && payload.ttlMs > 0
		? payload.ttlMs
		: EXTERNAL_SOFT_CUT_TTL_MS;
	// 锚点文本：优先取调用方提供的最近可见文本尾部，否则使用固定兜底锚点。
	// 只做截取与包裹，绝不根据文本捏造任务事实。
	const rawText = typeof payload?.fullVisibleText === "string" ? payload.fullVisibleText : "";
	const anchorText = rawText.trim().length > 0
		? EXTERNAL_ANCHOR_PREFIX + (
			rawText.length > EXTERNAL_ANCHOR_MAX_CHARS
				? rawText.slice(rawText.length - EXTERNAL_ANCHOR_MAX_CHARS)
				: rawText
		)
		: EXTERNAL_ANCHOR_FALLBACK;
	const requestedAt = Date.now();
	externalSoftCutPending.set(sessionId, {
		anchorText,
		reason: typeof payload?.reason === "string" && payload.reason.length > 0 ? payload.reason : null,
		requestedAt,
		ttlMs,
		evidenceSeq: Number.isFinite(payload?.evidenceSeq) ? payload.evidenceSeq : null,
		turn: Number.isFinite(payload?.turn) ? payload.turn : null,
		step: Number.isFinite(payload?.step) ? payload.step : null
	});
	return { accepted: true, delivery: "pending-next-soft-cut", ttlMs, requestedAt };
}

/**
 * 在 agent/soft-cut 钩子现场消费一个挂起的外部软切请求（一次性）。
 *
 * @param {string} sessionId - 目标会话 ID。
 * @param {number} [now] - 当前时间戳（毫秒），默认 Date.now()。
 * @returns {object|null} 命中且未过期时返回挂起记录；否则返回 null。
 */
function consumeExternalSoftCut(sessionId, now = Date.now()) {
	const pending = externalSoftCutPending.get(sessionId);
	if (!pending) return null;
	if (now - pending.requestedAt > pending.ttlMs) {
		// 已过 TTL：作废并清理。
		externalSoftCutPending.delete(sessionId);
		return null;
	}
	// 一次性消费：无论返回后内核是否采纳，都不重复切断后续生成。
	externalSoftCutPending.delete(sessionId);
	return pending;
}


/**
 * Hash a reasoning block to a stable cache key.
 * @param {string} text
 * @returns {string}
 */
function reasoningKey(text) {
	let hash = 5381;
	for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
	return `${text.length}:${hash.toString(16)}`;
}

/**
 * P0-7: reasoning-effort levels treated as "high" for anchor injection gating.
 */
const HIGH_REASONING_EFFORT_LEVELS = new Set(["high", "xhigh"]);

/**
 * P0-7: read the session's effective reasoning effort from the ONLY proven
 * path — `session.requestHeader().config.reasoningEffort` (persisted request
 * header, see dsh-agent-loop `prepareRequest`).  Returns "" when unset, which
 * means "follow adapter defaultEffort" — the plugin cannot observe that value,
 * so an unset effort is NOT treated as high (never guessed from unproven
 * fields like session.settings.reasoningEffort).
 * @param {object|null|undefined} session
 * @returns {string} effort level or "".
 */
function readReasoningEffort(session) {
	try {
		const header = typeof session?.requestHeader === "function" ? session.requestHeader() : null;
		const value = header?.config?.reasoningEffort;
		return typeof value === "string" ? value : "";
	} catch {
		return "";
	}
}

/**
 * P1-10: normalized content hash of one rendered anchor point.
 *
 * Replaces the old 120-character `reasoningFingerprint` prefix.  A prefix
 * fingerprint is unstable under reasoning-head growth: each growing snapshot
 * (same settled conclusions + a longer prefix) produced a NEW fingerprint and
 * re-injected the same anchor.  Hashing the FULL rendered point after
 * whitespace normalization makes growth-insensitive dedup possible: two
 * snapshots that render the same point text hash identically regardless of
 * how much reasoning preceded the conclusion.
 * @param {string} text - one rendered point (or the rendered recovery context).
 * @returns {string} stable hash, or "" for empty/non-string input.
 */
function anchorContentHash(text) {
	if (typeof text !== "string" || text.length === 0) return "";
	return reasoningKey(text.trim().replace(/\s+/g, " "));
}

/**
 * P1-10: per-session SET of anchor-content hashes already injected.
 *
 * Replaces the old single-value `injectedReasoningBySession` LRU32 map.  A
 * single-value map only suppressed an exact re-hit of the CURRENT fingerprint;
 * it forgot everything else, so interleaved reasoning phases (A→B→A) re-injected
 * A.  A set of the last N content hashes per session keeps the reminder
 * mechanism working for new phases while collapsing any phase already injected
 * in the recent window.  Both the pre-step and post-execute entry points share
 * the SAME set, so a snapshot seen by whichever path fires first is anchored
 * exactly once for that step.
 */
const injectedAnchorHashesBySession = new Map();
/** Upper bound on hashes retained per session (LRU-ish: drops oldest insertion). */
const INJECTED_ANCHOR_HASH_LIMIT = 32;
/** Upper bound on sessions tracked (LRU-ish: drops oldest session entry). */
const INJECTED_ANCHOR_SESSION_LIMIT = 256;

/**
 * Check whether `hash` was already injected for `sessionId`.
 * @param {string} sessionId
 * @param {string} hash - `anchorContentHash` value of the rendered body (or a
 *     synthetic key for the INVALID_ARGS branch, see P1-11).
 * @returns {boolean} true if this hash was already present (dedup should skip).
 */
function alreadyInjectedAnchor(sessionId, hash) {
	if (hash === "") return false;
	let hashes = injectedAnchorHashesBySession.get(sessionId);
	if (!hashes) {
		hashes = new Set();
		injectedAnchorHashesBySession.set(sessionId, hashes);
	}
	return hashes.has(hash);
}

/**
 * Remember that `hash` was injected for `sessionId`, evicting the oldest
 * session entry when the outer map exceeds its bound (LRU-ish, same shape as
 * the old fingerprint map) and the oldest hash when the per-session set
 * exceeds its own bound.
 * @param {string} sessionId
 * @param {string} hash
 */
function rememberInjectedAnchor(sessionId, hash) {
	if (hash === "") return;
	let hashes = injectedAnchorHashesBySession.get(sessionId);
	if (hashes) {
		// refresh recency
		injectedAnchorHashesBySession.delete(sessionId);
	} else {
		hashes = new Set();
	}
	hashes.add(hash);
	if (hashes.size > INJECTED_ANCHOR_HASH_LIMIT) {
		const oldestHash = hashes.values().next().value;
		if (oldestHash !== undefined) hashes.delete(oldestHash);
	}
	injectedAnchorHashesBySession.set(sessionId, hashes);
	if (injectedAnchorHashesBySession.size > INJECTED_ANCHOR_SESSION_LIMIT) {
		const oldestSession = injectedAnchorHashesBySession.keys().next().value;
		if (oldestSession !== undefined) injectedAnchorHashesBySession.delete(oldestSession);
	}
}

/**
 * P1-5 (2026-10-22): per-session list of injected anchor POINT TEXTS,
 * whitespace-normalized.  Purpose differs from the hash set above: the hash
 * set dedupes the DECISION (skip an already-injected anchor), this list feeds
 * `stripInjectedAnchors` which removes echoed anchor text from the detection
 * copy before the transition detector runs.  Models echo a freshly injected
 * anchor back into their next reasoning stretch; without stripping, the
 * extractor re-harvests the echoed conclusions and re-injects the same anchor
 * in a self-feedback loop (observed repeatedly in production sessions).
 */
const injectedAnchorPointsBySession = new Map();
/** Upper bound on point texts retained per session (LRU-ish, newest last). */
const INJECTED_ANCHOR_POINTS_LIMIT = 32;
/**
 * Shorter texts are not worth stripping: a <10-char fragment ("所以对。") is
 * too generic to identify an echo and stripping it could erase legitimate
 * reasoning around generic openers.
 */
const INJECTED_ANCHOR_STRIP_MIN_CHARS = 10;

/**
 * Record injected anchor point texts for `sessionId` (normalized), refreshing
 * recency and evicting the oldest entries past the per-session limit.
 * @param {string} sessionId
 * @param {string[]} points - raw extracted point texts that were injected.
 */
function rememberInjectedPoints(sessionId, points) {
	const normalized = (Array.isArray(points) ? points : [])
		.map((pointText) => (typeof pointText === "string" ? pointText.trim().replace(/\s+/g, " ") : ""))
		.filter((pointText) => pointText.length >= INJECTED_ANCHOR_STRIP_MIN_CHARS);
	if (normalized.length === 0) return;
	let list = injectedAnchorPointsBySession.get(sessionId);
	if (list) {
		injectedAnchorPointsBySession.delete(sessionId);
	} else {
		list = [];
	}
	for (const pointText of normalized) {
		const existingIndex = list.indexOf(pointText);
		if (existingIndex >= 0) list.splice(existingIndex, 1);
		list.push(pointText);
	}
	while (list.length > INJECTED_ANCHOR_POINTS_LIMIT) list.shift();
	injectedAnchorPointsBySession.set(sessionId, list);
	if (injectedAnchorPointsBySession.size > INJECTED_ANCHOR_SESSION_LIMIT) {
		const oldestSession = injectedAnchorPointsBySession.keys().next().value;
		if (oldestSession !== undefined) injectedAnchorPointsBySession.delete(oldestSession);
	}
}

/**
 * Return a copy of `text` with every previously-injected anchor point text
 * (for `sessionId`) replaced by a single space.  Verbatim-echo removal only:
 * paraphrased echoes are not detected (acceptable — the observed failure mode
 * is verbatim re-harvesting).  Read-only on the stored list; returns `text`
 * itself when there is nothing to strip.
 * @param {string} text - raw detection text.
 * @param {string} sessionId
 * @returns {string} stripped copy (or the original when nothing matches).
 */
function stripInjectedAnchors(text, sessionId) {
	if (typeof text !== "string" || text.length === 0) return text;
	const list = injectedAnchorPointsBySession.get(sessionId);
	if (!list || list.length === 0) return text;
	let stripped = text;
	for (const pointText of list) {
		if (!stripped.includes(pointText)) continue;
		stripped = stripped.split(pointText).join(" ");
	}
	return stripped;
}

/**
 * Parse a model-written conclusion list into trimmed, capped points.  Accepts
 * plain lines and bullet/numbered prefixes; anything empty is dropped.
 * @param {string} text - raw model output.
 * @param {number} maxPoints
 * @param {number} maxPointChars
 * @returns {string[]}
 */


// ═══════════════════════ §4 统一装配 ═══════════════════════

function apply(ctx, config) {

	// --- 内核能力探测（先做，结果既进日志也进设置接口）----------------------
	// 探测"生成中途截停"所依赖的宿主钩子是否仍然存在。缺失时**不静默**：
	// 启动日志明确告警，设置接口把结果下发给设置页，由界面明示展示。
	const softCutProbe = probeKernelHook(SOFT_CUT_HOOK);
	// 回填模块级缓存，供 requestExternalSoftCut 能力门复用同一探测结论。
	kernelSoftCutProbe = softCutProbe;
	const streamProbe = probeKernelHook(ASSISTANT_STREAM_HOOK);
	// D9：pre-step 能力探测只用于上报（设置页如实展示）；注入本身无条件注册，
	// await next() 直通的设计对不提供该钩子的内核零副作用，不伪造生效。
	const preStepProbe = probeKernelHook(PRE_STEP_HOOK);
	if (softCutProbe === CAPABILITY_ABSENT) {
		console.warn(
			"[dsh-stall-governor] 当前内核没有掐断能力：宿主钩子 " + SOFT_CUT_HOOK +
			" 不存在（上游自 0.1.5-rc.3 起移除）。" +
			"插件的「生成中途截停」（伪工具调用 / 重复循环 / 语义空转 / 转折句 / 数字流退化）本次全部不会生效；" +
			"工具参数校验失败时的恢复指引注入不受影响。"
		);
	} else if (softCutProbe === CAPABILITY_UNKNOWN) {
		console.warn(
			"[dsh-stall-governor] 无法确认内核是否提供掐断能力（未能读取 dsh-agent-loop 源码）。" +
			"若宿主钩子 " + SOFT_CUT_HOOK + " 已被移除，" +
			"插件的「生成中途截停」会静默失效；请以设置页的能力行显示为准。"
		);
	}

	// 每次装配先从 env 重置启动初值（防重复装配污染；off 仍完全不装配）。
	resetConfigFromEnv();
	const states = new Map();
	function stateFor(session) {
		return stateForId(session?.id || "_");
	}
	function stateForId(id) {
		let s = states.get(id);
		if (!s) {
			if (states.size >= CONFIG.maxSessions) evictLeastActive();
			s = createSessionState();
			states.set(id, s);
		}
		touchActivity(s);
		return s;
	}
	// P2-24：LRU 按"最近活跃"而非"创建顺序"淘汰；活跃即会话收到过事件。
	function touchActivity(s) {
		s.lastActiveAt = Date.now();
	}
	function evictLeastActive() {
		let victim = null;
		for (const [id, s] of states) {
			if (!victim || s.lastActiveAt < victim.s.lastActiveAt) victim = { id, s };
		}
		if (victim) states.delete(victim.id);
	}
	function log(payload) {
		logStatic({ mode: CONFIG.mode, ...payload });
	}
	function emit(name, payload) {
		try { ctx.emit?.(name, payload); } catch (e) { log({ at: "emit-error", event: name, error: String(e?.message || e) }); }
	}

	// ── ctx.provide：计划书 §2.2 两服务（watcher 经 ctx.get("stallGovernor")）─
	const services = {
		/**
		 * stall-2：按类别禁用工具（计划书 §2.2(1)）。
		 * @param {string} sessionId 会话 id
		 * @param {string} category 首期枚举 read|grep
		 * @param {{reason?:string, code?:string, evidenceSeq:number, ttlSteps:number}} opts
		 * @returns {{accepted:boolean, expiresAtStep?:number, reason?:string}}
		 */
		denyToolCategory(sessionId, category, opts) {
			try {
				const o = opts && typeof opts === "object" ? opts : {};
				const code = typeof o.code === "string" && o.code ? o.code : BLOCK_CODES.STALL_2;
				if (code !== BLOCK_CODES.STALL_2) {
					return { accepted: false, reason: `code 必须为 ${BLOCK_CODES.STALL_2}（冻结枚举），收到 ${code}` };
				}
				if (FORBIDDEN_RETRY_CODES.has(code)) return { accepted: false, reason: "阻断码禁止使用可重试码" };
				if (typeof sessionId !== "string" || !sessionId) return { accepted: false, reason: "sessionId 缺失" };
				if (!DENY_CATEGORIES.has(category)) return { accepted: false, reason: `未知类别 ${String(category)}，首期枚举 read|grep` };
				const evidenceSeq = Number(o.evidenceSeq);
				const ttlSteps = Number(o.ttlSteps);
				if (!Number.isSafeInteger(evidenceSeq) || evidenceSeq < 0) return { accepted: false, reason: "evidenceSeq 必须为非负整数" };
				if (!Number.isSafeInteger(ttlSteps) || ttlSteps < 1) return { accepted: false, reason: "ttlSteps 必须为正整数（会话内 step seq 增量）" };
				const state = stateForId(sessionId);
				// 幂等键 (sessionId, evidenceSeq, code)：重复调用不刷新 ttl、不重复 deny/发事件。
				const existing = state.categoryDenials.find((d) => d.evidenceSeq === evidenceSeq);
				if (existing) {
					if (!existing.categories.has(category)) existing.categories.add(category);
					return { accepted: true, expiresAtStep: existing.expiresAtStep };
				}
				// 解除谓词：currentStepSeq > evidenceSeq + ttlSteps（严格大于）。
				const expiresAtStep = evidenceSeq + ttlSteps;
				state.categoryDenials.push({ evidenceSeq, ttlSteps, expiresAtStep, category, categories: new Set([category]), reason: String(o.reason ?? "") });
				emit("governor/category-denied", {
					sessionId, code: BLOCK_CODES.STALL_2, category,
					evidenceSeq, ttlSteps, expiresAtStep
				});
				log({ at: "category-denied", sessionId, category, evidenceSeq, expiresAtStep });
				return { accepted: true, expiresAtStep };
			} catch (e) {
				log({ at: "denyToolCategory-error", failOpen: true, error: String(e?.message || e) });
				return { accepted: false, reason: String(e?.message || e) };
			}
		},
		/**
		 * stall-3：语义终判 reject（计划书 §2.2(2)）。pending 项在本 turn 下一个
		 * pre-step 边界消费；turn 结束（含 blocked/aborted）或真人消息清除。
		 * @param {string} sessionId
		 * @param {{reason?:string, code?:string, evidenceSeq:number}} opts
		 * @returns {{accepted:boolean, pending:boolean, reason?:string}}
		 */
		rejectStep(sessionId, opts) {
			try {
				const o = opts && typeof opts === "object" ? opts : {};
				const code = typeof o.code === "string" && o.code ? o.code : BLOCK_CODES.STALL_3;
				if (code !== BLOCK_CODES.STALL_3) {
					return { accepted: false, pending: false, reason: `code 必须为 ${BLOCK_CODES.STALL_3}（冻结枚举、不可重试），收到 ${code}` };
				}
				if (typeof sessionId !== "string" || !sessionId) return { accepted: false, pending: false, reason: "sessionId 缺失" };
				const evidenceSeq = Number(o.evidenceSeq);
				if (!Number.isSafeInteger(evidenceSeq) || evidenceSeq < 0) return { accepted: false, pending: false, reason: "evidenceSeq 必须为非负整数" };
				const state = stateForId(sessionId);
				// 幂等键 (sessionId, evidenceSeq)：重复调用合并为同一 pending 项。
				if (state.pendingReject && state.pendingReject.evidenceSeq === evidenceSeq) {
					return { accepted: true, pending: true };
				}
				state.pendingReject = { evidenceSeq, reason: String(o.reason ?? "语义停滞（L3 终判）"), code, source: "watcher" };
				log({ at: "reject-step-queued", sessionId, evidenceSeq });
				return { accepted: true, pending: true };
			} catch (e) {
				log({ at: "rejectStep-error", failOpen: true, error: String(e?.message || e) });
				return { accepted: false, pending: false, reason: String(e?.message || e) };
			}
		}
	};
	// --- 统一设置加载:env(governor 族)>持久化 stall-governor.json>默认 -----------------
	// 两引擎各自的设置机制保持不变:governor 的 applySettings 只认 14 键并丢弃未知键,
	// anchor 的 applyRuntimeSettings 只认自己的键——同一份合并 JSON 同时喂给两边即完成拆分。
	const declarative = config && typeof config === "object" ? config : {};
	const settingsDir = join(homedir(), ".dsh", "storages");
	const settingsPath = process.env.DSH_STALL_GOVERNOR_SETTINGS_PATH
		|| join(settingsDir, SETTINGS_FILE);
	let persistedOk = true;
	let persisted = null;
	try {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
		persisted = parsed && typeof parsed === "object" ? parsed : null;
		if (!persisted) throw new Error("settings file is not an object");
	} catch (e) {
		persistedOk = false;
		if (e?.code !== "ENOENT") log({ at: "settings-corrupt", fallback: "defaults+env", error: String(e?.message || e) });
	}
	function savePersistedSettings(value) {
		try {
			mkdirSync(settingsDir, { recursive: true });
			writeFileSync(settingsPath, JSON.stringify(value, null, 2), "utf8");
			return true;
		} catch (error) {
			log({ at: "settings-save-error", error: String(error?.message || error) });
			return false;
		}
	}
	// governor:env 重置已完成(resetConfigFromEnv),持久化覆盖(env 拥有的键被跳过)。
	applySettings(declarative);
	if (persisted) applySettings(persisted);
	// anchor:声明式 config 播种,持久化覆盖(优先级 env 无、json>config,与上游一致)。
	applyRuntimeSettings(persisted ? { ...declarative, ...persisted } : declarative);

	// 「跨步骤」引擎的总闸:mode=off 时不装配任何 governor 钩子(上游语义);
	// 「单流内」引擎有独立开关(enableSoftCut 等),不受 mode 影响。
	const governorEnabled = CONFIG.mode !== "off";

	// --- 对外服务:stallGovernor = governor 两服务 + 外部软切请求入口 ---------
	if (typeof ctx.provide === "function") {
		ctx.provide("stallGovernor", {
			...services,
			requestSoftCut: (payload) => requestExternalSoftCut(payload)
		});
	}


	if (governorEnabled) {
	// ── 事件观测 ───────────────────────────────────────────────────────────
	ctx.on("session/event", (session, event) => {
		try {
			const state = stateFor(session);
			noteEvent(state, event);
		} catch (e) { log({ at: "session/event", error: String(e?.message || e) }); }
	});

	// ── tools/pre-execute：G2 支线熔断 + stall-2 类别 deny ─────────────────
	ctx.on("tools/pre-execute", async (exec, next) => {
		try {
			const state = stateFor(exec.agent?.session);
			
			// (1) semantic-stall-2 类别 deny（L3 显式服务；先于机械 G2）。
			const category = toolCategory(exec.name);
			if (category) {
				let deny2 = null;
				for (const d of state.categoryDenials) {
					if (state.globalStepSeq > d.expiresAtStep) continue; // 严格大于解除
					if (!d.categories.has(category)) continue;
					deny2 = deny2 && deny2.expiresAtStep >= d.expiresAtStep ? deny2 : d;
				}
				if (deny2) {
					log({ at: "pre-execute", action: "deny", code: BLOCK_CODES.STALL_2, category, evidenceSeq: deny2.evidenceSeq, expiresAtStep: deny2.expiresAtStep, stepSeq: state.globalStepSeq });
					return {
						kind: "deny",
						reason: `[${PLUGIN_ID}] semantic-stall-2: 类别 ${category} 已被语义监视者临时禁用至 step ${deny2.expiresAtStep}（当前 ${state.globalStepSeq}），目标类别: ${category}。请改用其他取证类别或直接推进任务完成交付；如需继续调用 ${category}，先向用户说明现状并取得确认`,
						code: BLOCK_CODES.STALL_2,
						evidenceSeq: deny2.evidenceSeq,
						info: { plugin: PLUGIN_ID, rule: "stall-2", category, code: BLOCK_CODES.STALL_2, evidenceSeq: deny2.evidenceSeq }
					};
				}
			}
			// (2) 机械 G2 判定。
			const key = targetKey(exec.name, exec.arguments);
			const verdict = evaluateG2(state, key);
			// P1-20：终态提交工具命中时只落观测日志，不 deny（理由见 WORKFLOW_TERMINAL_TOOL）。
			// 无任何失败/调用历史时不落日志，避免每轮正常提交刷屏。
			if (verdict.detail.terminalToolExempt && verdict.detail.hadFailure) {
				log({ at: "pre-execute", action: "exempt", rule: "G2", ...verdict.detail });
			}
			if (verdict.hit) {
				log({ at: "pre-execute", action: enforces(verdict.rule) ? "deny" : "shadow", rule: verdict.rule, ...verdict.detail });
				if (enforces(verdict.rule)) {
					const code = verdict.rule === "G2-B" ? BLOCK_CODES.G2_B : BLOCK_CODES.G2_A;
					// P1-16：deny 文案三要素 = 归一化目标键 + 计数口径 + 合法继续出口。
					const scope = verdict.rule === "G2-B" ? "该目标已连续失败" : "该目标近窗已尝试";
					const targetShown = key.length > 120 ? key.slice(0, 120) + "…" : key;
					return {
						kind: "deny",
						reason: `[${PLUGIN_ID}] ${verdict.rule}: ${scope} ${verdict.rule === "G2-B"
							? `${verdict.detail.consecutiveFail} 次（阈值 ${CONFIG.g2bConsecutiveFailures}）`
							: `${verdict.detail.calls} 次（阈值 ${CONFIG.g2aSameTargetCalls}，每次确认为放行才计数）`}；目标键: ${targetShown}。请更换命令/参数、改用其他工具或类别，或向用户汇报当前进展后由用户决定下一步`,
						code,
						evidenceSeq: state.globalStepSeq,
						// P1-19：info 按分支构造，禁止跨分支取 detail 缺失键——
						// G2-A detail 无 consecutiveFail、G2-B detail 无 calls，
						// 混取会产生 undefined 字段，下游 dsh-tools 的
						// p4-deny-plugin-info 原样展开进 error.info 后，
						// 内核 materializeFinalResult 对 undefined 判非
						// losslessly JSON-serializable，deny 文案被序列化
						// TypeError 吞掉（表现为工具报 JSON 错而非熔断提示）。
						info: verdict.rule === "G2-B"
							? { plugin: PLUGIN_ID, rule: verdict.rule, code, evidenceSeq: state.globalStepSeq, key, consecutiveFail: verdict.detail.consecutiveFail }
							: { plugin: PLUGIN_ID, rule: verdict.rule, code, evidenceSeq: state.globalStepSeq, key, calls: verdict.detail.calls }
					};
				}
			}
			const decision = await next();
			// 真实放行（含 shadow）才计一次调用；deny 不计。consecutiveFail 由
			// tool/result 事件按结果维护（自阻断结果已排除，见 noteEvent）。
			if (!decision || decision.kind !== "deny") {
				const rec = state.toolTargets.get(key) || { calls: 0, consecutiveFail: 0, recentCalls: [] };
				rec.recentCalls.push(state.globalStepSeq); // G2-A 滑窗在 pre 放行时记录同键调用时刻
				rec.calls = rec.recentCalls.length;
				state.toolTargets.set(key, rec);
			}
			return decision;
		} catch (e) {
			log({ at: "pre-execute", failOpen: true, error: String(e?.message || e) });
			return next();
		}
	});

	// ── agent/pre-step：G1 步级熔断 + stall-3 pending 消费 ─────────────────
	ctx.on("agent/pre-step", async (payload, next) => {
		try {
			const state = stateFor(payload.agent?.session);
			// pre-step(S) 边界：第 S-1 步已完整结束（工具结果已到），先结算再判定；
			// 同时推进会话级 step seq（与 step/start 事件按 (turn,step) 去重）。
			settleLastStep(state, typeof payload.step === "number" ? payload.step : state.stepInTurn + 1);
			advanceStepBoundary(state, payload.turn ?? state.turn, payload.step);
			// (1) semantic-stall pending 消费（L3 显式服务；先于机械 G1）。
			if (state.pendingReject) {
				const p = state.pendingReject;
				state.pendingReject = null;
				emit("governor/step-rejected", {
					sessionId: payload.agent?.session?.id ?? "_",
					code: p.code, evidenceSeq: p.evidenceSeq,
					consumedAtStep: state.globalStepSeq, source: p.source
				});
				log({ at: "pre-step", action: "reject", code: p.code, evidenceSeq: p.evidenceSeq, consumedAtStep: state.globalStepSeq });
				return {
					kind: "reject",
					reason: `[${PLUGIN_ID}] ${p.code}: ${p.reason}（语义终判，不可重试，需人工/语义介入）`,
					code: p.code,
					evidenceSeq: p.evidenceSeq,
					autoResume: { max: 0, switchAction: false } // semantic-stall 不走 G1 续跑
				};
			}
			// (2) 机械 G1 判定（结构化载荷：冻结码 + autoResume 策略，§9.4）。
			const verdict = evaluateG1(state);
			if (verdict.hit) {
				log({ at: "pre-step", action: enforces(verdict.rule) ? "hit" : "shadow", rule: verdict.rule, ...verdict.detail });
				if (enforces(verdict.rule)) {
					// P1-16：reject 文案三要素 = 触发规则与计数口径 + 当前步序 + 合法继续出口。
					const ruleText = verdict.rule === "G1-A"
						? (verdict.detail.kind === "unproductive-read-loop"
						? `连续 ${verdict.detail.consecutiveUnproductive} 步成功调用但无交付（只读空转，阈值 ${CONFIG.g1aUnproductiveSteps}）`
						: `连续 ${verdict.detail.consecutiveZero} 步无交付（阈值 ${CONFIG.g1aZeroSteps}）`)
						: verdict.rule === "G1-B"
							? `同一结论指纹跨 ${verdict.detail.fpSteps} 步重现（阈值 ${CONFIG.g1bFingerprintSteps}）`
							: `单回合步数 ${verdict.detail.nextStep} 达硬顶 ${verdict.detail.max}`;
					// 软停优先（2026-10-17 根治静默中断）：硬 reject 会让内核把 turn 直接
					// 记成 {"kind":"blocked"} 并丢弃本载荷的 reason，前端也不渲染 blocked，
					// 用户看到的就是"话说到一半消失"。改为：同一 turn 首次命中时投递一条
					// 明确收尾指令，让模型自己输出总结后正常结束，turn 以 completed 收尾；
					// 只有模型无视指令、同一 turn 再次命中时才硬拦（并保留可直接观测的 reason）。
					const turnKey = String(payload.turn ?? state.turn);
					if (state.softStopTurn !== turnKey) {
						state.softStopTurn = turnKey;
						const notice = createUserMessage({
							content: [{
								type: "text",
								text: `【${PLUGIN_ID}】${verdict.rule}：${ruleText}（当前第 ${state.globalStepSeq} 步）。`
									+ "已到本回合收尾边界：请立即停止调用工具，用 3–5 句中文总结已完成成果、当前卡点与下一步建议，然后结束回复。"
							}],
							source: SOFT_STOP_SOURCE
						});
						log({ at: "pre-step", action: "soft-stop", rule: verdict.rule, ...verdict.detail });
						emit("governor/step-soft-stopped", {
							sessionId: payload.agent?.session?.id ?? "_",
							rule: verdict.rule,
							code: g1Code(verdict.rule),
							evidenceSeq: state.globalStepSeq
						});
						const decision = await next();
						if (decision?.kind === "reject") return decision;
						// next() 可能因上游监听器漏 return 而解析为 undefined（内核已有同源事故），
						// 软停路径自身兜底为默认 enter 决策，避免把 undefined 继续往下传。
						const base = decision && Array.isArray(decision.messages)
							? decision
							: { kind: "enter", messages: [] };
						return { ...base, messages: [...base.messages, notice] };
					}
					return {
						kind: "reject",
						reason: `[${PLUGIN_ID}] ${verdict.rule}: ${ruleText}（当前第 ${state.globalStepSeq} 步）。已投递收尾指令但仍在继续调用工具，会话在此停止，请人工确认后重新定向`,
						code: g1Code(verdict.rule),
						evidenceSeq: state.globalStepSeq,
						autoResume: { max: CONFIG.g1MaxAutoResume, switchAction: CONFIG.g1AutoResumeSwitchAction }
					};
				}
			}
			return next();
		} catch (e) {
			log({ at: "pre-step", failOpen: true, error: String(e?.message || e) });
			return next();
		}
	});

	// ── soft-cut 预算抑制升级（设计 §10.2 第 4 条）────────────────────────
	// C（内核移植段）对每次被预算抑制的 soft-cut ignore 发
	// agent/soft-cut-suppressed；高置信类（pseudoTool/confirmed-repeat）被抑制
	// 意味着模型重复已远超任何机械阈值——升级为终止 turn：在本 turn 下一个
	// pre-step 边界以 g1b-fingerprint-repeat 码 reject（同一 turn 至多升级一次）。
	ctx.on("agent/soft-cut-suppressed", (payload) => {
		try {
			const cls = String(payload?.cutClass ?? "");
			if (!SOFTCUT_HIGH_CONFIDENCE.has(cls)) return; // 启发式类被预算抑制属设计内
			const session = payload?.session ?? { id: String(payload?.sessionId ?? "_") };
			const state = stateFor(session);
			const turnNow = typeof payload?.turn === "number" ? payload.turn : state.turn;
			if (state.pendingReject || state.lastEscalatedTurn === turnNow) return;
			state.lastEscalatedTurn = turnNow;
			state.pendingReject = {
				evidenceSeq: state.globalStepSeq,
				reason: `soft-cut 高置信切断（${cls}）被预算抑制，重复退化仍在继续`,
				code: BLOCK_CODES.G1_B,
				source: "soft-cut-suppressed"
			};
			log({ at: "softcut-escalate", sessionId: session.id, cutClass: cls, evidenceSeq: state.globalStepSeq, turn: turnNow });
		} catch (e) {
			log({ at: "softcut-suppressed-error", failOpen: true, error: String(e?.message || e) });
		}
	});

	}

	// --- 命令执行纪律：注册进运行时上下文快照（v0.2.1 起替代 post-execute 单独注入）
	// 与 dsh-naonao 同一模式：ctx.inject(['systemPrompt']) 拿到 scope，用
	// scope.effect 注册一个动态 context 段；内核装配快照时按 order 升序拼接各段。
	// order=20000：位于 auto-memory 记忆规则段（10000/10001）之后、
	// dsh-naonao 用户唠叨段（100000）之前。文本是模块级常量，每轮恒定出现一次，
	// 不再随工具调用堆叠 user 通知，且稳定前缀利于 KV 缓存。
	if (typeof ctx.inject === "function") ctx.inject(["systemPrompt"], (scope) => {
		scope.effect(
			() => scope.systemPrompt.context({
				name: "dsh:cot-anchor-exec-discipline",
				order: EXEC_DISCIPLINE_CONTEXT_ORDER,
				// FIX-09 开关（enableExecDisciplineBlock，默认开）从 post-execute 注入
				// 迁移到这里：关掉则该段文本返回空串，内核装配快照时遇到空文本即省略
				// 该段（这段时间体失效）；开启则全文出现。开态文本始终是同一常量，
				// 稳定前缀仍利于 KV 缓存。
				text: () => settings.enableExecDisciplineBlock ? EXEC_DISCIPLINE_TEXT : ""
			}),
			"cot-anchor exec-discipline runtime context"
		);
	});
	// `session/event` is an emit: the observer is fire-and-forget and its
	// failure is contained by the host, so it can never break the append it is
	// watching.  harvest 观测已砍(#96 §6-3),现役职责仅剩 churn/over-long 计数的 turn 边界归零。
	ctx.on("session/event", (session, event) => {
		// churn / over-long 计数的 turn 边界（唯一可用边界，插件无 turn 生命周期
		// 事件）：assistant/message 携带 data.turn，大于该 session 上次记录值即
		// 视为进入新 turn，两个计数各自归零。置于 harvest 开关之前——计数归零与
		// 采集开关无关。软切结算消息同带本 turn 号，但决策时已就地推进
		// lastTurn，结算号不大于 lastTurn，不会误归零。
		if (event?.type === "assistant/message") {
			const boundaryTurn = event?.data?.turn;
			if (Number.isFinite(boundaryTurn)) {
				const boundaryKey = typeof session?.id === "string" ? session.id : "";
				resetChurnCountOnTurnBoundary(boundaryKey, boundaryTurn);
				resetOverLongCountOnTurnBoundary(boundaryKey, boundaryTurn);
			}
		}
	});

	// --- 设置路由:两引擎 schema 合并,单一 GET/POST --------------------------
	// `webServer` 由模块级 inject 声明保证就绪;guard 只覆盖未组合该服务的宿主。
	const webServer = ctx.webServer;
	if (webServer && typeof webServer.register === "function") {
		webServer.register({
			kind: "exact",
			path: SETTINGS_ROUTE,
			async handler(req, res) {
				try {
					if (req.method === "GET") {
						sendJson(res, 200, {
							ok: true,
							schema: [...GOVERNOR_SETTINGS_SCHEMA, ...SETTINGS_SCHEMA],
							settings: { ...settingsSnapshot(), ...settings },
							defaults: { ...GOVERNOR_SETTINGS_DEFAULTS, ...DEFAULT_SETTINGS },
							persisted: persistedOk,
							capabilities: {
								softCut: softCutProbe,
								assistantStream: streamProbe,
								softCutHook: SOFT_CUT_HOOK,
								preStep: preStepProbe,
								preStepHook: PRE_STEP_HOOK,
								// 内核 text/reasoning 分流由内核侧提供;未就位前如实上报 false。
								transitionTextKernelSupport: false
							}
						});
						return;
					}
					if (req.method === "POST") {
						const body = await readRequestBody(req);
						const patch = body && typeof body.settings === "object" ? body.settings : body;
						// 每个引擎只取自己的键,互不污染;两份快照合并落盘。
						applySettings(patch ?? {});
						const next = applyRuntimeSettings({ ...settings, ...(patch ?? {}) });
						const merged = { ...settingsSnapshot(), ...next };
						const saved = savePersistedSettings(merged);
						sendJson(res, 200, { ok: true, settings: merged, saved });
						return;
					}
					sendJson(res, 405, { ok: false, error: "method not allowed" });
				} catch (error) {
					sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
				}
			}
		});
	} else {
		log({ at: "webserver-missing", route: SETTINGS_ROUTE });
	}

	// Soft-cut: when the model emits a transition sentence ("接下来我要……") right
	// after already reaching conclusions within ONE generation, ask the loop to
	// split here so a fresh anchor reaches the next reasoning phase.
	//
	// 2026-10-05：该钩子自上游 0.1.5-rc.3 起已被移除。缺失时不注册这个永远
	// 不会触发的回调（避免制造"插件在正常工作"的假象），并已在上方给出明确
	// 告警。`CAPABILITY_UNKNOWN` 时照旧注册：探测失败不代表钩子不存在，
	// 宁可留下回调也不要误伤旧内核上的截停能力。
	if (softCutProbe !== CAPABILITY_ABSENT) {
		ctx.on("agent/soft-cut", async (payload, next) => {
		// budgetClass 兼容契约：每个 cut 决策都带 budgetClass，供内核移植段
		// decideSoftCut 分类裁决（confirmed-repeat=20 / heuristic=6 /
		// confirmed-pseudo=3 三类独立有界预算；confirmed-pseudo 耗尽时内核
		// hard-abort）。若插件较旧未返回该字段，内核 decideSoftCut 对缺失
		// 一律按 "heuristic" 处理——缺省不漏判，只是占用启发式桶额度。
		let upstream = null;
		try { upstream = await next(); } catch (e) { log({ at: "soft-cut", failOpen: true, error: String(e?.message || e) }); return null; }
		try {
		if (upstream?.kind === "cut") return upstream;
		// 外部插件挂起的软切请求优先于内部五类检测器消费：这是显式外部干预，
		// 独立于 settings.enableSoftCut 与各检测器开关（即使内部检测全关，
		// 只要 enableExternalSoftCut 开启且存在未过期挂起请求就切）。
		const external = consumeExternalSoftCut(payload?.sessionId);
		if (external) {
			emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
				...evidenceBase(payload?.sessionId, payload?.turn, payload?.step),
				cutClass: "external",
				reason: external.reason ?? null,
				evidenceSeq: external.evidenceSeq ?? null
			});
			return {
				kind: "cut",
				// budgetClass 固定 heuristic：confirmed-pseudo 桶耗尽会触发内核
				// hard-abort，外部请求不得引发硬中止；外部干预只占用启发式额度。
				budgetClass: "heuristic",
				// cutClass 是内核 decideSoftCut 唯一消费的分类字段（softCutBudgetKey：
				// "confirmed-repeat"→confirmedRepeat、"pseudoTool"→pseudoTool、其余→
				// heuristic）。此前只返 budgetClass 导致内核恒按 heuristic 归类，
				// confirmed-repeat 高置信命中也被 6 次/turn 启发式额度耗尽抑制
				// （实测 turn=92 328 次 budget-exhausted）。两字段必须同值。
				cutClass: "heuristic",
				// 不带 trimTo：外部请求不掌握现场全文，保守地只在生成边界切断，
				// 不删除模型已生成的内容。
				contexts: [buildAnchorContext(
					external.anchorText,
					`cot-anchor: external-request${external.reason ? ` (${external.reason})` : ""}`
				)]
			};
		}
		if (!settings.enableSoftCut) return null;
		const fullText = payload?.fullVisibleText;
		if (typeof fullText !== "string") return null;

		// (1) A text-spelled tool call wins over every other trigger: it is the
		//     root cause (the model's call was never executed) and it lets us
		//     explain the format instead of only demanding that it stop.  When
		//     the same attempt is also repeating, the loop's `trimTo` is reused
		//     so the runaway copies never reach the session.
		const looping = settings.enableRepeat ? findRepeatingTail(fullText) : null;
		if (settings.enablePseudoTool && hasPseudoToolCall(fullText)) {
			emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
				...evidenceBase(payload?.sessionId, payload?.turn, payload?.step),
				cutClass: "pseudoTool"
			});
			return {
				kind: "cut",
				budgetClass: "confirmed-pseudo",
				// 内核 softCutBudgetKey 认 "pseudoTool"（不是插件事件里的
				// "confirmed-pseudo"）；pseudoTool 桶（BUDGET_PSEUDO_TOOL=3）耗尽
				// 触发内核 hard-abort，故必须给内核可识别的值。
				cutClass: "pseudoTool",
				...(looping ? { trimTo: looping.trimTo } : {}),
				contexts: [buildAnchorContext(
					renderPseudoToolAnchor(looping !== null, looping),
					`cot-anchor: invalid tool-call format${looping ? ` x${looping.count}` : ""}`
				)]
			};
		}

		// (2) Degenerate loop without an invalid call in it.
		if (looping) {
			emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
				...evidenceBase(payload?.sessionId, payload?.turn, payload?.step),
				cutClass: "confirmed-repeat"
			});
			return {
				kind: "cut",
				budgetClass: "confirmed-repeat",
				cutClass: "confirmed-repeat",
				trimTo: looping.trimTo,
				contexts: [buildAnchorContext(renderRepeatAnchor(looping), `cot-anchor: loop x${looping.count}`)]
			};
		}

		// (2a) 修复②：n-gram 语义指纹循环。与 findRepeatingTail 并行，措辞漂移型
		// 循环（每句数字变、动词结构不变）字节级抓不到，但数字归一 + n-gram 频率
		// 能稳定定位。运行时零 LLM：哈希分窗 + HashMap 计数。
		const ngramLoop = settings.enableRepeat ? detectNGramLoop(fullText) : null;
		if (ngramLoop) {
			emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
				...evidenceBase(payload?.sessionId, payload?.turn, payload?.step),
				cutClass: "heuristic",
				detector: "ngram-loop"
			});
			return {
				kind: "cut",
				budgetClass: "heuristic",
				cutClass: "heuristic",
				contexts: [buildAnchorContext(renderNGramLoopAnchor(ngramLoop),
					`cot-anchor: ngram-loop "${ngramLoop.maxGram}" x${ngramLoop.count}`)]
			};
		}

		// Number runaway: a monotone-increasing run of bare numbers. Distinct
		//     from byte-repetition (findRepeatingTail above) and churn (below);
		//     cut to the run start so the runaway copies never reach the session.
		const numberRunaway = settings.enableNumberRunaway
			? detectNumberRunaway(fullText) : null;
		if (numberRunaway) {
			emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
				...evidenceBase(payload?.sessionId, payload?.turn, payload?.step),
				cutClass: "confirmed-repeat"
			});
			return {
				kind: "cut",
				budgetClass: "confirmed-repeat",
				cutClass: "confirmed-repeat",
				trimTo: numberRunaway.trimTo,
				contexts: [buildAnchorContext(renderNumberRunawayAnchor(numberRunaway), `cot-anchor: number-runaway x${numberRunaway.chars}`)]
			};
		}

		// (3) Churn: no byte-identical cycle, but restart phrases recur at a
		//     pathological rate — the "re-analyze the same thing in new words"
		//     runaway that the period detector structurally cannot see.  Being a
		//     heuristic, it backs off inside an unclosed code fence.
		const churn = !settings.enableChurn || insideUnclosedCodeFence(fullText) ? null : detectChurn(fullText);
		if (churn) {
// 缺陷 3：按 session+turn 计数（recordChurnCut，含就地归零与 LRU 界），
			// 第 2 次起在锚点追加升级指令。计数的是 handler 返回 cut 决策的次数
			// （与内核是否采纳无关）。
			const churnKey = typeof payload?.sessionId === "string" ? payload.sessionId : "";
			const churnOccurrence = recordChurnCut(churnKey, payload?.turn);
			const churnAnchorText = churnOccurrence >= 2
				? renderChurnAnchor(churn) + renderChurnEscalation(churnOccurrence)
				: renderChurnAnchor(churn);
			return {
				kind: "cut",
				budgetClass: "heuristic",
				cutClass: "heuristic",
				contexts: [buildAnchorContext(churnAnchorText, `cot-anchor: churn x${churn.hits}`)]
			};
		}

		// (3a) 修复①：行动提议型空转并行分支。CHURN_ACTION_PHRASES 抓"让我 curl"这类
		// 无实际 tool_call 的动词反复出现。阈值 CHURN_ACTION_MIN_HITS=18，普通技术文本
		// 行动动词命中 0-3/3000 字，泄漏样本 ~75/3000 字，余量充足。
		// 独立于 enableChurn，默认与 enableChurn 同开关语义——通过 enableChurn 统一门禁，
		// 无需新增 settings key；如需独立控制可后续扩展 enableActionChurn。
		const actionChurn = !settings.enableChurn || insideUnclosedCodeFence(fullText) ? null : detectActionChurn(fullText);
		if (actionChurn) {
			const churnKey = typeof payload?.sessionId === "string" ? payload.sessionId : "";
			const churnOccurrence = recordChurnCut(churnKey, payload?.turn);
			const anchorText = renderActionChurnAnchor(actionChurn)
				+ (churnOccurrence >= 2 ? renderChurnEscalation(churnOccurrence) : "");
			emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
				...evidenceBase(payload?.sessionId, payload?.turn, payload?.step),
				cutClass: "heuristic",
				detector: "action-churn"
			});
			return {
				kind: "cut",
				budgetClass: "heuristic",
				cutClass: "heuristic",
				contexts: [buildAnchorContext(anchorText, `cot-anchor: action-churn x${actionChurn.hits}`)]
			};
		}

		// (3b) Over-long CoT reminder: pure length-based, last-resort detector.
		//      No "cut once per turn" gate — but each fire now appends a
		//      per-turn escalation so repeated reminders are not byte-identical
		//      text the model can echo as an "I should act now" opener.
		//      Inside unclosed code fences we skip (same guard as churn).
		//
		// 计数口径：优先用内核传入的 streams.reasoningLength（纯思考字符数），
		// 老内核未传时降级为 fullText.length 估算，锚点文案标注 merged estimate。
		// overLongCoTThreshold 就是唯一生效阈值，两种口径下都不放大。需要只按
		// 纯思考字数计时，把内核切到 separateThreshold
		// （DSH_TRANSITION_TEXT_MODE=separateThreshold，重跑移植脚本并重启）。
		const streams = payload?.streams;
		const hasReasoningCount = streams && typeof streams.reasoningLength === "number";
		const reasoningChars = hasReasoningCount ? streams.reasoningLength : fullText.length;
		if (settings.enableOverLongCoT && OVER_LONG_COT_THRESHOLD > 0
			&& reasoningChars >= OVER_LONG_COT_THRESHOLD
			&& !insideUnclosedCodeFence(fullText)) {
			const overLongKey = typeof payload?.sessionId === "string" ? payload.sessionId : "";
			const occurrence = recordOverLongCut(overLongKey, payload?.turn);
			emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
				...evidenceBase(payload?.sessionId, payload?.turn, payload?.step),
				cutClass: "heuristic",
				detector: "over-long-cot",
				reasoningChars,
				hasStreams: !!hasReasoningCount,
				occurrence
			});
			const anchorText = renderOverLongCoTAnchor(
				reasoningChars, OVER_LONG_COT_THRESHOLD, !!hasReasoningCount, occurrence);
			return {
				kind: "cut",
				budgetClass: "heuristic",
				cutClass: "heuristic",
				contexts: [buildAnchorContext(anchorText,
					`cot-anchor: over-long-cot ${reasoningChars}/${OVER_LONG_COT_THRESHOLD} x${occurrence}${hasReasoningCount ? "" : " [merged estimate]"}`)]
			};
		}

		// (4) A→"接下来我要…"→B transition inside one generation.
		//     The cut is destructive, so it requires an EXPLICIT conclusion
		//     ("所以/因此/综上/therefore …") already present — a density-only
		//     Tier-2 sentence (a file name / number in prose) is not "phase A
		//     settled" and must never trigger a mid-stream cut.
		if (!settings.enableTransition) return null;
		// P1-5 (2026-10-22): strip previously-injected anchor point texts from a
		// DETECTION COPY before the transition chain reads it.  Models echo a
		// freshly injected anchor back into the next reasoning stretch; the
		// extractor then re-harvests the echoed conclusions and re-injects the
		// same anchor — a self-feedback loop (the same freshly-injected anchor
		// was observed being echoed back and re-injected across many turns).
		// Only detection reads the stripped copy; repeat/churn/number-runaway
		// detectors above still see the raw text, and fullText stays original
		// everywhere else.  Text shorter than INJECTED_ANCHOR_STRIP_MIN_CHARS
		// never gets recorded, so the strip list cannot fragment generic prose.
		const sessionKey = typeof payload?.sessionId === "string" ? payload.sessionId : "unknown-session";
		const detectionText = stripInjectedAnchors(fullText, sessionKey);
		if (!wantsSoftCut(detectionText, MIN_REASONING_CHARS)) return null;
		if (!hasExplicitConclusion(detectionText, MIN_REASONING_CHARS)) return null;
		// Gap guard: when the Tier-1 conclusion marker and the transition
		// announcement straddle a whole sub-phase of analysis, the "conclusion"
		// is a mid-phase mini-conclusion ("所以 X 是根因") followed by more
		// reasoning text, not a phase-A → phase-B boundary.  Refuse cut.
		if (!isGapWithinThreshold(detectionText)) return null;
		// D4：本分支判定链已确认「有结论可回流」，events 携带会话四元组。
		const evidence = evidenceBase(sessionKey, payload?.turn, payload?.step);
		const points = extractConclusions(detectionText, MIN_REASONING_CHARS, MAX_POINTS, MAX_POINT_CHARS, { ...evidence, ctx });
		// D4 回流误判：以为有结论、提取却为空 —— 发事件供观测（soft-cut 路径
		// 本就返回 null 不切，此处事件只是把静默放弃显式化）。
		if (points.length === 0) {
			emitCotAnchorEvent(ctx, EVENT_REFLOW_MISJUDGED, { ...evidence, reason: "empty-extraction" });
			return null;
		}
		const body = renderAnchor(points, true);
		if (!body) {
			emitCotAnchorEvent(ctx, EVENT_REFLOW_MISJUDGED, { ...evidence, reason: "anchor-render-empty" });
			return null;
		}
		// D5 长度守恒 / D6 结构配平（括号族 + 代码围栏复用 insideUnclosedCodeFence）：
		// 失败即放弃注入（宁可不回流），绝不带病注入。
		if (settings.enableLengthConservationCheck) {
			const conservation = checkLengthConservation(body, points);
			if (!conservation.ok) {
				emitCotAnchorEvent(ctx, EVENT_LENGTH_CONSERVATION_FAILED, {
					...evidence, expectedChars: conservation.expectedChars, actualChars: conservation.actualChars
				});
				return null;
			}
		}
		const balance = checkStructuralBalance(body);
		if (!balance.ok || insideUnclosedCodeFence(body)) {
			emitCotAnchorEvent(ctx, EVENT_STRUCTURE_UNBALANCED, {
				...evidence, unbalanced: balance.unbalanced, unclosedCodeFence: insideUnclosedCodeFence(body)
			});
			return null;
		}
		// P0-1 (2026-10-22): wire the dormant dedup infrastructure into the only
		// remaining injection path.  An anchor whose rendered body was already
		// injected into this session must NOT be re-injected — re-sending the
		// identical anchor is what trained the model to echo it back (the
		// feedback loop observed in production.  Decision: return null (no cut) on a
		// dedup hit rather than a cut with empty contexts — D4's "宁可不切"
		// principle; an empty-contexts cut against the kernel contract is
		// unverified.  Miss → remember both the body hash (decision dedup) and
		// the raw point texts (echo stripping, P1-5).
		const anchorHash = anchorContentHash(body);
		if (alreadyInjectedAnchor(sessionKey, anchorHash)) {
			emitCotAnchorEvent(ctx, EVENT_ANCHOR_DEDUP_SKIPPED, { ...evidence, anchorHash });
			return null;
		}
		rememberInjectedAnchor(sessionKey, anchorHash);
		rememberInjectedPoints(sessionKey, points);
		emitCotAnchorEvent(ctx, EVENT_SOFTCUT_TAKEN, {
			...evidence,
			cutClass: "heuristic",
			detector: "transition"
		});
		return {
			kind: "cut",
			budgetClass: "heuristic",
			cutClass: "heuristic",
			contexts: [buildAnchorContext(body, `cot-anchor: ${points.length} points (soft-cut)`)]
		};
		} catch (e) {
			log({ at: "soft-cut", failOpen: true, error: String(e?.message || e) });
			return upstream ?? null;
		}
		});
	}
	// tools/post-execute 仅保留工具参数校验失败（ToolArgsError / INVALID_ARGS）的
	// 恢复指引注入；结论锚点的自动注入主路径已移除，其余结果一律原样透传。
	ctx.on("tools/post-execute", async (exec, result, next) => {
		let downstream;
		try { downstream = await next(); } catch (e) { log({ at: "post-execute", failOpen: true, error: String(e?.message || e) }); return downstream; }
		try {

// 缺陷 4（升级版）：工具参数校验失败（ToolArgsError / INVALID_ARGS）续步
		// 兜底。独立错误分支：不依赖结论提取长度门槛与指纹去重——
		// 结论自动注入主路径已移除后，本分支是 post-execute 唯一仍会注入的上下文
		// （模型连参数都发不对时，恢复指引比注入密度更重要）。
		// 判据认 result.error 顶层 name/code（实测宿主 error 仅序列化 {name, code}
		// 两键，错误串只在 result.content 文本里），兼容旧内核挂 error.info 的形态。
		// 参数名从 result.content 文本抽取（missing required property "…"），抽不到
		// 时降级为通用句式，锚点不允许整条缺失。该分支不依赖 reasoning 长度——
		// 短 reasoning（事故步仅 47 字）在旧逻辑下提取为空即静默跳过。
		const errorTop = result?.error;
		const errorInfo = errorTop?.info;
		if (result?.isError === true
			&& (errorTop?.name === "ToolArgsError" || errorTop?.code === "INVALID_ARGS"
				|| errorInfo?.name === "ToolArgsError" || errorInfo?.code === "INVALID_ARGS")) {
			const invalidFields = extractInvalidArgFields(errorTop, result?.content);
			const toolName = typeof exec?.name === "string" ? exec.name : undefined;
			const recoveryContext = buildAnchorContext(
				renderToolArgsErrorAnchor(toolName, invalidFields),
				"cot-anchor: tool-args-error"
			);
			return {
				...downstream,
				additionalContexts: [recoveryContext, ...(downstream.additionalContexts ?? [])]
			};
		}

		// 结论自动注入主路径已移除：post-execute 仅保留上方工具参数错误恢复分支，
		// 其余情形一律原样返回下游结果（next() 只在回调入口调用一次）。
		return downstream;
		} catch (e) {
			log({ at: "post-execute", failOpen: true, error: String(e?.message || e) });
			return downstream;
		}
	});

	log({
		at: "loaded",
		plugin: PLUGIN_ID,
		mode: CONFIG.mode,
		settingsRoute: SETTINGS_ROUTE,
		softCut: softCutProbe,
		preStep: preStepProbe
	});
}


// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { name, inject, apply, createSessionState, noteEvent, noteAssistantStep, evaluateG1, evaluateG2, targetKey, failureSignature, reasoningFingerprint, shingleSet, jaccardSimilarity, isSelfDenialResult, advanceStepBoundary, toolCategory, applySettings, settingsSnapshot, BLOCK_CODES, CATEGORY_BY_TOOL, DENY_CATEGORIES, GOVERNOR_SETTINGS_SCHEMA, GOVERNOR_SETTINGS_DEFAULTS, SETTINGS_SCHEMA, DEFAULT_SETTINGS, CONFIG };
