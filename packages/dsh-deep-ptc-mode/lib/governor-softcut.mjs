/**
 * dsh-stall-governor — 软切检测器群:tier1 开场/transition/investigative/repeat/numberRun/n-gram/伪工具/工具参数错误/churn/overLong 的检测、锚点渲染与会话级计数。
 *
 * #116 拆分:本文件全部声明自原 lib/governor.js 等价整块搬入(逐字未改),导入为新增。
 */
import { CONCLUSION_OPENERS } from "./governor-anchor.mjs";
import { SOFT_CUT_SCAN_TAIL, SOFT_CUT_MIN_FOLLOW_CHARS, SOFT_CUT_TRANSITION_WINDOW, SOFT_CUT_GAP_THRESHOLD, CHURN_WINDOW_CHARS, REPEAT_MIN_TEXT_CHARS, REPEAT_WINDOW_CHARS, REPEAT_PROBE_CHARS, REPEAT_MAX_PERIOD, REPEAT_SHORT_PERIOD, REPEAT_MIN_PERIOD, REPEAT_ULTRA_SHORT_MIN_COUNT, REPEAT_MIN_COUNT_SHORT, REPEAT_MIN_COUNT, NUMBER_RUN_MIN_TEXT_CHARS, NUMBER_RUN_MAX_GAP, NUMBER_RUN_MIN_CHARS, NUMBER_RUN_MIN_DIGIT_RATIO, NUMBER_RUN_MIN_INCREASE_RATIO, NGram_PHRASE_MIN, NGram_MIN_COUNT, NGram_COVERAGE_RATIO, PSEUDO_TOOL_SCAN_TAIL, CHURN_MIN_TEXT_CHARS, CHURN_MIN_HITS } from "./governor-settings.mjs";
import { copy } from "./governor-copy.mjs";



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
function renderRepeatAnchor(loop, locale = "zh") {
	const t = copy(locale);
	if (locale === "zh") {
		return [
			t.repeatHead(loop),
			`(You are repeating the same ${loop.period}-char block at least ${loop.count} times. Stop repeating it now.)`,
			t.repeatAct()
		].join("\n");
	}
	return [t.repeatHead(loop), t.repeatAct()].join("\n");
} // (b>a || b===a) / neighbouring pairs

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
function renderNumberRunawayAnchor(nr, locale = "zh") {
	const t = copy(locale);
	if (locale === "zh") {
		return [
			t.numberRunHead(nr),
			t.numberRunAct(),
			`(You are emitting a ${nr.chars}-char monotone-increasing number stream. Stop counting; resume from the last real sentence.)`
		].join("\n");
	}
	return [t.numberRunHead(nr), t.numberRunAct()].join("\n");
}
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
function renderNGramLoopAnchor(info, locale = "zh") {
	const t = copy(locale);
	if (locale === "zh") {
		return [
			t.ngramHead(info),
			t.ngramDiag(),
			t.ngramAct(),
			`(NGram loop: phrase "${info.maxGram}" x${info.count}, coverage ${(info.coverage * 100).toFixed(1)}%. Stop cycling.)`
		].join("\n");
	}
	return [t.ngramHead(info), t.ngramDiag(), t.ngramAct()].join("\n");
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
function renderPseudoToolAnchor(alsoLooping, loop, locale = "zh") {
	const t = copy(locale);
	const lines = [t.pseudoHead(), t.pseudoNoTag(), t.pseudoCall(), t.pseudoFallback()];
	if (alsoLooping && loop) {
		lines.push(t.pseudoLooped(loop));
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
function renderToolArgsErrorAnchor(toolName, fields, locale = "zh") {
	const t = copy(locale);
	const toolLabel = typeof toolName === "string" && toolName.trim() !== "" ? toolName.trim() : t.toolArgsFallbackLabel();
	if (fields.length > 0) {
		return [
			t.toolArgsHead(toolLabel, fields),
			t.toolArgsResend(),
			t.toolArgsNoTag(),
			`(Your previous tool call was NOT executed: ${toolLabel} arguments failed validation (${fields.join(", ")}). Resend exactly once with schema-valid arguments via the real tool-call channel — never as text tags.)`
		].join("\n");
	}
	// 通用句式降级：抽不到参数名时仍必须给出可执行的恢复指引。
	return [
		t.toolArgsInvalidHead(toolLabel),
		t.toolArgsGenericResend(),
		t.toolArgsNoTag(),
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
function renderChurnAnchor(churn, locale = "zh") {
	const t = copy(locale);
	if (locale === "zh") {
		return [
			t.churnHead(churn, CHURN_WINDOW_CHARS),
			t.churnStop(),
			t.churnAct(),
			`(You are churning: ${churn.hits} restart phrases in the last ~${CHURN_WINDOW_CHARS} chars. Stop re-analyzing; emit only what you have not said yet, then act.)`
		].join("\n");
	}
	return [t.churnHead(churn, CHURN_WINDOW_CHARS), t.churnStop(), t.churnAct()].join("\n");
}

/**
 * 修复①：行动提议型空转锚点。与 renderChurnAnchor 并列，用语明确指向"说了要调用但从未调用"。
 * @param {{hits:number}} churn
 * @returns {string}
 */
function renderActionChurnAnchor(churn, locale = "zh") {
	const t = copy(locale);
	if (locale === "zh") {
		return [
			t.actionChurnHead(churn, CHURN_WINDOW_CHARS),
			t.actionChurnStop(),
			t.actionChurnAct(),
			`(Action-proposal stall: ${churn.hits} tool-verb proposals in the last ~${CHURN_WINDOW_CHARS} chars with zero real tool_call. Stop proposing — either emit the tool_call or give the result.)`
		].join("\n");
	}
	return [t.actionChurnHead(churn, CHURN_WINDOW_CHARS), t.actionChurnStop(), t.actionChurnAct()].join("\n");
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
function renderOverLongCoTAnchor(reasoningChars, threshold, hasStreams, occurrence = 1, locale = "zh") {
	const t = copy(locale);
	const scope = hasStreams ? t.overLongScopeStreams(reasoningChars, threshold) : t.overLongScopeMerged(reasoningChars, threshold);
	const lines = [
		t.overLongHead(scope),
		t.overLongNoTalk(),
		t.overLongEither(),
		t.overLongMinAction(),
		"(Stop generating reasoning now. Your next message MUST be either one real tool call, or the final answer to the user. No analysis, no plans, no restating, no \"I should act now\" declarations. If information is insufficient, make the smallest verifiable tool call instead of writing more text.)"
	];
	return lines.join("\n") + renderOverLongEscalation(occurrence, locale);
}

/**
 * 第 2 次及以后追加的升级指令。逐次加码，避免连续多次注入逐字相同的提醒
 * 被模型当成环境噪声或思考开场模板；不声称插件能强制中止（内核才持有剪刀）。
 * @param {number} occurrence - 本 turn 内第几次命中（>=1）
 * @returns {string} 第 1 次返回空串
 */
function renderOverLongEscalation(occurrence, locale = "zh") {
	if (occurrence < 2) return "";
	const t = copy(locale);
	const lines = ["", t.overLongEsc2(occurrence)];
	if (occurrence >= 3) lines.push(t.overLongEsc3(occurrence));
	if (occurrence >= 5) lines.push(t.overLongEsc5());
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
function renderChurnEscalation(occurrence, locale = "zh") {
	const t = copy(locale);
	const lines = ["", t.churnEsc(occurrence)];
	if (occurrence >= 6) lines.push(t.churnEscBudget());
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

// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { TRANSITION_EXEC_VERBS_CN, TRANSITION_EXEC_VERBS_EN, TRANSITION_BRIDGE_CN, TRANSITION_PATTERNS, wantsSoftCut, findTier1OpenerInTail, findTransitionInTail, computeTier1ToTransitionGap, isGapWithinThreshold, CASCADING_PATTERNS, INVESTIGATIVE_TRANSITION_PREFIXES, INVESTIGATIVE_PREFIX_REPEAT_MAX, INVESTIGATIVE_PREFIX_WINDOW_CHARS, INVESTIGATIVE_EXEC_VERBS, countInvestigativePrefixes, countActionVsExecVerbs, shouldTightenInvestigativePrefix, INVESTIGATIVE_CJK_VERB_CHARS, transitionLeadsToInvestigation, findRepeatingTail, renderRepeatAnchor, detectNumberRunaway, renderNumberRunawayAnchor, NGram_WORD_TOKEN_MIN_CHARS, NGram_WORD_GRAM_SIZE, NGram_WORD_MIN_LETTERS, NGram_CJK_MIN_CHARS, NGram_CONTEXT_MIN_RATIO, NGram_WORD_CANDIDATE_LIMIT, NGram_DENSITY_MIN_CHARS, NGram_DENSITY_MIN_TOKENS, NGram_STOPWORDS, normalizeForNGram, pickMaxFromCountMap, computeWordGramFingerprint, extractEnglishWordSegments, stripQuotedSegments, stripFencedBlocks, stripTableRows, stripTraceLines, computeNGramFingerprint, pickHighestNonStopwordGram, listEligibleWordGrams, wordGramContextStability, charGramContextStability, charGramSpanLength, wordGramSpanTokens, detectNGramLoop, renderNGramLoopAnchor, PSEUDO_STRONG_PATTERNS, PSEUDO_WEAK_PATTERNS, PSEUDO_FUNCTION_TAG, PSEUDO_PARAMETER_TAG, PSEUDO_INVOKE_NAME_TAG, PSEUDO_INVOKE_CLOSER, PSEUDO_INVOKE_COMPLETE_BLOCK, PSEUDO_CLOSER_PATTERNS, hasPseudoToolCall, renderPseudoToolAnchor, extractInvalidArgFields, renderToolArgsErrorAnchor, CHURN_PHRASES, CHURN_ACTION_PHRASES, CHURN_ACTION_MIN_HITS, countChurnHits, detectChurn, detectActionChurn, renderChurnAnchor, renderActionChurnAnchor, renderOverLongCoTAnchor, renderOverLongEscalation, overLongCountBySession, OVER_LONG_COUNT_MAP_LIMIT, evictOverLongCountOldest, recordOverLongCut, resetOverLongCountOnTurnBoundary, churnCountBySession, CHURN_COUNT_MAP_LIMIT, evictChurnCountOldest, recordChurnCut, resetChurnCountOnTurnBoundary, renderChurnEscalation, insideUnclosedCodeFence };
