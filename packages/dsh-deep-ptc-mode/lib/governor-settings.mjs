/**
 * dsh-stall-governor — 设置层:DEFAULT_SETTINGS/SETTINGS_SCHEMA/applyRuntimeSettings 与各软切检测器的运行期可调阈值——阈值 let 仅由 applyRuntimeSettings 原地赋值,必须与赋值方同模块(ESM 导入绑定不可写)。
 *
 * #116 拆分:本文件全部声明自原 lib/governor.js 等价整块搬入(逐字未改),导入为新增。
 */



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
 * Minimum characters AFTER the transition word before a soft-cut is allowed.
 * "我先" alone (2 chars) means the thought just started — cut nothing.  A real
 * follow-on like "我先看一下配置" (7) or longer means the transition is
 * unfolding and the cut lands on a boundary the extractor can handle.
 */
let SOFT_CUT_MIN_FOLLOW_CHARS = 6;

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
let NUMBER_RUN_MIN_INCREASE_RATIO = 0.55;

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
/** How much of the tail to scan for a call attempt (the observed block was 587 chars). */
let PSEUDO_TOOL_SCAN_TAIL = 4000;
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
	// #132:注入模型文案语言(检测器词表不在此列,永远原始语言)。默认 zh=既有逐字文案,行为零变化。
	copyLocale: "zh",
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
	// #132:文案字段(label/hint/group/options[].label)为 {zh,en} 双字典;zh 为既有逐字文案。
	// 结构字段(key/type/min/max/step/advanced)不受 locale 化影响。
	{ key: "enableSoftCut", label: { zh: "允许生成中途打断（软切断）", en: "Allow mid-generation interruption (soft cut)" }, type: "boolean", group: { zh: "总开关", en: "Master switches" },
		hint: { zh: "关闭后只保留工具边界的注入，不再在生成过程中切断。", en: "When off, only tool-boundary injection remains; no more cutting during generation." } },
	{ key: "enableExternalSoftCut", label: { zh: "允许外部插件请求软切", en: "Allow external plugins to request soft cuts" }, type: "boolean", group: { zh: "总开关", en: "Master switches" },
		hint: { zh: "开启后允许其他插件（如 dsh-derive-watcher 检测到二级语义停滞时）请求本插件在生成边界软切。外部请求只占用启发式额度，不会触发硬中止；默认开启（开箱即用）。", en: "When on, other plugins (e.g. dsh-derive-watcher detecting secondary semantic stall) may request a soft cut at the generation boundary. External requests only consume the heuristic budget and never hard-abort; on by default." } },

	{ key: "enablePseudoTool", label: { zh: "识别伪工具调用", en: "Detect pseudo tool calls" }, type: "boolean", group: { zh: "打断判定", en: "Interruption detection" },
		hint: { zh: "模型把工具调用写成文本（如 <seed:tool_call>）时打断并纠正格式。", en: "Cut when the model writes a tool call as text (e.g. <seed:tool_call>) and correct the format." } },
	{ key: "enableRepeat", label: { zh: "识别重复/语义循环（n-gram 指纹）", en: "Detect repetition / semantic loops (n-gram fingerprint)" }, type: "boolean", group: { zh: "打断判定", en: "Interruption detection" },
		hint: { zh: "同一段内容被反复吐出，或尾窗内高频短语反复出现（注入提示「语义循环（n-gram 指纹）」）时打断，并裁掉落盘的重复部分。", en: "Cut when the same block is emitted repeatedly or a high-frequency phrase recurs in the tail window (injected hint: \"semantic loop\"), trimming the duplicated part from the transcript." } },
	{ key: "enableChurn", label: { zh: "识别语义空转", en: "Detect semantic churning" }, type: "boolean", group: { zh: "打断判定", en: "Interruption detection" },
		hint: { zh: "措辞不同但反复\"重新分析\"时打断（注入提示「原地空转」）；含只说不做的\"行动提议空转\"（注入提示「行动提议空转」）。属启发式判定，遇到未闭合代码块会自动让路。", en: "Cut when the model re-analyzes in different words (hint: \"churning\"); also covers action-proposal stalls (hint: \"action-proposal stall\"). Heuristic; yields inside unclosed code fences." } },
	{ key: "enableTransition", label: { zh: "识别转折句", en: "Detect transition phrases" }, type: "boolean", group: { zh: "打断判定", en: "Interruption detection" },
		hint: { zh: "\"接下来我要……\"这类转折句出现时打断，先注入结论锚点。", en: "Cut on transition phrases like \"next I will…\" and inject the conclusions anchor first." } },
	{ key: "enableNumberRunaway", label: { zh: "识别数字递增流退化", en: "Detect number-runaway degeneration" }, type: "boolean", group: { zh: "打断判定", en: "Interruption detection" },
		hint: { zh: "长段递增数字流（如 639.640) 640.641)…）连续多字且无实质内容时打断。启发式判定，仅在数字流足够长时触发。", en: "Cut long monotone number streams (e.g. 639.640) 640.641)…) that carry no substance. Heuristic; fires only on long enough runs." } },
	{ key: "enableOverLongCoT", label: { zh: "过长 CoT 软切", en: "Over-long CoT soft cut" }, type: "boolean", group: { zh: "打断判定", en: "Interruption detection" },
		hint: { zh: "当本轮 CoT 累计字符数达到下方阈值时软切并提醒模型「落实阶段性结论、避免过度思考」。属兜底提醒，独立于其他启发式检测。默认关闭。", en: "When this turn's CoT reaches the threshold below, cut and remind the model to settle phase conclusions and stop over-thinking. A last-resort reminder, independent of other heuristics. Off by default." } },

	{ key: "minReasoningChars", label: { zh: "最少思考字数", en: "Minimum reasoning chars" }, type: "number", min: 50, max: 5000, group: { zh: "锚点内容", en: "Anchor content" },
		hint: { zh: "思考短于此长度时不提取结论、不注入。", en: "No conclusions are extracted or injected when reasoning is shorter than this." } },
	{ key: "maxPoints", label: { zh: "锚点最多结论条数", en: "Max conclusion points per anchor" }, type: "number", min: 1, max: 8, group: { zh: "锚点内容", en: "Anchor content" } },
	{ key: "maxPointChars", label: { zh: "单条结论最大字数", en: "Max chars per conclusion point" }, type: "number", min: 40, max: 1000, group: { zh: "锚点内容", en: "Anchor content" } },
	{ key: "enableLengthConservationCheck", advanced: true, label: { zh: "长度守恒校验", en: "Length-conservation check" }, type: "boolean", group: { zh: "锚点内容", en: "Anchor content" },
		hint: { zh: "注入前先核对锚点正文和每条结论逐字一致，防止摘要被截断或丢字；对不上就放弃这次注入。", en: "Verify the anchor body reproduces each conclusion verbatim before injection; abandon the injection on any drift." } },
	{ key: "transitionTextMode", advanced: true, label: { zh: "思考与正文如何分开（内核支持后生效）", en: "How to split reasoning from text (needs kernel support)" }, type: "select", group: { zh: "锚点内容", en: "Anchor content" },
		options: [
			{ value: "separateThreshold", label: { zh: "按字数阈值自动分开（默认）", en: "Split by char threshold (default)" } },
			{ value: "disable", label: { zh: "不分开，整段当作正文处理", en: "No split; treat the whole stream as text" } }
		],
		hint: { zh: "决定怎么把模型的「思考」和「正文」区分开来。内核还没支持这一项，选什么都不会改变行为，先按默认放着即可。", en: "Controls how reasoning and text are separated. The kernel does not support this yet; no value changes behavior — leave the default." } },
	{ key: "enableExecDisciplineBlock", label: { zh: "随锚点注入命令执行纪律块", en: "Inject command-discipline block with anchors" }, type: "boolean", group: { zh: "锚点内容", en: "Anchor content" },
		hint: { zh: "默认开启。开启时会把「执行命令要守规矩」这段提醒和结论摘要一起插回上下文；关闭就完全不插这段提醒，结论摘要和其他识别、去重功能都不受影响。", en: "On by default. When on, the command-discipline reminder is injected alongside the conclusions summary; turning it off removes only that reminder." } },

	{ key: "overLongCoTThreshold", advanced: true, label: { zh: "CoT 长度阈值（字符）", en: "CoT length threshold (chars)" }, type: "number", min: 0, max: 100000, group: { zh: "过长 CoT 参数", en: "Over-long CoT" },
		hint: { zh: "本轮 CoT 累计字符数达到此值即触发软切提醒，设置值直接生效、不会被放大。默认 8000；设为 0 即关闭（同关闭上方开关效果一致）。内核未分流 text/reasoning 时按整段输出长度估算（含回答文本）；只想统计纯思考字数，请把内核切到 separateThreshold 模式。", en: "Soft-cut reminder fires when this turn's CoT reaches this many chars; the value applies as-is. Default 8000; 0 disables (same as the switch above). Without kernel text/reasoning splitting, the whole output is estimated (answer text included)." } },

	{ key: "numberRunMinTextChars", advanced: true, label: { zh: "数字流启用最小文本长度", en: "Min text length to arm number-run detection" }, type: "number", min: 100, max: 50000, group: { zh: "数字流参数", en: "Number-run parameters" } },
	{ key: "numberRunMinChars", advanced: true, label: { zh: "数字流最短跨度", en: "Min number-run span" }, type: "number", min: 50, max: 20000, group: { zh: "数字流参数", en: "Number-run parameters" } },
	{ key: "numberRunMaxGap", advanced: true, label: { zh: "数字流最大间隙", en: "Max gap inside a number run" }, type: "number", min: 1, max: 200, group: { zh: "数字流参数", en: "Number-run parameters" },
		hint: { zh: "相邻数字 token 之间允许的最大字符间隔。", en: "Maximum chars allowed between adjacent number tokens." } },
	{ key: "numberRunMinDigitRatio", advanced: true, label: { zh: "数字流最小数字占比", en: "Min digit ratio in a run" }, type: "number", min: 0, max: 1, group: { zh: "数字流参数", en: "Number-run parameters" } },
	{ key: "numberRunMinIncreaseRatio", advanced: true, label: { zh: "数字流最小递增占比", en: "Min increase ratio in a run" }, type: "number", min: 0, max: 1, group: { zh: "数字流参数", en: "Number-run parameters" } },

	{ key: "repeatMinCount", advanced: true, label: { zh: "长块重复次数阈值", en: "Long-block repetition threshold" }, type: "number", min: 2, max: 10, group: { zh: "重复循环参数", en: "Repetition/loop parameters" },
		hint: { zh: "长内容（超过下方\"短周期分界\"）重复达到此次数即判定打转。", en: "Long content (beyond the short-period boundary below) is judged looping at this count." } },
	{ key: "repeatMinCountShort", advanced: true, label: { zh: "短周期重复次数阈值", en: "Short-period repetition threshold" }, type: "number", min: 2, max: 30, group: { zh: "重复循环参数", en: "Repetition/loop parameters" },
		hint: { zh: "短内容循环需重复更多次才判定打转；调低则更激进。", en: "Short loops need more repetitions to count; lower is more aggressive." } },
	{ key: "repeatUltraShortMinCount", advanced: true, label: { zh: "超短周期重复次数阈值", en: "Ultra-short-period repetition threshold" }, type: "number", min: 5, max: 200, group: { zh: "重复循环参数", en: "Repetition/loop parameters" },
		hint: { zh: "周期 2~11 字的极小循环（如 `er4er4…` token 卡死）须重复到这么多次才判定；正常强调/分隔线（====、-----）不构成威胁。", en: "Tiny 2–11-char loops (e.g. stuck `er4er4…` tokens) must repeat this many times; normal emphasis/separators (====, -----) are harmless." } },
	{ key: "repeatMinPeriod", advanced: true, label: { zh: "最小周期字数", en: "Min loop period (chars)" }, type: "number", min: 4, max: 500, group: { zh: "重复循环参数", en: "Repetition/loop parameters" } },
	{ key: "repeatShortPeriod", advanced: true, label: { zh: "短周期分界字数", en: "Short-period boundary (chars)" }, type: "number", min: 16, max: 2000, group: { zh: "重复循环参数", en: "Repetition/loop parameters" } },
	{ key: "repeatMaxPeriod", advanced: true, label: { zh: "最大周期字数", en: "Max loop period (chars)" }, type: "number", min: 500, max: 50000, group: { zh: "重复循环参数", en: "Repetition/loop parameters" } },
	{ key: "repeatWindowChars", advanced: true, label: { zh: "重复检查窗口", en: "Repetition scan window" }, type: "number", min: 1000, max: 60000, group: { zh: "重复循环参数", en: "Repetition/loop parameters" },
		hint: { zh: "只在文本尾部这段长度内做周期性预筛（性能保护）。", en: "Periodic pre-screening only within this tail length (performance guard)." } },
	{ key: "repeatProbeChars", advanced: true, label: { zh: "周期探针长度", en: "Period probe length" }, type: "number", min: 16, max: 2000, group: { zh: "重复循环参数", en: "Repetition/loop parameters" } },
	{ key: "repeatMinTextChars", advanced: true, label: { zh: "启用最小文本长度", en: "Min text length to arm" }, type: "number", min: 500, max: 50000, group: { zh: "重复循环参数", en: "Repetition/loop parameters" } },
	{ key: "ngramPhraseMin", advanced: true, label: { zh: "n-gram 短语最小长度（字符）", en: "Min n-gram phrase length (chars)" }, type: "number", min: 3, max: 20, group: { zh: "重复循环参数", en: "Repetition/loop parameters" },
		hint: { zh: "字符级 n-gram 的滑窗粒度（中文路径）。默认 5；调高要求更长的短语才计数（更保守）。英文路径固定按相邻 4 个词（每词 ≥2 字母），不受此项影响。", en: "Sliding-window granularity for char-level n-grams (zh path). Default 5; higher is more conservative. The word path always uses 4 adjacent words (each ≥2 letters) and ignores this." } },
	{ key: "ngramMinCount", advanced: true, label: { zh: "n-gram 最高频短语最小出现次数", en: "Min occurrences of top n-gram phrase" }, type: "number", min: 2, max: 50, group: { zh: "重复循环参数", en: "Repetition/loop parameters" },
		hint: { zh: "最高频短语至少出现这么多次才判定循环；调低更激进、调高更保守。", en: "The top phrase must occur at least this many times; lower is more aggressive." } },
	{ key: "ngramCoverageRatio", advanced: true, label: { zh: "n-gram 短语覆盖占比下限", en: "Min n-gram coverage ratio" }, type: "number", min: 0.01, max: 0.5, group: { zh: "重复循环参数", en: "Repetition/loop parameters" },
		hint: { zh: "最高频短语占用尾窗的最小比例，0.05=5%；调高则更保守。", en: "Minimum tail-window share of the top phrase, 0.05 = 5%; higher is more conservative." } },

	{ key: "churnMinHits", advanced: true, label: { zh: "空转词命中阈值", en: "Churn phrase hit threshold" }, type: "number", min: 5, max: 100, group: { zh: "语义空转参数", en: "Churn parameters" },
		hint: { zh: "窗口内出现这么多次\"让我想想/重新分析\"类用语即判定空转；调低则更激进。", en: "This many \"let me think / re-analyze\" phrases in the window counts as churning; lower is more aggressive." } },
	{ key: "churnWindowChars", advanced: true, label: { zh: "空转统计窗口", en: "Churn window (chars)" }, type: "number", min: 500, max: 20000, group: { zh: "语义空转参数", en: "Churn parameters" } },
	{ key: "churnMinTextChars", advanced: true, label: { zh: "启用最小文本长度", en: "Min text length to arm" }, type: "number", min: 500, max: 50000, group: { zh: "语义空转参数", en: "Churn parameters" } },

	{ key: "softCutScanTail", advanced: true, label: { zh: "转折句扫描窗口", en: "Transition scan window" }, type: "number", min: 40, max: 2000, group: { zh: "转折句参数", en: "Transition parameters" } },
	{ key: "softCutTransitionWindow", advanced: true, label: { zh: "转折词距句末窗口", en: "Transition-to-sentence-end window" }, type: "number", min: 8, max: 500, group: { zh: "转折句参数", en: "Transition parameters" } },
	{ key: "softCutMinFollowChars", advanced: true, label: { zh: "转折词后最少展开字数", en: "Min chars after transition phrase" }, type: "number", min: 2, max: 200, group: { zh: "转折句参数", en: "Transition parameters" },
		hint: { zh: "转折词（如\"我先\"）之后至少输出这么多字才允许切断，防止在句子刚开头就切断思考、截出半句结论。", en: "Require at least this many chars after a transition word (\"I'll first…\") before cutting, so a just-started sentence is never split mid-conclusion." } },
	{ key: "softCutGapThreshold", advanced: true, label: { zh: "结论-转折最大间距", en: "Max conclusion-to-transition gap" }, type: "number", min: 0, max: 400, group: { zh: "转折句参数", en: "Transition parameters" },
		hint: { zh: "Tier-1 结论标记（如\"所以\"）与后续转折宣告（如\"接下来\"）之间允许的最大字符距离。超过则认为是子阶段小结论而非阶段边界，拒绝软切。默认 80。", en: "Maximum chars between a Tier-1 conclusion marker (\"so\") and a later transition (\"next\"); beyond it the cut is refused as a sub-phase mini-conclusion. Default 80." } },
	{ key: "pseudoToolScanTail", advanced: true, label: { zh: "伪调用扫描窗口", en: "Pseudo-call scan window" }, type: "number", min: 200, max: 20000, group: { zh: "伪工具调用参数", en: "Pseudo tool-call parameters" } },

	{ key: "copyLocale", label: { zh: "注入提示语言", en: "Injected-hint language" }, type: "select", group: { zh: "总开关", en: "Master switches" },
		options: [
			{ value: "zh", label: { zh: "中文（默认）", en: "Chinese (default)" } },
			{ value: "en", label: { zh: "English", en: "English" } }
		],
		hint: { zh: "锚点/deny/收尾指令等注入给模型的提示文案语言。默认中文（与历史行为逐字一致）；切换英文不影响检测词表与检测逻辑。", en: "Language of model-facing hints (anchors/deny/wrap-up). Default Chinese (byte-identical to historical behavior); switching to English never affects detector vocabularies or logic." } },
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
	// #132:copyLocale 枚举白名单(非法回退 zh,默认零变化)
	if (merged.copyLocale !== "en" && merged.copyLocale !== "zh") merged.copyLocale = "zh";
	return settings;
}

/** D3：transitionTextMode 合法枚举；白名单外的值一律回退默认 separateThreshold。 */
const TRANSITION_TEXT_MODES = new Set(["disable", "separateThreshold"]);

// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { SOFT_CUT_SCAN_TAIL, SOFT_CUT_TRANSITION_WINDOW, SOFT_CUT_GAP_THRESHOLD, OVER_LONG_COT_THRESHOLD, SOFT_CUT_MIN_FOLLOW_CHARS, REPEAT_PROBE_CHARS, REPEAT_WINDOW_CHARS, REPEAT_MIN_PERIOD, REPEAT_ULTRA_SHORT_MIN_COUNT, REPEAT_SHORT_PERIOD, REPEAT_MAX_PERIOD, REPEAT_MIN_COUNT, REPEAT_MIN_COUNT_SHORT, REPEAT_MIN_TEXT_CHARS, NUMBER_RUN_MIN_TEXT_CHARS, NUMBER_RUN_MIN_CHARS, NUMBER_RUN_MAX_GAP, NUMBER_RUN_MIN_DIGIT_RATIO, NUMBER_RUN_MIN_INCREASE_RATIO, NGram_PHRASE_MIN, NGram_MIN_COUNT, NGram_COVERAGE_RATIO, PSEUDO_TOOL_SCAN_TAIL, CHURN_WINDOW_CHARS, CHURN_MIN_HITS, CHURN_MIN_TEXT_CHARS, DEFAULT_SETTINGS, settings, MIN_REASONING_CHARS, MAX_POINTS, MAX_POINT_CHARS, TRANSITION_TEXT_MODE, SETTINGS_SCHEMA, applyRuntimeSettings, TRANSITION_TEXT_MODES };
