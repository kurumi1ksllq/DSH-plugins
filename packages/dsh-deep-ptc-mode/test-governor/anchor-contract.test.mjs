/**
 * 合并包「单流内」引擎契约测试(源自上游 test-budget-class.mjs,node:test 化)。
 *
 * budgetClass + cutClass 双字段契约 + churn 升级序列/turn 归零 + ToolArgsError
 * 续步兜底 —— 插件侧断言。
 *
 * 挂载方式:readEvalSource 剥 import/export → new Function 取 apply,最小 mock ctx
 * (ctx.on 捕获全部监听器,按事件名取 handler)真实挂载。断言组:
 *  ① 双字段:pseudoTool→budgetClass=confirmed-pseudo + cutClass=pseudoTool;
 *    repeat/numberRunaway→confirmed-repeat/confirmed-repeat;
 *    churn/transition→heuristic/heuristic
 *    (cutClass 是内核 decideSoftCut 唯一消费的分类字段;pseudoTool 必须写
 *    "pseudoTool" 而非 "confirmed-pseudo",否则归入 heuristic 桶);
 *  ② churn 文案序列:第 1 次无升级;第 2 次起追加"本 turn 第 N 次空转…";达 6 次
 *    追加插件侧预算说明;session/event 的 assistant/message(data.turn) 推进 turn
 *    边界后计数归零;同 turn 软切结算消息不误归零;
 *  ③ ToolArgsError:顶层 error{name,code} + content 文本抽参;工具名入锚;
 *    抽不到参数名降级通用句式;正常结果不触发;旧内核 error.info 形态兼容。
 *
 * 注意:settings 是模块级变量,同一进程内第二次 apply 会覆盖全部 handler 可见的
 * settings——因此总开关关闭的对照组(tempHome2)必须在全部默认配置断言之后挂载。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readEvalSource } from "./eval-module.mjs";
import { PSEUDO_TOOL_CALL_UNIT, SHORT_CYCLE_UNIT } from "./fixtures.mjs";

const tempHome = path.join(os.tmpdir(), "stall-governor-contract-" + randomUUID().slice(0, 8));
fs.mkdirSync(tempHome, { recursive: true });

const factory = new Function(
	"randomUUID", "appendFileSync", "existsSync", "mkdirSync", "readFileSync", "statSync", "unlinkSync", "writeFileSync",
	"homedir", "join", "createRequire", "BlockAssembler", "createUserMessage",
	`${readEvalSource(new URL("../lib/governor.js", import.meta.url))}; return { apply };`
);

const BlockAssembler = function () { this.parts = []; };
BlockAssembler.prototype.add = function () { return this; };

function mount(home, persistedOverrides) {
	if (persistedOverrides) {
		fs.mkdirSync(path.join(home, ".dsh", "storages"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".dsh", "storages", "stall-governor.json"),
			JSON.stringify(persistedOverrides),
			"utf8"
		);
	}
	const listeners = [];
	const webServer = { register() { return () => {}; } };
	const ctx = {
		webServer,
		on(event, handler) { listeners.push({ event, handler }); return () => {}; },
		effect() { return () => {}; },
		inject(services, callback) {
			if (services.includes("systemPrompt")) {
				callback({ effect() { return () => {}; }, systemPrompt: { context() { return () => {}; } } });
			}
			return () => {};
		},
		get(key) { return key === "webServer" ? webServer : undefined; },
		logger: { info() {}, warn() {}, error() {} }
	};
	api.apply(ctx);
	return {
		ctx,
		listeners,
		handlerOf(event) { return listeners.find((item) => item.event === event)?.handler; }
	};
}

const api = factory(
	randomUUID, fs.appendFileSync, fs.existsSync, fs.mkdirSync, fs.readFileSync, fs.statSync, fs.unlinkSync, fs.writeFileSync,
	() => tempHome, path.join, createRequire, BlockAssembler, (text) => ({ role: "user", content: text })
);

const main = mount(tempHome);
const softCutHandler = main.handlerOf("agent/soft-cut");
const postExecuteHandler = main.handlerOf("tools/post-execute");
const sessionEventHandler = main.handlerOf("session/event");

const nullNext = async () => null;
async function cutOf(fullVisibleText, turn = 1, sessionId = "sess-budget") {
	return softCutHandler({ sessionId, turn, step: 0, fullVisibleText }, nullNext);
}
const bodyOf = (decision) => decision?.contexts?.[0]?.content?.[0]?.text ?? "";

/**
 * churn 夹具(对上游夹具的修复):上游 test-budget-class 用的逐行编号文本会被
 * n-gram 指纹检测器先截停(修复②在 churn 之前返回),churn 升级序列实际不可达
 * ——上游现役代码上该组断言本身就不绿(测试滞后于代码)。
 * 本夹具让所有相邻 4 词窗口的组合空间 > 41 且邻居词轮换(上下文不稳定),
 * 实测 detectNGramLoop/findRepeatingTail/detectNumberRunaway 均为 null,
 * churn 词命中 60/尾窗 ≥ 阈值 18,churn 分支真实可达。
 */
function churnFixtureText(segments = 200) {
	const A = ["Alright", "OK then", "So then", "Well now", "Moving on", "Next up", "Right away", "Good point", "Fine then", "Sure thing", "Indeed so", "Once more"];
	const B = ["let me", "I should", "let me now", "I will now", "we can", "I must", "I might"];
	const C = ["re-read", "recheck", "review", "restudy", "revisit", "rerun"];
	const D = ["section", "chapter", "module", "segment", "passage", "listing", "entry"];
	const E = ["and note the finding", "and record the result", "and verify the outcome", "and log the diff", "and mark the status", "and check the plan"];
	const F = ["carefully", "closely", "in detail", "once more", "yet again", "thoroughly", "at length"];
	const lines = [];
	for (let i = 0; i < segments; i++) {
		const a = A[i % A.length];
		const b = B[(i * 5) % B.length];
		const c = C[(i * 7) % C.length];
		const d = D[(i * 11) % D.length];
		const e = E[(i * 13) % E.length];
		const f = F[(i * 17) % F.length];
		lines.push(`${a}, ${b} ${c} ${d} ${(i % 89) + 1} ${e} ${f}. Hmm.`);
	}
	return lines.join("\n");
}

test("①a agent/soft-cut 挂载(能力探测 unknown/present 时)", () => {
	if (softCutHandler === undefined) {
		test.skip("内核 probe=absent,软切钩子不注册(能力横幅三态)");
		return;
	}
	assert.equal(typeof softCutHandler, "function");
	assert.equal(typeof postExecuteHandler, "function");
	assert.equal(typeof sessionEventHandler, "function");
});

test("①b pseudoTool → budgetClass=confirmed-pseudo + cutClass=pseudoTool(内核识别的桶名)", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const decision = await cutOf(PSEUDO_TOOL_CALL_UNIT);
	assert.equal(decision?.kind, "cut");
	assert.equal(decision?.budgetClass, "confirmed-pseudo", String(decision?.budgetClass));
	assert.equal(decision?.cutClass, "pseudoTool", String(decision?.cutClass));
});

test("①c repeat → confirmed-repeat/confirmed-repeat(budgetClass 与 cutClass 同值)", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const decision = await cutOf(SHORT_CYCLE_UNIT.repeat(60));
	assert.equal(decision?.kind, "cut");
	assert.equal(decision?.budgetClass, "confirmed-repeat", String(decision?.budgetClass));
	assert.equal(decision?.cutClass, "confirmed-repeat", String(decision?.cutClass));
});

test("①d numberRunaway → confirmed-repeat/confirmed-repeat", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const buildNumberRun = (from = 639, count = 500) => {
		let out = "";
		for (let i = 0; i < count; i++) out += `${from + i}) ${from + i + 1}.`;
		return out;
	};
	const decision = await cutOf(buildNumberRun());
	assert.equal(decision?.kind, "cut");
	assert.equal(decision?.budgetClass, "confirmed-repeat", String(decision?.budgetClass));
	assert.equal(decision?.cutClass, "confirmed-repeat", String(decision?.cutClass));
});

test("①e churn → heuristic/heuristic", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const churnText = churnFixtureText();
	const decision = await cutOf(churnText);
	assert.equal(decision?.kind, "cut");
	assert.equal(decision?.budgetClass, "heuristic", String(decision?.budgetClass));
	assert.equal(decision?.cutClass, "heuristic", String(decision?.cutClass));
});

test("①f transition → heuristic/heuristic(结论句 + 阶段宣布)", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const transitionText = Array.from({ length: 12 }, (_, i) =>
		`因此第 ${i} 项排查的根因是模块 ${i} 的配置缺失，修复方式是补齐第 ${i} 项声明。`
	).join("") + "\n接下来我先修复挂载行，再重启验证。";
	const decision = await cutOf(transitionText);
	assert.equal(decision?.kind, "cut");
	assert.equal(decision?.budgetClass, "heuristic", String(decision?.budgetClass));
	assert.equal(decision?.cutClass, "heuristic", String(decision?.cutClass));
});

const execPwsh = { name: "pwsh" };
const acceptNext = async () => ({ kind: "accept" });
const resultSpec = {
	isError: true,
	error: { name: "ToolArgsError", code: "INVALID_ARGS" },
	content: [{ type: "text", text: 'Error: invalid arguments: missing required property "description"' }]
};

test("② ToolArgsError 规格形态:注入恢复指引锚点(工具名/参数名/四要素)", async () => {
	const out = await postExecuteHandler(execPwsh, resultSpec, acceptNext);
	const body = out?.additionalContexts?.find((c) => c?.source?.summary === "cot-anchor: tool-args-error")?.content?.[0]?.text ?? "";
	assert.ok(body.length > 0, "注入 tool-args-error 锚点");
	assert.ok(body.includes("pwsh"), "锚点含工具名");
	assert.ok(body.includes("description"), "锚点含抽取到的参数名");
	assert.ok(body.includes("未被执行"), "四要素①未被执行");
	assert.ok(body.includes("只重发一次"), "四要素③只重发一次");
	assert.ok(body.includes("禁止把工具调用写成") && body.includes("文本标签"), "四要素④禁止文本标签");
});

test("②b 抽不到参数名 → 通用句式降级,锚点不允许整条缺失、不编造参数名", async () => {
	const resultNoFields = {
		isError: true,
		error: { name: "ToolArgsError", code: "INVALID_ARGS" },
		content: [{ type: "text", text: "Error: invalid arguments: x" }]
	};
	const out = await postExecuteHandler(execPwsh, resultNoFields, acceptNext);
	const body = out?.additionalContexts?.find((c) => c?.source?.summary === "cot-anchor: tool-args-error")?.content?.[0]?.text ?? "";
	assert.ok(body.length > 0, "仍注入锚点");
	assert.ok(body.includes("上一次工具调用参数非法") && body.includes("按工具完整参数要求重发一次"), "通用句式");
	assert.equal(body.includes("description"), false, "不编造参数名");
});

test("②c 旧内核 error.info 形态兼容", async () => {
	const resultLegacyInfo = {
		isError: true,
		error: { info: { name: "ToolArgsError", code: "INVALID_ARGS" } },
		content: [{ type: "text", text: 'Error: invalid arguments: missing required property "description"' }]
	};
	const out = await postExecuteHandler(execPwsh, resultLegacyInfo, acceptNext);
	const body = out?.additionalContexts?.find((c) => c?.source?.summary === "cot-anchor: tool-args-error")?.content?.[0]?.text ?? "";
	assert.ok(body.includes("pwsh") && body.includes("description"));
});

test("②d 正常结果不触发错误分支", async () => {
	const out = await postExecuteHandler(execPwsh, { isError: false, content: [{ type: "text", text: "ok" }] }, acceptNext);
	const has = out?.additionalContexts?.some((c) => c?.source?.summary === "cot-anchor: tool-args-error") ?? false;
	assert.equal(has, false);
});

test("③ churn 升级序列:第 1 次/第 2 次/第 6 次", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const churnText = churnFixtureText();
	const esc1 = await cutOf(churnText, 7, "sess-churn-a");
	assert.equal(bodyOf(esc1).includes("本 turn 第"), false, "第 1 次不含升级指令");
	const esc2 = await cutOf(churnText, 7, "sess-churn-a");
	assert.ok(bodyOf(esc2).includes("本 turn 第 2 次空转")
		&& bodyOf(esc2).includes("下一步必须是一次真实工具调用或最终结论"), "第 2 次含升级指令");
	for (let i = 3; i <= 5; i++) await cutOf(churnText, 7, "sess-churn-a");
	const esc6 = await cutOf(churnText, 7, "sess-churn-a");
	assert.ok(bodyOf(esc6).includes("插件侧已发起 6 次空转打断")
		&& bodyOf(esc6).includes("内核可能因预算拒绝后续打断"), "第 6 次含插件侧预算说明");
	assert.ok(bodyOf(esc6).includes("字节级重复检测仍可能拦截"), "第 6 次仍说明字节级重复检测可用");
});

test("③b turn 归零:观察者推进边界归零 + 同 turn 结算不误归零 + 就地归零", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const churnText = churnFixtureText();
	const turn1Hit = await cutOf(churnText, 10, "sess-churn-b");
	assert.equal(bodyOf(turn1Hit).includes("本 turn 第"), false, "sess-b turn10 首次命中无升级");
	sessionEventHandler({ id: "sess-churn-b" }, { type: "assistant/message", data: { turn: 10, step: 0 } });
	const turn1Hit2 = await cutOf(churnText, 10, "sess-churn-b");
	assert.ok(bodyOf(turn1Hit2).includes("本 turn 第 2 次空转"), "同 turn 结算消息(turn 不增)不归零");
	sessionEventHandler({ id: "sess-churn-b" }, { type: "assistant/message", data: { turn: 11, step: 0 } });
	const turn2First = await cutOf(churnText, 11, "sess-churn-b");
	assert.equal(bodyOf(turn2First).includes("本 turn 第"), false, "观察者推进 turn 11 后计数归零");
	// 无观察者事件时,churn 决策自身携带 turn 就地归零(消除首中偏移)。
	const soloNewTurn = await cutOf(churnText, 20, "sess-churn-c");
	assert.equal(bodyOf(soloNewTurn).includes("本 turn 第"), false, "换 turn 后首个 churn 决策就地归零");
	const soloNewTurn2 = await cutOf(churnText, 20, "sess-churn-c");
	assert.ok(bodyOf(soloNewTurn2).includes("本 turn 第 2 次空转"), "同 turn 第二次仍升级");
});

test("①g 伪工具锚不复述原始标签(自反馈三防 §3-4;spec §5 必须保留的契约)", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	const decision = await cutOf(PSEUDO_TOOL_CALL_UNIT);
	const body = bodyOf(decision);
	assert.ok(body.length > 0);
	// 原始伪标签逐字出现在锚点里 = 模型会复读同样的伪格式;锚点必须只解释格式、不复述标签。
	for (const raw of ["<seed:tool_call>", "<function name=", "<parameter name=", "</function>", "</seed:tool_call>"]) {
		assert.equal(body.includes(raw), false, `锚点复述了原始标签 ${raw}`);
	}
});

test("①h 事故反事实:超长复读在周期起点截停(trimTo),不全量落盘(spec §5 事故夹具回归)", async () => {
	if (!softCutHandler) return test.skip("probe=absent");
	// 上游事故:SHORT_CYCLE_UNIT 型复读在 ~19,360 字符处被截停,避免 75.3% 重复内容落盘。
	// 反事实断言:同型文本重复 400 次(~23k 字符,超过事故截停点)必须 cut 且 trimTo 指向周期起点。
	const text = SHORT_CYCLE_UNIT.repeat(400);
	const decision = await cutOf(text, 1, "sess-incident");
	assert.equal(decision?.kind, "cut", "复读必须被截停");
	assert.equal(decision?.budgetClass, "confirmed-repeat");
	assert.ok(
		Number.isInteger(decision?.trimTo) && decision.trimTo > 0 && decision.trimTo < text.length,
		`trimTo 指向周期起点(${decision?.trimTo} < ${text.length})`
	);
});

test("①i fail-open:钩子体整体容错——毒化载荷不炸 waterfall(§3-2,反向验证)", async () => {
	// agent/soft-cut:fullVisibleText getter 抛错 → catch 记 failOpen 后返回 upstream(不切、不炸)
	if (!softCutHandler) return test.skip("probe=absent");
	const poisonedPayload = { sessionId: "s-failopen", turn: 1, step: 0 };
	Object.defineProperty(poisonedPayload, "fullVisibleText", { get() { throw new Error("poison-payload"); } });
	const softCutResult = await softCutHandler(poisonedPayload, async () => null);
	assert.equal(softCutResult, null, "soft-cut fail-open:返回 upstream(=null),不向内核抛错");
	// tools/post-execute:result getter 抛错 → catch 后原样返回 downstream
	const poisonedResult = {};
	Object.defineProperty(poisonedResult, "isError", { get() { throw new Error("poison-result"); } });
	const downstreamShape = { kind: "accept", additionalContexts: [] };
	const out = await postExecuteHandler({ name: "pwsh" }, poisonedResult, async () => downstreamShape);
	assert.deepEqual(out, downstreamShape, "post-execute fail-open:原样返回 downstream");
});

// 注:上游 test-budget-class 的「enableToolInject=false 对照组」是空对照——该开关键
// 在上游 v0.4.2 与本包都不存在,persisted override 被当未知键丢弃;这里保留挂载形态
// 只为验证错误分支在独立实例上行为一致,不再暗示存在总开关。
test("④ 错误分支不依赖任何设置开关(经持久化 override 挂载的独立实例)", async () => {
	const tempHome2 = path.join(os.tmpdir(), "stall-governor-contract-off-" + randomUUID().slice(0, 8));
	fs.mkdirSync(tempHome2, { recursive: true });
	try {
		const suppressed = mount(tempHome2, { bogusUnknownKey: false }); // 未知键被丢弃,等效默认配置
		const postExecuteOff = suppressed.handlerOf("tools/post-execute");
		const offErrorOut = await postExecuteOff(execPwsh, resultSpec, acceptNext);
		const offErrorBody = offErrorOut?.additionalContexts?.find((c) => c?.source?.summary === "cot-anchor: tool-args-error")?.content?.[0]?.text ?? "";
		assert.ok(offErrorBody.includes("pwsh") && offErrorBody.includes("description"), "错误分支仍注入");
		const offNormalOut = await postExecuteOff(execPwsh, { isError: false, content: [{ type: "text", text: "ok" }] }, acceptNext);
		assert.equal(offNormalOut?.additionalContexts?.some((c) => String(c?.source?.summary ?? "").startsWith("cot-anchor:")) ?? false, false, "正常结果不注入");
	} finally {
		try { fs.rmSync(tempHome2, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
	}
});

process.on("exit", () => {
	try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
});
