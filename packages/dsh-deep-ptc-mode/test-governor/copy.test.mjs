// #132 governor locale 化:模型文案字典(COPY)与设置 schema 文案字段的 zh/en 键集一致契约。
// 反向验证:删任一 en 键(或 schema 文案字段少一边)即红。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { COPY } from "../lib/governor-copy.mjs";
import { SETTINGS_SCHEMA, applyRuntimeSettings, settings } from "../lib/governor-settings.mjs";
import { GOVERNOR_SETTINGS_SCHEMA } from "../lib/governor-core.mjs";
import { renderRepeatAnchor, renderChurnEscalation } from "../lib/governor-softcut.mjs";
import { copy as copyFn } from "../lib/governor-copy.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("COPY: zh 与 en 键集一致且非空", () => {
	const zh = Object.keys(COPY.zh).sort();
	const en = Object.keys(COPY.en).sort();

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

	for (const spec of GOVERNOR_SETTINGS_SCHEMA) {
		for (const [field, value] of textFields(spec)) {
			assert.equal(typeof value, "object", spec.key + "." + field + " 必须是 {zh,en} 双字典");
			assert.ok(typeof value.zh === "string" && value.zh.length > 0, spec.key + "." + field + ".zh 缺失");
			assert.ok(typeof value.en === "string" && value.en.length > 0, spec.key + "." + field + ".en 缺失");
		}
	}
});

test("#132 en 接线:render* 以 locale=en 产出英文文案(反向验证:删调用点实参即红)", () => {
	// 轴2#2:接线曾静默退化为 zh(自查修复 49e3b6f);此断言钉住「实参必须真传」。
	// renderRepeatAnchor/renderChurnEscalation 是导出符号,不违反禁测私有函数。
	const zh = renderRepeatAnchor({ period: 12, count: 3 });
	const en = renderRepeatAnchor({ period: 12, count: 3 }, "en");
	assert.notEqual(en, zh, "en 与 zh 产物必须不同(实参真传的证据)");
	assert.match(en, /in-place repetition detected/, "en 产物含英文标志句");
	assert.match(zh, /检测到原地重复/, "zh 产物保持中文");
	const enEsc = renderChurnEscalation(2, "en");
	assert.match(enEsc, /Churn cut 2 this turn/, "escalation en 产物");
});

test("#132 copyLocale 设置发布与白名单回退(applyRuntimeSettings)", () => {
	const applied = applyRuntimeSettings({ copyLocale: "en" });
	assert.equal(applied.copyLocale, "en", "copyLocale 设置发布");
	assert.match(copyFn("en").softStopTail(), /wrap-up boundary/i, "en soft-stop 尾句");
	assert.match(copyFn("en").softStopTail(), /in Chinese/i, "#139 P2:en 保留「用中文总结」约定(反向验证:删掉 in Chinese 即红)");
	assert.equal(applyRuntimeSettings({ copyLocale: "fr" }).copyLocale, "zh", "白名单外回退 zh");
	assert.equal(applyRuntimeSettings({}).copyLocale, "zh", "缺省回退 zh");
});

test("#132 P1 行为联动:settings.copyLocale 驱动导出 render* 产出对应文案(spec 方案1 原文)", () => {
	// render* 是导出符号;applyRuntimeSettings 发布 copyLocale 后,以 settings 值驱动
	// 必须产出 en 文案——render* 内部若忽略 locale 参数(静默退化新形态),这里红。
	applyRuntimeSettings({ copyLocale: "en" });
	assert.equal(settings.copyLocale, "en", "copyLocale 设置发布(显式)");
	const driven = renderRepeatAnchor({ period: 12, count: 3 }, settings.copyLocale);
	assert.match(driven, /in-place repetition detected/, "settings 驱动产出 en(内部忽略 locale 则此处为中文,红)");
	const drivenEsc = renderChurnEscalation(2, settings.copyLocale);
	assert.match(drivenEsc, /Churn cut 2 this turn/, "renderChurnEscalation 同样由 settings 值驱动");
	applyRuntimeSettings({ copyLocale: "zh" });
	const drivenZh = renderRepeatAnchor({ period: 12, count: 3 }, settings.copyLocale);
	assert.match(drivenZh, /检测到原地重复/, "settings 驱动 zh 保持中文");
});
test("#132 P1 接线源码护栏:governor-apply 的 render*/外部锚点调用点必须真传 settings.copyLocale(15 个调用语句/16 处出现)", () => {
	// 轴1 P1:接线曾静默退化(zh 常量固化);此断言钉住「settings 值真传到 render*」——
	// 删 governor-apply 调用点的 settings.copyLocale 实参时,这里用 settings 驱动的产物
	// 与直传字面量的产物出现差异即红(等价于抓住接线回归)。
	// 源码级辅助护栏(行为断言见上一测试):防「删实参」「改回字面量」两类回归;
	// 格式化/改名类重构会假红,届时同步更新本清单。清单来自 49e3b6f 修复时的实际调用点。
	const src = readFileSync(join(here, "..", "lib", "governor-apply.mjs"), "utf8");
	const required = [
		"renderPseudoToolAnchor(looping !== null, looping, settings.copyLocale)",
		"renderRepeatAnchor(looping, settings.copyLocale)",
		"renderNGramLoopAnchor(ngramLoop, settings.copyLocale)",
		"renderNumberRunawayAnchor(numberRunaway, settings.copyLocale)",
		"renderChurnAnchor(churn, settings.copyLocale) + renderChurnEscalation(churnOccurrence, settings.copyLocale)",
		": renderChurnAnchor(churn, settings.copyLocale);",
		'churnOccurrence >= 2 ? renderChurnEscalation(churnOccurrence, settings.copyLocale) : ""',
		'occurrence, settings.copyLocale)', // renderOverLongCoTAnchor(轴2#3:此前漏钉)
		"renderActionChurnAnchor(actionChurn, settings.copyLocale)",
		"renderToolArgsErrorAnchor(toolName, invalidFields, settings.copyLocale)",
		"execDisciplineText(settings.copyLocale)",
		"tDeny = copy(settings.copyLocale)",
		"tG2 = copy(settings.copyLocale)",
		"tStop = copy(settings.copyLocale)",
		"tExt = copy(settings.copyLocale)",
	];
	const missing = required.filter((snippet) => !src.includes(snippet));
	assert.deepEqual(missing, [], "governor-apply 接线缺失(回归到 zh 硬编码):\n" + missing.join("\n"));
	// 出现次数口径自证(轴2#2:16 处出现/15 个调用语句):
	assert.equal((src.match(/settings\.copyLocale/g) || []).length, 16, "settings.copyLocale 出现次数漂移");
});
