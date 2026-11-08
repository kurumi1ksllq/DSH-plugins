/**
 * 外部软切服务契约测试(源自上游 test/external-softcut.test.mjs,适配合并包)。
 *
 * 与上游的差异(移植时有据可查,不是偏差):
 *  - 服务名 stallGovernor(上游 cotAnchor;#96 §2.1 新 id);
 *  - DEFAULT_SETTINGS.enableExternalSoftCut 默认 **true**(v0.4.2 代码如此,且
 *    spec #96 沿用「联动开箱即用」;上游本测试文件断言 false,滞后于上游代码);
 *  - 第 13 项跨插件集成测试(经 dsh-derive-watcher createStallController 闭环)不移植:
 *    derive-watcher 本机未安装且无真实调用方(#96 §6-4 实测),预留接口由
 *    stallGovernor.requestSoftCut 承担。
 *
 * 测试契约面声明(#96 review 轴2-3 裁决):工厂额外返回 requestExternalSoftCut /
 * consumeExternalSoftCut / externalSoftCutPending —— 三者不在运行时导出面,但作为
 * 「测试契约面」在此豁免禁测私有函数硬规则:TTL 过期语义需要注入时钟(consume 的
 * now 参数),公开服务面无法表达;类比 BLOCK_CODES 属对外协议的豁免方式。
 * 覆盖:受理门(sessionId/能力门/设置门/挂起覆盖/anchorText 生成/归一化/ttl)、
 * 消费语义(一次性/TTL 注入时钟/无记录)、钩子现场(外部请求优先于内部检测、
 * budgetClass=heuristic、无 trimTo、事件载荷)、服务注册与 schema 成对。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { readEvalSource } from "./eval-module.mjs";

const source = readEvalSource(new URL("../lib-governor.js", import.meta.url));

const factory = new Function(
	"randomUUID", "appendFileSync", "existsSync", "mkdirSync", "readFileSync", "statSync", "unlinkSync", "writeFileSync",
	"homedir", "join", "createRequire", "BlockAssembler", "createUserMessage",
	`${source}; return { apply, name, inject, DEFAULT_SETTINGS, SETTINGS_SCHEMA, applyRuntimeSettings,`
	+ ` requestExternalSoftCut, consumeExternalSoftCut, externalSoftCutPending };`
);

const BlockAssembler = function () { this.parts = []; };
BlockAssembler.prototype.add = function () { return this; };

/** 构造一份隔离的模块实例(临时 HOME,不碰真实 ~/.dsh/storages)。 */
function loadApi() {
	const tempHome = path.join(os.tmpdir(), "stall-governor-ext-" + randomUUID().slice(0, 8));
	fs.mkdirSync(tempHome, { recursive: true });
	const api = factory(
		randomUUID, fs.appendFileSync, fs.existsSync, fs.mkdirSync, fs.readFileSync, fs.statSync, fs.unlinkSync, fs.writeFileSync,
		() => tempHome, path.join, createRequire, BlockAssembler, (text) => ({ role: "user", content: text })
	);
	return { api, tempHome };
}

/** mock ctx:收集 provide 的服务、事件监听与 emit。 */
function mockCtx(collector) {
	const webServer = { register(route) { collector.routes.push(route); return () => {}; } };
	return {
		webServer,
		on(event, handler) { collector.listeners.push({ event, handler }); return () => {}; },
		emit(eventName, payload) { collector.emitted.push({ eventName, payload }); },
		effect(fn) { const d = fn(); return typeof d === "function" ? d : () => {}; },
		inject(services, callback) {
			if (services.includes("systemPrompt")) {
				callback({
					effect(fn) { const d = fn(); return typeof d === "function" ? d : () => {}; },
					systemPrompt: { context() { return () => {}; } }
				});
			}
			return () => {};
		},
		get(key) { return key === "webServer" ? webServer : undefined; },
		provide(name, service) { collector.services[name] = service; },
		logger: { info() {}, warn() {}, error() {} }
	};
}

const collect = () => ({ routes: [], listeners: [], emitted: [], services: {} });

// ═══ 一、受理门 ═══════════════════════════════════════════════════════════

test("1:sessionId 非空字符串校验 → invalid-session-id", () => {
	const { api, tempHome } = loadApi();
	for (const bad of [undefined, null, "", 42, {}]) {
		const r = api.requestExternalSoftCut({ sessionId: bad });
		assert.deepEqual(r, { accepted: false, reason: "invalid-session-id" }, JSON.stringify(bad));
	}
	assert.equal(api.externalSoftCutPending.size, 0, "拒绝时不入表");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("2:内核 soft-cut 能力 absent → soft-cut-capability-absent(present/unknown 受理)", () => {
	const { api, tempHome } = loadApi();
	api.apply(mockCtx(collect()), { enableExternalSoftCut: true });
	const r = api.requestExternalSoftCut({ sessionId: "s-cap" });
	if (r.accepted === false) {
		assert.equal(r.reason, "soft-cut-capability-absent",
			"内核缺失 soft-cut 钩子时唯一合法拒绝原因就是能力门,不得是 disabled");
	} else {
		assert.equal(r.accepted, true);
		assert.equal(r.delivery, "pending-next-soft-cut");
	}
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("3:发布默认开启(联动开箱即用);显式关闭 → disabled", () => {
	const { api, tempHome } = loadApi();
	assert.equal(api.DEFAULT_SETTINGS.enableExternalSoftCut, true, "v0.4.2 代码默认 true");
	const r = api.requestExternalSoftCut({ sessionId: "s-default" });
	assert.equal(r.accepted, true, "默认受理(spec #96:外部请求只占启发式额度)");
	assert.equal(api.externalSoftCutPending.size, 1);
	// 显式关闭后拒绝
	api.applyRuntimeSettings({ enableExternalSoftCut: false });
	const off = api.requestExternalSoftCut({ sessionId: "s-off" });
	assert.deepEqual(off, { accepted: false, reason: "disabled" });
	assert.equal(api.externalSoftCutPending.size, 1, "拒绝时不入表");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("4:受理 + 挂起 + 同 sessionId 覆盖旧请求", () => {
	const { api, tempHome } = loadApi();
	api.applyRuntimeSettings({ enableExternalSoftCut: true });
	const first = api.requestExternalSoftCut({ sessionId: "s-1", fullVisibleText: "第一次请求的文本" });
	assert.equal(first.accepted, true);
	assert.equal(first.delivery, "pending-next-soft-cut");
	assert.equal(first.ttlMs, 30000, "缺省 ttl = 30 秒");
	assert.equal(typeof first.requestedAt, "number");
	assert.equal(api.externalSoftCutPending.size, 1);
	assert.ok(api.externalSoftCutPending.get("s-1").anchorText.includes("第一次请求的文本"));

	const second = api.requestExternalSoftCut({ sessionId: "s-1", fullVisibleText: "第二次请求的文本", ttlMs: 1234 });
	assert.equal(second.ttlMs, 1234);
	assert.equal(api.externalSoftCutPending.size, 1, "同 sessionId 覆盖而非新增");
	assert.ok(api.externalSoftCutPending.get("s-1").anchorText.includes("第二次请求的文本"));
	assert.equal(api.externalSoftCutPending.get("s-1").ttlMs, 1234);
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("5:anchorText 生成——有文本取尾部 2000 字符 + 固定引导语;无文本用兜底锚点", () => {
	const { api, tempHome } = loadApi();
	api.applyRuntimeSettings({ enableExternalSoftCut: true });
	const longText = "甲".repeat(2500) + "尾部标记XYZ";
	api.requestExternalSoftCut({ sessionId: "s-anchor", fullVisibleText: longText });
	const anchored = api.externalSoftCutPending.get("s-anchor").anchorText;
	assert.ok(anchored.startsWith("外部停滞检测请求在此软切：停止当前重复路径，基于以下最近可见文本重新组织下一步："),
		"固定中文引导语");
	assert.ok(anchored.endsWith("尾部标记XYZ"), "按字符截取尾部");
	api.requestExternalSoftCut({ sessionId: "s-anchor", fullVisibleText: "   " });
	const fallback = api.externalSoftCutPending.get("s-anchor").anchorText;
	assert.equal(fallback, "检测到语义停滞的外部软切请求，要求立即停止当前重复论述，用新的一步推进任务。");
	api.requestExternalSoftCut({ sessionId: "s-anchor" });
	assert.equal(api.externalSoftCutPending.get("s-anchor").anchorText,
		"检测到语义停滞的外部软切请求，要求立即停止当前重复论述，用新的一步推进任务。",
		"字段缺失时同样兜底");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("6:reason/evidenceSeq/turn/step 归一化(非数字/非字符串回落 null)", () => {
	const { api, tempHome } = loadApi();
	api.applyRuntimeSettings({ enableExternalSoftCut: true });
	api.requestExternalSoftCut({
		sessionId: "s-norm", reason: "semantic-stall-2", evidenceSeq: 7, turn: 3, step: 9
	});
	const good = api.externalSoftCutPending.get("s-norm");
	assert.equal(good.reason, "semantic-stall-2");
	assert.equal(good.evidenceSeq, 7);
	assert.equal(good.turn, 3);
	assert.equal(good.step, 9);
	api.requestExternalSoftCut({
		sessionId: "s-norm", reason: "", evidenceSeq: "x", turn: null, step: {}
	});
	const bad = api.externalSoftCutPending.get("s-norm");
	assert.equal(bad.reason, null, "空 reason 归一为 null");
	assert.equal(bad.evidenceSeq, null, "非数字 evidenceSeq 归一为 null");
	assert.equal(bad.turn, null);
	assert.equal(bad.step, null);
	fs.rmSync(tempHome, { recursive: true, force: true });
});

// ═══ 二、消费语义 ═════════════════════════════════════════════════════════

test("7:consume 一次性——命中后删除,第二次返回 null", () => {
	const { api, tempHome } = loadApi();
	api.applyRuntimeSettings({ enableExternalSoftCut: true });
	api.requestExternalSoftCut({ sessionId: "s-consume", fullVisibleText: "待消费文本" });
	const first = api.consumeExternalSoftCut("s-consume");
	assert.ok(first && first.anchorText.includes("待消费文本"));
	assert.equal(api.externalSoftCutPending.size, 0, "消费即删除");
	assert.equal(api.consumeExternalSoftCut("s-consume"), null, "一次性,不重复切断");
	assert.equal(api.consumeExternalSoftCut("never-requested"), null, "无记录返回 null");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("8:TTL 过期作废(注入时钟,禁真实 sleep)", () => {
	const { api, tempHome } = loadApi();
	api.applyRuntimeSettings({ enableExternalSoftCut: true });
	const requestedAt = api.requestExternalSoftCut({ sessionId: "s-ttl" }).requestedAt;
	assert.ok(api.consumeExternalSoftCut("s-ttl", requestedAt + 30000), "恰好 30 秒仍有效");
	api.requestExternalSoftCut({ sessionId: "s-ttl" });
	assert.equal(api.consumeExternalSoftCut("s-ttl", requestedAt + 30001), null, "超过 TTL 作废");
	assert.equal(api.externalSoftCutPending.size, 0, "过期记录被清理");
	api.requestExternalSoftCut({ sessionId: "s-ttl2", ttlMs: 1234 });
	assert.ok(api.consumeExternalSoftCut("s-ttl2", Date.now() + 1000));
	api.requestExternalSoftCut({ sessionId: "s-ttl2", ttlMs: 1234 });
	assert.equal(api.consumeExternalSoftCut("s-ttl2", Date.now() + 2000), null, "自定义 ttl 生效");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

// ═══ 三、钩子现场 ═════════════════════════════════════════════════════════

test("9:内部检测全关 + 挂起外部请求 → 仍切断(显式外部干预独立于 enableSoftCut)", async () => {
	const { api, tempHome } = loadApi();
	const internalOff = {
		enableSoftCut: false,
		enablePseudoTool: false, enableRepeat: false, enableChurn: false,
		enableTransition: false, enableNumberRunaway: false,
		enableExternalSoftCut: true
	};
	const collector = collect();
	api.apply(mockCtx(collector), internalOff);
	const softCut = collector.listeners.find((item) => item.event === "agent/soft-cut");
	if (!softCut) {
		test.skip("本机内核无 agent/soft-cut 钩子(probeKernelHook=absent),钩子级断言不适用");
		fs.rmSync(tempHome, { recursive: true, force: true });
		return;
	}
	const r = api.requestExternalSoftCut({
		sessionId: "s-hook", reason: "semantic-stall-2", evidenceSeq: 5, fullVisibleText: "外部停滞文本"
	});
	assert.equal(r.accepted, true);
	const nextNull = async () => null;
	const result = await softCut.handler(
		{ sessionId: "s-hook", turn: 2, step: 7, fullVisibleText: "内部检测视角的现场文本" },
		nextNull
	);
	assert.ok(result && result.kind === "cut", "外部请求必须在内部全关时仍切断");
	assert.equal(result.budgetClass, "heuristic", "外部请求固定启发式桶,禁 confirmed-pseudo");
	assert.equal(result.trimTo, undefined, "不带 trimTo:外部不掌握现场全文");
	assert.equal(result.contexts.length, 1);
	assert.equal(result.contexts[0].source.summary, "cot-anchor: external-request (semantic-stall-2)");
	assert.ok(result.contexts[0].content[0].text.includes("外部停滞检测请求在此软切"));
	assert.ok(result.contexts[0].content[0].text.includes("外部停滞文本"));
	const ev = collector.emitted.find((item) => item.eventName === "cot-anchor/softcut-taken");
	assert.ok(ev, "发射 softcut-taken");
	assert.equal(ev.payload.cutClass, "external");
	assert.equal(ev.payload.reason, "semantic-stall-2");
	assert.equal(ev.payload.evidenceSeq, 5);
	assert.equal(ev.payload.sessionId, "s-hook");
	const again = await softCut.handler({ sessionId: "s-hook" }, nextNull);
	assert.equal(again, null, "消费一次性,内部全关时不再切");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("10:无挂起请求 + 内部全关 → 返回 null(不误切)", async () => {
	const { api, tempHome } = loadApi();
	const internalOff = {
		enableSoftCut: false,
		enablePseudoTool: false, enableRepeat: false, enableChurn: false,
		enableTransition: false, enableNumberRunaway: false,
		enableExternalSoftCut: true
	};
	const collector = collect();
	api.apply(mockCtx(collector), internalOff);
	const softCut = collector.listeners.find((item) => item.event === "agent/soft-cut");
	if (!softCut) {
		test.skip("本机内核无 agent/soft-cut 钩子,钩子级断言不适用");
		fs.rmSync(tempHome, { recursive: true, force: true });
		return;
	}
	const nextNull = async () => null;
	const result = await softCut.handler({ sessionId: "s-empty", fullVisibleText: "正常文本" }, nextNull);
	assert.equal(result, null);
	assert.equal(collector.emitted.length, 0, "未切断不发射事件");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

// ═══ 四、服务注册与设置 ═══════════════════════════════════════════════════

test("11:apply 注册 ctx.provide(\"stallGovernor\"),requestSoftCut 经服务入口受理", () => {
	const { api, tempHome } = loadApi();
	const collector = collect();
	api.apply(mockCtx(collector), { enableExternalSoftCut: true });
	const service = collector.services.stallGovernor;
	assert.ok(service && typeof service.requestSoftCut === "function", "provide 的服务形态");
	const r = service.requestSoftCut({ sessionId: "s-service", fullVisibleText: "经服务受理" });
	assert.equal(r.accepted, true);
	assert.equal(r.delivery, "pending-next-soft-cut");
	assert.ok(api.externalSoftCutPending.get("s-service").anchorText.includes("经服务受理"));
	assert.deepEqual(service.requestSoftCut({}), { accepted: false, reason: "invalid-session-id" });
	fs.rmSync(tempHome, { recursive: true, force: true });
});

test("12:DEFAULT_SETTINGS 与 SETTINGS_SCHEMA 成对且默认开启", () => {
	const { api, tempHome } = loadApi();
	assert.equal(api.DEFAULT_SETTINGS.enableExternalSoftCut, true);
	const entry = api.SETTINGS_SCHEMA.find((item) => item.key === "enableExternalSoftCut");
	assert.ok(entry, "schema 控件存在");
	assert.equal(entry.type, "boolean");
	assert.equal(entry.label, "允许外部插件请求软切");
	assert.equal(entry.group, "总开关");
	assert.equal(api.applyRuntimeSettings({}).enableExternalSoftCut, true, "运行时默认值发布");
	fs.rmSync(tempHome, { recursive: true, force: true });
});

// 第 13 项跨插件集成(watcher stall-2 → createStallController → 钩子消费)不移植:
// dsh-derive-watcher 本机未安装、无真实调用方(#96 §6-4);stallGovernor.requestSoftCut
// 即预留接口,闭环链路由第 9 项(钩子现场)覆盖。
