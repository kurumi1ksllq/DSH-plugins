/**
 * dsh-stall-governor — 注入模型文案字典(#132 T4.ptc ②)。
 *
 * 全部「注入给模型」的文案位点:软切锚点(render* 系列)、升级指令、外部软切
 * 引导语、deny reason、soft-stop 收尾指令、命令执行纪律块。zh 为既有逐字文案
 * (默认,行为零变化);en 为等义翻译。
 *
 * 纪律:检测器词表(CONCLUSION_OPENERS / CHURN_PHRASES / 停用词表等)是检测
 * 逻辑本体,严禁进本字典——翻义即失效(#132 §C)。
 */

const COPY = {
	zh: {
		// renderRepeatAnchor(loop)
		repeatHead: (loop) => `COT anchor — 检测到原地重复：同一段内容（约 ${loop.period} 字）已连续重复至少 ${loop.count} 次。立即停止重复，不要再输出这段内容。`,
		repeatAct: () => "直接执行你已经规划好的下一步动作；若下一步是工具调用，就只发一次。",
		// renderNumberRunawayAnchor(nr)
		numberRunHead: (nr) => `COT anchor — 检测到数字递增流退化：你已连续输出约 ${nr.chars} 字符的递增数字流，而没有推进任何内容。立即停止数数，不要再输出"序号→更大数字"的流水。`,
		numberRunAct: () => "回到你退化前正在写的那句话，直接给结论或执行下一步；若下一步是工具调用，就只发一次。",
		// renderNGramLoopAnchor(info)
		ngramHead: (info) => `COT anchor — 语义循环（n-gram 指纹）：最近尾窗里高频短语「${info.maxGram}」重复出现 ${info.count} 次（覆盖占比约 ${(info.coverage * 100).toFixed(1)}%）。`,
		ngramDiag: () => "数字每轮都在变但动词结构每轮相同，说明你在同一个行动提议上打转。",
		ngramAct: () => "立即停止。要么真的发出 tool_call，要么直接跳到结果。",
		// renderPseudoToolAnchor(alsoLooping, loop)
		pseudoHead: () => "COT anchor — 你刚才输出的工具调用是**文本**形式，系统不会识别、也不会执行它。",
		pseudoNoTag: () => "不要再写尖括号拼出来的调用标签（比如 seed 风格或 function/parameter 标签）；它们只是普通文字。",
		pseudoCall: () => "请直接发起工具调用（使用工具调用能力本身），一次就够，不要重复输出同一段内容。",
		pseudoFallback: () => "若确实无法发起工具调用，就用一句话说明你需要什么，不要再贴工具调用的文本。",
		pseudoLooped: (loop) => `（该无效调用已被识别为重复 ${loop.count} 次，重复部分已丢弃。）`,
		// renderToolArgsErrorAnchor(toolName, fields)
		toolArgsFallbackLabel: () => "上一次工具调用",
		toolArgsHead: (toolLabel, fields) => `COT anchor — 上一次工具调用未被执行：${toolLabel} 的参数校验未通过（缺失或非法参数：${fields.join("、")}）。`,
		toolArgsResend: () => "请对照该工具的完整参数 schema 补齐或修正上述参数后重新发起调用，且只重发一次，不要重复提交。",
		toolArgsNoTag: () => "禁止把工具调用写成尖括号拼出的文本标签；必须使用工具调用能力本身发起。",
		toolArgsInvalidHead: (toolLabel) => `COT anchor — 上一次工具调用未被执行：${toolLabel} 的参数非法。`,
		toolArgsGenericResend: () => "上一次工具调用参数非法，按工具完整参数要求重发一次；补齐全部必填参数，且只重发一次，不要重复提交。",
		// renderChurnAnchor(churn)
		churnHead: (churn, windowChars) => `COT anchor — 你正在原地空转：最近约 ${windowChars} 字里出现了 ${churn.hits} 次"让我想想/重新分析"这类重启用语，说明你在反复重新分析同一个问题而没有推进。`,
		churnStop: () => "立即停止重新分析。不要再复述已知信息、不要重新检查已经确认过的结论。",
		churnAct: () => "直接给出当前结论，或执行你已经决定的下一步；只输出你尚未说过的内容。",
		// renderActionChurnAnchor(churn)
		actionChurnHead: (churn, windowChars) => `COT anchor — 行动提议空转：最近约 ${windowChars} 字里出现了 ${churn.hits} 次"让我 curl / web_fetch"这类行动提议，但全程没有实际工具调用。`,
		actionChurnStop: () => "立即停止空喊工具名。不要再说\"让我 curl 一下\"、\"先试试 web_fetch\"这类没有执行的提议。",
		actionChurnAct: () => "要么真的发出 tool_call（带完整参数），要么直接跳到结果；不要再重复同一个行动提议。",
		// renderOverLongCoTAnchor(reasoningChars, threshold, hasStreams)
		overLongScopeStreams: (reasoningChars, threshold) => `本次思考已达约 ${reasoningChars} 字（阈值 ${threshold}）`,
		overLongScopeMerged: (reasoningChars, threshold) => `本次输出已达约 ${reasoningChars} 字（阈值 ${threshold}，含回答文本，思考部分估算）`,
		overLongHead: (scope) => `COT anchor — 停止生成思考内容：${scope}，已判定为过度思考。`,
		overLongNoTalk: () => "从这一刻起，不要再写任何分析、排查、计划、复述，也不要写「我应该立即行动」「接下来我会…」这类表态——表态不等于执行。",
		overLongEither: () => "下一条消息只能是以下两种之一（二选一）：① 一次真实工具调用（选当前最可执行的一步，先做再判断）；② 直接给用户的最终答案（写出已确认结论，未确认项列为待办）。",
		overLongMinAction: () => "信息不足时选①中最小的可验证动作；不得以「再查一下 / 再确认一下」为理由继续输出文字。",
		// renderOverLongEscalation(occurrence)
		overLongEsc2: (occurrence) => `本 turn 第 ${occurrence} 次因 CoT 过长被切断。上一次提醒之后你没有执行工具调用、也没有给出结论，而是继续分析——这正是再次被切断的原因。`,
		overLongEsc3: (occurrence) => `重复提醒已达 ${occurrence} 次：把上面的「二选一」当作硬约束。不要再写任何新的分析段落或行动计划，现在直接调用工具或输出最终答案。`,
		overLongEsc5: () => "内核的启发式打断预算（与其他检测器共享）可能已接近上限，后续不一定再有提醒；这一次必须收尾。",
		// renderChurnEscalation(occurrence)
		churnEsc: (occurrence) => `本 turn 第 ${occurrence} 次空转，下一步必须是一次真实工具调用或最终结论，禁止继续分析。`,
		churnEscBudget: () => "插件侧已发起 6 次空转打断（此为插件发起计数，内核可能因预算拒绝后续打断），此后仅字节级重复检测仍可能拦截。",
		// 外部软切(governor-apply)
		externalAnchorPrefix: () => "外部停滞检测请求在此软切：停止当前重复路径，基于以下最近可见文本重新组织下一步：\n\n",
		externalAnchorFallback: () => "检测到语义停滞的外部软切请求，要求立即停止当前重复论述，用新的一步推进任务。",
		// G1 soft-stop 收尾指令(governor-apply)
		softStopTail: () => "已到本回合收尾边界：请立即停止调用工具，用 3–5 句中文总结已完成成果、当前卡点与下一步建议，然后结束回复。",
		// deny reason(governor-apply)——语义监视者类别禁用
		denyStall2: (category, expiresAtStep, currentStep) => `类别 ${category} 已被语义监视者临时禁用至 step ${expiresAtStep}（当前 ${currentStep}），目标类别: ${category}。请改用其他取证类别或直接推进任务完成交付；如需继续调用 ${category}，先向用户说明现状并取得确认`,
		// G2-A/G2-B deny
		g2bScope: () => "该目标已连续失败",
		g2aScope: () => "该目标近窗已尝试",
		g2bCount: (fail, threshold) => `${fail} 次（阈值 ${threshold}）`,
		g2aCount: (calls, threshold) => `${calls} 次（阈值 ${threshold}，每次确认为放行才计数）`,
		denyG2Tail: (targetShown) => `；目标键: ${targetShown}。请更换命令/参数、改用其他工具或类别，或向用户汇报当前进展后由用户决定下一步`,
		// 命令执行纪律块(EXEC_DISCIPLINE_TEXT,governor-anchor)
		discipline0: () => "⓪ 命令执行纪律（最高优先，高于一切）：跑任何命令（shell/构建/安装/下载/测试/长任务）都不许盲等，且必须核验结果。",
		discipline1: () => "① 单次等待 ≤10 秒；禁止超长阻塞等待、禁止长延时 sleep 后再检查。",
		discipline2: () => "② 每轮必须查并打印一个『增长型标量』——目标文件/目录是否出现、字节数是否变大、日志是否追加、输出行数是否增加。",
		discipline3a: () => "③ 『进程还在』『任务 state=running』不算进展证据，禁止据此继续等；连续 2 轮零增长即判僵死，",
		discipline3b: () => "用精确 PID 中断（禁止按命令名通配批量杀）并立刻换办法（换镜像源→换工具/协议→复用本机缓存→降级最小子集→报告用户）。",
		discipline4: () => "④ 起长任务前把精确 PID 落盘。⑤ 长任务按固定短间隔（≤10 秒）轮询等待，禁止盲等。",
		discipline6: () => "⑥ 命令结束必须核验：看退出码、看产物是否真的生成、看日志关键行，不以『命令跑了没报错』当成功。",
		discipline7: () => "⑦ 输出为空/被吞/返回 -1 时，第一动作是读该命令本应写出的报告或产物判成功，不要追加复查命令。",
		discipline8: () => "⑧ 同一命令同样参数失败最多重试 2 次，之后换办法或上报。",
		discipline9: () => "⑨ 本纪律仅适用于本 agent 自启的长任务与子进程；DSH 宿主进程的启停由用户人工管理，严禁本 agent 重启或终止宿主。",
	},
	en: {
		repeatHead: (loop) => `COT anchor — in-place repetition detected: the same block (~${loop.period} chars) has repeated at least ${loop.count} times. Stop repeating it now.`,
		repeatAct: () => "Proceed directly with the next action you already planned; if it is a tool call, send it exactly once.",
		numberRunHead: (nr) => `COT anchor — number-runaway detected: you have emitted ~${nr.chars} chars of monotonically increasing numbers without advancing content. Stop counting.`,
		numberRunAct: () => "Return to the sentence you were writing before the degeneration; give the conclusion or take the next step. If it is a tool call, send it once.",
		ngramHead: (info) => `COT anchor — semantic loop (n-gram fingerprint): the phrase "${info.maxGram}" occurred ${info.count} times in the recent tail (coverage ~${(info.coverage * 100).toFixed(1)}%).`,
		ngramDiag: () => "The numbers change each round but the verb structure is identical — you are cycling on the same action proposal.",
		ngramAct: () => "Stop now. Either emit a real tool_call or jump straight to the result.",
		pseudoHead: () => "COT anchor — the tool call you just emitted was plain TEXT; the system neither recognizes nor executes it.",
		pseudoNoTag: () => "Do not write call tags assembled from angle brackets (seed-style or function/parameter tags); they are ordinary prose.",
		pseudoCall: () => "Emit a real tool call (via the tool-call capability itself) — once is enough; do not repeat the same block.",
		pseudoFallback: () => "If you truly cannot emit a tool call, state what you need in one sentence instead of pasting call text.",
		pseudoLooped: (loop) => `(The invalid call was identified as repeated ${loop.count} times; the repeated part was discarded.)`,
		toolArgsFallbackLabel: () => "the previous tool call",
		toolArgsHead: (toolLabel, fields) => `COT anchor — the previous tool call was NOT executed: ${toolLabel} failed argument validation (missing or invalid: ${fields.join(", ")}).`,
		toolArgsResend: () => "Resend exactly once with schema-valid arguments per the tool's full parameter requirements; never duplicate the submission.",
		toolArgsNoTag: () => "Never emit tool calls as angle-bracket text tags; use the tool-call capability itself.",
		toolArgsInvalidHead: (toolLabel) => `COT anchor — the previous tool call was NOT executed: ${toolLabel} arguments were invalid.`,
		toolArgsGenericResend: () => "The previous tool call had invalid arguments. Resend once following the tool's full parameter requirements, filling all required parameters — exactly once, no duplicates.",
		churnHead: (churn, windowChars) => `COT anchor — you are churning: ${churn.hits} restart phrases ("let me think / re-analyze") in the last ~${windowChars} chars, re-analyzing the same problem without progress.`,
		churnStop: () => "Stop re-analyzing. Do not restate known facts or re-verify settled conclusions.",
		churnAct: () => "Give the current conclusion, or execute the next step you already decided; output only what you have not said yet.",
		actionChurnHead: (churn, windowChars) => `COT anchor — action-proposal stall: ${churn.hits} proposals ("let me curl / web_fetch") in the last ~${windowChars} chars with zero real tool calls.`,
		actionChurnStop: () => "Stop naming tools without acting. No more \"let me curl\" or \"try web_fetch first\" proposals.",
		actionChurnAct: () => "Either emit a real tool_call (with full arguments) or jump to the result; do not repeat the same proposal.",
		overLongScopeStreams: (reasoningChars, threshold) => `reasoning reached ~${reasoningChars} chars (threshold ${threshold})`,
		overLongScopeMerged: (reasoningChars, threshold) => `output reached ~${reasoningChars} chars (threshold ${threshold}, includes answer text; reasoning estimated)`,
		overLongHead: (scope) => `COT anchor — stop generating reasoning: ${scope}; judged over-thinking.`,
		overLongNoTalk: () => "From this point, write no analysis, investigation, plans, or restatements — no \"I should act now\" declarations; declarations are not execution.",
		overLongEither: () => "Your next message must be exactly one of: ① one real tool call (pick the most executable step; act before judging); ② the final answer to the user (settled conclusions written out; unconfirmed items listed as todos).",
		overLongMinAction: () => "If information is insufficient, take the smallest verifiable action from ①; do not continue writing text on \"let me check again\" grounds.",
		overLongEsc2: (occurrence) => `Cut for CoT over-length ${occurrence} times this turn. After the last reminder you neither called a tool nor gave a conclusion — you kept analyzing; that is why the cut fired again.`,
		overLongEsc3: (occurrence) => `${occurrence} reminders issued: treat the either-or above as a hard constraint. No new analysis paragraphs or plans — call a tool or output the final answer now.`,
		overLongEsc5: () => "The kernel's heuristic interruption budget (shared with other detectors) may be near its limit; further reminders are not guaranteed. Wrap up now.",
		churnEsc: (occurrence) => `Churn cut ${occurrence} this turn: the next step must be a real tool call or the final conclusion; further analysis is forbidden.`,
		churnEscBudget: () => "The plugin has issued 6 churn cuts (plugin-side count; the kernel may reject further cuts on budget); beyond this only byte-level repetition detection may still cut.",
		externalAnchorPrefix: () => "External stall-detection request soft-cut: stop the current repeated path and reorganize the next step from this recent visible text:\n\n",
		externalAnchorFallback: () => "An external soft-cut request detected semantic stall: stop the current repeated argument immediately and advance the task with a new step.",
		softStopTail: () => "Turn wrap-up boundary reached: stop calling tools now, summarize completed work, current blockers, and the suggested next step in 3–5 sentences, then end the reply.",
		denyStall2: (category, expiresAtStep, currentStep) => `category ${category} has been temporarily disabled by the semantic monitor until step ${expiresAtStep} (current ${currentStep}). Use another evidence-gathering category or advance the task to delivery; to call ${category} again, first explain the situation to the user and get confirmation`,
		g2bScope: () => "this target has failed consecutively",
		g2aScope: () => "this target was attempted in the recent window",
		g2bCount: (fail, threshold) => `${fail} times (threshold ${threshold})`,
		g2aCount: (calls, threshold) => `${calls} times (threshold ${threshold}, counted only after each confirmed pass)`,
		denyG2Tail: (targetShown) => `; target key: ${targetShown}. Change the command/arguments, switch tools or categories, or report progress to the user and let them decide the next step`,
		discipline0: () => "⓪ Command discipline (highest priority, above all): never blind-wait on any command (shell/build/install/download/test/long task); always verify results.",
		discipline1: () => "① Single wait ≤10 s; no long blocking waits, no long sleep-then-check.",
		discipline2: () => "② Each round must print a growing scalar — target file/dir appearing, byte count growing, log appending, output lines increasing.",
		discipline3a: () => "③ \"Process still alive\" or \"task state=running\" is NOT progress evidence; 2 consecutive no-growth rounds mean stalled —",
		discipline3b: () => "interrupt by exact PID (never wildcard-kill by command name) and switch approach immediately (mirror → tool/protocol → local cache → minimal subset → report to user).",
		discipline4: () => "④ Persist the exact PID before long tasks. ⑤ Poll long tasks at fixed short intervals (≤10 s); never blind-wait.",
		discipline6: () => "⑥ After any command: check exit code, artifacts actually produced, and key log lines; \"ran without errors\" is not success.",
		discipline7: () => "⑦ If output is empty/swallowed/-1, first read the report or artifact the command should have written; do not append re-check commands.",
		discipline8: () => "⑧ Retry the same command with the same arguments at most twice, then switch approach or escalate.",
		discipline9: () => "⑨ This discipline covers only long tasks and subprocesses you started; the DSH host process is user-managed — never restart or kill it.",
	},
};

/** 取指定 locale 的文案包;未知 locale 回退 zh(默认行为零变化)。 */
function copy(locale) {
	return COPY[locale] !== undefined ? COPY[locale] : COPY.zh;
}

// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { COPY, copy };
