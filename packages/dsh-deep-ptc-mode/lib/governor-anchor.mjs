/**
 * dsh-stall-governor — §2 「单流内」引擎(源自 dsh-cot-anchor)基础层:钩子常量与内核能力探测、结论/句子分析、事件与锚点渲染设施。
 *
 * #116 拆分:本文件全部声明自原 lib/governor.js 等价整块搬入(逐字未改),导入为新增。
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { PLUGIN_SOURCE } from "./governor-core.mjs";
import { copy } from "./governor-copy.mjs";




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
 * 纪律，改 governor-copy.mjs 的 discipline0..9 字典后重启，或在设置中关闭
 * 「随锚点注入命令执行纪律块」（#144 后文本不在本文件,本数组已不存在）。
 */
// #132:纪律块文案抽字典。#144:单源化——全部 locale(含 zh)统一从 governor-copy.mjs 的
// discipline0..9 字典拼装,EXEC_DISCIPLINE_TEXT 降级为 zh 派生值(仅供既有消费点与契约测试对照)。
// 语义顺序:③ 拆 3a/3b,④⑤ 合入 discipline4;⓪-⑨ 标记必须齐全且有序(契约测试守护)。
const DISCIPLINE_KEYS = ["discipline0", "discipline1", "discipline2", "discipline3a", "discipline3b",
	"discipline4", "discipline6", "discipline7", "discipline8", "discipline9"];

function execDisciplineFromDict(locale) {
	const t = copy(locale);
	return DISCIPLINE_KEYS.map((k) => t[k]()).join("");
}

/** zh 纪律全文(自字典派生;保留导出名以兼容 #132 前的消费点)。 */
const EXEC_DISCIPLINE_TEXT = execDisciplineFromDict("zh");

/** locale 感知纪律块(#132 单字典,#144 单源化)。 */
function execDisciplineText(locale = "zh") {
	return execDisciplineFromDict(locale);
}

/**
 * 纪律段在运行时上下文快照中的排序键。
 * auto-memory 记忆规则段 order=10000（其尾部 surface 为 10001），
 * dsh-naonao 用户唠叨段 order=100000；取 20000 保证纪律段位于
 * 「记忆规则之后、naonao 之前」，并留出充足间隔。
 */
const EXEC_DISCIPLINE_CONTEXT_ORDER = 20000;

// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { SOFTCUT_HIGH_CONFIDENCE, SOFT_CUT_HOOK, ASSISTANT_STREAM_HOOK, PRE_STEP_HOOK, CAPABILITY_UNKNOWN, CAPABILITY_PRESENT, CAPABILITY_ABSENT, probeKernelHook, CONCLUSION_OPENERS, WEAK_SENTENCE_PATTERNS, DISCOURSE_FILLER_PATTERNS, MIN_RESIDUAL_CONTENT_CHARS, CORRECTION_PATTERNS, DENSITY_PATTERNS, HEDGE_PATTERNS, OPENER_TIER_SCORE, FALLBACK_TIER_SCORE, FALLBACK_MIN_CHARS, CONCLUSION_ACTION_PATTERNS, CONCLUSION_PREDICATE_PATTERNS, isWeakSentence, residualProposition, isEmptyDiscourseSentence, hasContentSignal, scoreSentence, extractConclusions, QUOTE_OPEN_TO_CLOSE, TOGGLE_QUOTES, QUOTED_STOP_MASK, QUOTED_STOP_UNMASK, QUOTED_STOP_UNMASK_RE, maskQuotedSentenceStops, unmaskQuotedSentenceStops, splitSentences, EVENT_REFLOW_MISJUDGED, EVENT_POINT_TRUNCATED, EVENT_LENGTH_CONSERVATION_FAILED, EVENT_STRUCTURE_UNBALANCED, EVENT_ANCHOR_DEDUP_SKIPPED, EVENT_SOFTCUT_TAKEN, evidenceSeqCounter, nextEvidenceSeq, evidenceBase, emitCotAnchorEvent, emitPointTruncatedEvent, checkLengthConservation, checkStructuralBalance, renderAnchor, hasExplicitConclusion, latestReasoningText, latestThinkingText, latestAssistantSource, deepFreeze, buildAnchorContext, EXEC_DISCIPLINE_TEXT, EXEC_DISCIPLINE_CONTEXT_ORDER, execDisciplineText };
