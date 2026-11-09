/**
 * dsh-stall-governor — §4 统一装配:外部软切服务与锚点去重设施 + apply(ctx) 装配体。kernelSoftCutProbe 由 apply 写入,消费方 requestExternalSoftCut 同模块,避免导入绑定赋值。
 *
 * #116 拆分:本文件全部声明自原 lib/governor.js 等价整块搬入(逐字未改),导入为新增。
 */
import { mkdirSync, renameSync } from "node:fs";
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createUserMessage } from "./governor-peer.mjs";
import { resetConfigFromEnv, CONFIG, createSessionState, logStatic, name, BLOCK_CODES, FORBIDDEN_RETRY_CODES, DENY_CATEGORIES, SETTINGS_FILE, applySettings, noteEvent, toolCategory, PLUGIN_ID, targetKey, evaluateG2, enforces, settleLastStep, advanceStepBoundary, evaluateG1, SOFT_STOP_SOURCE, g1Code, SETTINGS_ROUTE, sendJson, GOVERNOR_SETTINGS_SCHEMA, settingsSnapshot, GOVERNOR_SETTINGS_DEFAULTS, readRequestBody } from "./governor-core.mjs";
import { CAPABILITY_UNKNOWN, CAPABILITY_ABSENT, probeKernelHook, SOFT_CUT_HOOK, ASSISTANT_STREAM_HOOK, PRE_STEP_HOOK, SOFTCUT_HIGH_CONFIDENCE, EXEC_DISCIPLINE_CONTEXT_ORDER, EXEC_DISCIPLINE_TEXT, execDisciplineText, emitCotAnchorEvent, EVENT_SOFTCUT_TAKEN, evidenceBase, buildAnchorContext, hasExplicitConclusion, extractConclusions, EVENT_REFLOW_MISJUDGED, renderAnchor, checkLengthConservation, EVENT_LENGTH_CONSERVATION_FAILED, checkStructuralBalance, EVENT_STRUCTURE_UNBALANCED, EVENT_ANCHOR_DEDUP_SKIPPED } from "./governor-anchor.mjs";
import { copy } from "./governor-copy.mjs";
import { settings, applyRuntimeSettings, SETTINGS_SCHEMA, DEFAULT_SETTINGS, OVER_LONG_COT_THRESHOLD, MIN_REASONING_CHARS, MAX_POINTS, MAX_POINT_CHARS } from "./governor-settings.mjs";
import { resetChurnCountOnTurnBoundary, resetOverLongCountOnTurnBoundary, findRepeatingTail, hasPseudoToolCall, renderPseudoToolAnchor, renderRepeatAnchor, detectNGramLoop, renderNGramLoopAnchor, detectNumberRunaway, renderNumberRunawayAnchor, insideUnclosedCodeFence, detectChurn, recordChurnCut, renderChurnAnchor, renderChurnEscalation, detectActionChurn, renderActionChurnAnchor, recordOverLongCut, renderOverLongCoTAnchor, wantsSoftCut, isGapWithinThreshold, extractInvalidArgFields, renderToolArgsErrorAnchor } from "./governor-softcut.mjs";





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
/** 有最近可见文本时的引导语（locale 感知,#132);zh 为既有逐字文案。 */
function externalAnchorPrefix(locale = "zh") {
	return copy(locale).externalAnchorPrefix();
}
/** 调用方未提供可用文本时的兜底锚点（不捏造任何任务事实）。 */
function externalAnchorFallback(locale = "zh") {
	return copy(locale).externalAnchorFallback();
}
/** 历史导出面保留(zh 固化);运行时消费点已改走 externalAnchorPrefix()/externalAnchorFallback()(locale 感知),模块内现无消费点。 */
const EXTERNAL_ANCHOR_PREFIX = externalAnchorPrefix();
const EXTERNAL_ANCHOR_FALLBACK = externalAnchorFallback();
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
	// #132:引导语按 copyLocale 运行时取值(常量为 zh 默认,供既有引用零改动)
	const tExt = copy(settings.copyLocale);
	const prefix = tExt.externalAnchorPrefix();
	const anchorText = rawText.trim().length > 0
		? prefix + (
			rawText.length > EXTERNAL_ANCHOR_MAX_CHARS
				? rawText.slice(rawText.length - EXTERNAL_ANCHOR_MAX_CHARS)
				: rawText
		)
		: tExt.externalAnchorFallback();
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
			mkdirSync(dirname(settingsPath), { recursive: true });
			// T4.ptc §6 原子化对齐: tmp+rename+0600,与 vault/audit 同一口径。
			// 直写目标路径曾让进程中断留下半份 JSON(读侧回退默认,用户设置丢失)。
			const tmp = settingsPath + ".tmp";
			writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
			renameSync(tmp, settingsPath);
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
					const tDeny = copy(settings.copyLocale);
					return {
						kind: "deny",
						reason: `[${PLUGIN_ID}] semantic-stall-2: ${tDeny.denyStall2(category, deny2.expiresAtStep, state.globalStepSeq)}`,
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
					const tG2 = copy(settings.copyLocale);
					const scope = verdict.rule === "G2-B" ? tG2.g2bScope() : tG2.g2aScope();
					const targetShown = key.length > 120 ? key.slice(0, 120) + "…" : key;
					return {
						kind: "deny",
						reason: `[${PLUGIN_ID}] ${verdict.rule}: ${scope} ${verdict.rule === "G2-B"
							? tG2.g2bCount(verdict.detail.consecutiveFail, CONFIG.g2bConsecutiveFailures)
							: tG2.g2aCount(verdict.detail.calls, CONFIG.g2aSameTargetCalls)}${tG2.denyG2Tail(targetShown)}`,
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
						const tStop = copy(settings.copyLocale);
						const notice = createUserMessage({
							content: [{
								type: "text",
								text: `【${PLUGIN_ID}】${verdict.rule}：${ruleText}（当前第 ${state.globalStepSeq} 步）。`
									+ tStop.softStopTail()
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
				name: "dsh:stall-governor-exec-discipline",
				order: EXEC_DISCIPLINE_CONTEXT_ORDER,
				// FIX-09 开关（enableExecDisciplineBlock，默认开）从 post-execute 注入
				// 迁移到这里：关掉则该段文本返回空串，内核装配快照时遇到空文本即省略
				// 该段（这段时间体失效）；开启则全文出现。开态文本始终是同一常量，
				// 稳定前缀仍利于 KV 缓存。
				text: () => settings.enableExecDisciplineBlock ? execDisciplineText(settings.copyLocale) : ""
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
					sendJson(res, error?.statusCode ?? 500, { ok: false, error: String(error?.message ?? error) });
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
					renderPseudoToolAnchor(looping !== null, looping, settings.copyLocale),
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
				contexts: [buildAnchorContext(renderRepeatAnchor(looping, settings.copyLocale), `cot-anchor: loop x${looping.count}`)]
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
				contexts: [buildAnchorContext(renderNGramLoopAnchor(ngramLoop, settings.copyLocale),
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
				contexts: [buildAnchorContext(renderNumberRunawayAnchor(numberRunaway, settings.copyLocale), `cot-anchor: number-runaway x${numberRunaway.chars}`)]
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
				? renderChurnAnchor(churn, settings.copyLocale) + renderChurnEscalation(churnOccurrence, settings.copyLocale)
				: renderChurnAnchor(churn, settings.copyLocale);
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
			const anchorText = renderActionChurnAnchor(actionChurn, settings.copyLocale)
				+ (churnOccurrence >= 2 ? renderChurnEscalation(churnOccurrence, settings.copyLocale) : "");
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
				reasoningChars, OVER_LONG_COT_THRESHOLD, !!hasReasoningCount, occurrence, settings.copyLocale);
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
				renderToolArgsErrorAnchor(toolName, invalidFields, settings.copyLocale),
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
export { EXTERNAL_SOFT_CUT_TTL_MS, EXTERNAL_ANCHOR_MAX_CHARS, EXTERNAL_ANCHOR_PREFIX, EXTERNAL_ANCHOR_FALLBACK, externalSoftCutPending, kernelSoftCutProbe, requestExternalSoftCut, consumeExternalSoftCut, reasoningKey, HIGH_REASONING_EFFORT_LEVELS, readReasoningEffort, anchorContentHash, injectedAnchorHashesBySession, INJECTED_ANCHOR_HASH_LIMIT, INJECTED_ANCHOR_SESSION_LIMIT, alreadyInjectedAnchor, rememberInjectedAnchor, injectedAnchorPointsBySession, INJECTED_ANCHOR_POINTS_LIMIT, INJECTED_ANCHOR_STRIP_MIN_CHARS, rememberInjectedPoints, stripInjectedAnchors, apply };
