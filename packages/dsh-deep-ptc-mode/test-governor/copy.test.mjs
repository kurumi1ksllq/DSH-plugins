// #132 governor locale 化:模型文案字典(COPY)与设置 schema 文案字段的 zh/en 键集一致契约。
// 反向验证:删任一 en 键(或 schema 文案字段少一边)即红。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { COPY } from "../lib/governor-copy.mjs";
import { SETTINGS_SCHEMA } from "../lib/governor-settings.mjs";
import { GOVERNOR_SETTINGS_SCHEMA } from "../lib/governor-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("COPY: zh 与 en 键集一致且非空", () => {
	const zh = Object.keys(COPY.zh).sort();
	const en = Object.keys(COPY.en).sort();
	assert.ok(zh.length >= 20, "COPY 至少 20 个文案位点(实际 " + zh.length + ")");
	assert.deepEqual(en.filter((k) => !zh.includes(k)), [], "en 多出的键");
	assert.deepEqual(zh.filter((k) => !en.includes(k)), [], "zh 多出的键");
});

test("COPY: 每个位点按真实签名产出非空文本", () => {
	// 每个位点用「真实调用形态」的参数调用(与 governor-softcut/apply 的实参形态一致);
	// 键集漂移或签名漂移都会在这里红。
	const loop = { period: 12, count: 3 };
	const nr = { chars: 700 };
	const info = { maxGram: "let me", count: 7, coverage: 0.08 };
	const churn = { hits: 20 };
	const loop2 = { count: 5 };
	const args = {
		repeatHead: [loop], repeatAct: [],
		numberRunHead: [nr], numberRunAct: [],
		ngramHead: [info], ngramDiag: [], ngramAct: [],
		pseudoHead: [], pseudoNoTag: [], pseudoCall: [], pseudoFallback: [], pseudoLooped: [loop2],
		toolArgsFallbackLabel: [],
		toolArgsHead: ["bash", ["command"]], toolArgsResend: [], toolArgsNoTag: [],
		toolArgsInvalidHead: ["bash"], toolArgsGenericResend: [],
		churnHead: [churn, 3000], churnStop: [], churnAct: [],
		actionChurnHead: [churn, 3000], actionChurnStop: [], actionChurnAct: [],
		overLongScopeStreams: [9000, 8000], overLongScopeMerged: [9000, 8000],
		overLongHead: ["本次思考已达约 9000 字（阈值 8000）"], overLongNoTalk: [], overLongEither: [], overLongMinAction: [],
		overLongEsc2: [2], overLongEsc3: [3], overLongEsc5: [],
		churnEsc: [2], churnEscBudget: [],
		externalAnchorPrefix: [], externalAnchorFallback: [],
		softStopTail: [],
		denyStall2: ["search", 42, 40],
		g2bScope: [], g2aScope: [],
		g2bCount: [4, 3], g2aCount: [6, 5],
		denyG2Tail: ["bash -c ls"],
		discipline0: [], discipline1: [], discipline2: [], discipline3a: [], discipline3b: [],
		discipline4: [], discipline6: [], discipline7: [], discipline8: [], discipline9: [],
	};
	for (const locale of ["zh", "en"]) {
		assert.deepEqual(Object.keys(COPY[locale]).sort(), Object.keys(args).sort(), locale + " 位点集与测试签名清单必须一致");
		for (const [key, fn] of Object.entries(COPY[locale])) {
			const text = fn(...args[key]);
			assert.equal(typeof text, "string", locale + "." + key + " 必须产出字符串");
			assert.ok(text.length > 0, locale + "." + key + " 产出不得为空");
		}
	}
});

/** schema 项的文案字段与嵌套 options[].label 全部展开成 [路径, 文本] 对。 */
function textFields(spec) {
	const out = [];
	for (const field of ["label", "hint", "group"]) {
		const v = spec[field];
		if (typeof v === "string" || (v && typeof v === "object")) out.push([field, v]);
	}
	if (Array.isArray(spec.options)) {
		spec.options.forEach((opt, i) => {
			if (typeof opt.label === "string" || (opt.label && typeof opt.label === "object")) {
				out.push(["options[" + i + "].label", opt.label]);
			}
		});
	}
	return out;
}

test("设置 schema:文案字段为 {zh,en} 双字典且值非空", () => {
	// T4.ptc ② 的目标形态:文案字段是 {zh, en} 对象。实现前跑会红
	// (文案还是纯字符串)——红因指向要实现的形态,不是语法错误。
	assert.ok(SETTINGS_SCHEMA.length >= 40, "SETTINGS_SCHEMA 非空");
	for (const spec of SETTINGS_SCHEMA) {
		for (const [field, value] of textFields(spec)) {
			assert.equal(
				typeof value, "object",
				spec.key + "." + field + ": 文案字段必须是 {zh,en} 双字典,收到字符串「" + String(value).slice(0, 24) + "…」"
			);
			assert.ok(typeof value.zh === "string" && value.zh.length > 0, spec.key + "." + field + ".zh 缺失");
			assert.ok(typeof value.en === "string" && value.en.length > 0, spec.key + "." + field + ".en 缺失");
		}
	}
});

test("设置 schema:结构字段保留为纯数据(不受 locale 化影响)", () => {
	for (const spec of SETTINGS_SCHEMA) {
		assert.equal(typeof spec.key, "string", "schema 项缺 key");
		if (spec.type !== undefined) assert.equal(typeof spec.type, "string");
		if (spec.min !== undefined) assert.equal(typeof spec.min, "number");
		if (spec.max !== undefined) assert.equal(typeof spec.max, "number");
	}
});

test("GOVERNOR_SETTINGS_SCHEMA(core)文案字段同为 {zh,en} 双字典", () => {
	// core 的 schema 经 governor.js 装配转出;直接 import 拿到同一对象做结构断言
	// (settings.test 已证明该 import 在本包测试环境可用)。
	assert.ok(GOVERNOR_SETTINGS_SCHEMA.length >= 14, "core schema 至少 14 项");
	for (const spec of GOVERNOR_SETTINGS_SCHEMA) {
		for (const [field, value] of textFields(spec)) {
			assert.equal(typeof value, "object", spec.key + "." + field + " 必须是 {zh,en} 双字典");
			assert.ok(typeof value.zh === "string" && value.zh.length > 0, spec.key + "." + field + ".zh 缺失");
			assert.ok(typeof value.en === "string" && value.en.length > 0, spec.key + "." + field + ".en 缺失");
		}
	}
});
