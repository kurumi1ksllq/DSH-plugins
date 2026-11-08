/**
 * dsh-stall-governor — §0 共享设施 + §1 「跨步骤」引擎(源自 dsh-step-governor):插件身份/HTTP 助手/CONFIG 基建 + BLOCK_CODES 判据、指纹、G1/G2 评估与步进状态。
 *
 * #116 拆分:本文件全部声明自原 lib/governor.js 等价整块搬入(逐字未改),导入为新增。
 */




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

/** Settings 请求体的安全上限:设置 payload 远小于此,超限即 413(§3-9 有界内存)。 */
const REQUEST_BODY_MAX_CHARS = 65536;

/** Collect and parse a JSON request body (empty body reads as `{}`). */
function readRequestBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		let oversize = false;
		req.on("data", (chunk) => {
			if (oversize) return; // 超限后停止累积:内存护栏仍然有效
			body += chunk;
			if (body.length > REQUEST_BODY_MAX_CHARS) {
				oversize = true;
				const err = new Error("request body too large");
				err.statusCode = 413;
				reject(err);
				// 排空余下请求体让客户端发完,路由 catch 的 413 响应才能 flush 到线上
				// (复审实测:req.destroy() 先拆 socket,客户端只读到连接重置)。
				if (typeof req.resume === "function") req.resume();
			}
		});
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

// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { PLUGIN_ID, name, inject, PLUGIN_SOURCE, SOFT_STOP_SOURCE, SETTINGS_FILE, SETTINGS_ROUTE, sendJson, REQUEST_BODY_MAX_CHARS, readRequestBody, BLOCK_CODES, FORBIDDEN_RETRY_CODES, WORKFLOW_TERMINAL_TOOL, CATEGORY_BY_TOOL, DENY_CATEGORIES, NOTIFY_CHANNELS, GOVERNOR_SETTINGS_SCHEMA, optionValues, GOVERNOR_SETTINGS_DEFAULTS, intEnv, MODES, envOwnedKeys, ENV_BY_KEY, CONFIG, resetConfigFromEnv, applySettings, settingsSnapshot, logStatic, enforces, targetKey, normalizeCommandKey, fnv1aHex, stableStringify, failureSignature, structuredErrorCode, isSelfDenialResult, reasoningFingerprint, shingleSet, jaccardSimilarity, FINGERPRINT_JACCARD_MIN, createSessionState, blocksOf, advanceStepBoundary, noteEvent, noteAssistantStep, settleLastStep, g1Code, evaluateG1, evaluateG2, toolCategory };
