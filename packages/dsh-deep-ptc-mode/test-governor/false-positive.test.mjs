/**
 * #239 / #240 / #241:三个「误判合法文本」的护栏。
 *
 * 加载方式与 anchor-contract.test.mjs 相同:剥 import/export 后 new Function 还原
 * 模块作用域,既能拿内部检测器(detectNumberRunaway / splitSentences),也能挂载
 * apply 走真实的 agent/soft-cut 决策。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readEvalSource } from "./eval-module.mjs";

const tempHome = path.join(os.tmpdir(), "stall-governor-false-pos-" + randomUUID().slice(0, 8));
fs.mkdirSync(tempHome, { recursive: true });

const BlockAssembler = function () { this.parts = []; };
BlockAssembler.prototype.add = function () { return this; };

const factory = new Function(
	"randomUUID", "appendFileSync", "existsSync", "mkdirSync", "readFileSync", "statSync", "unlinkSync", "writeFileSync",
	"homedir", "join", "createRequire", "BlockAssembler", "createUserMessage",
	`${readEvalSource(new URL("../lib/governor.js", import.meta.url))}; return { apply, detectNumberRunaway, splitSentences };`
);

const api = factory(
	randomUUID, fs.appendFileSync, fs.existsSync, fs.mkdirSync, fs.readFileSync, fs.statSync, fs.unlinkSync, fs.writeFileSync,
	() => tempHome, path.join, createRequire, BlockAssembler, (text) => ({ role: "user", content: text })
);

function mount() {
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
	return { handlerOf(event) { return listeners.find((item) => item.event === event)?.handler; } };
}

const softCutHandler = mount().handlerOf("agent/soft-cut");
const nullNext = async () => null;
const cutOf = (fullVisibleText) => softCutHandler({ sessionId: "sess-fp", turn: 1, step: 0, fullVisibleText }, nullNext);

const prose = (n, seed = "这一段是正常推理,没有数字也没有失控。") => Array.from({ length: n }, () => seed).join("");

// ---- #239 数字失控必须落在文本尾部 -----------------------------------------

test("#239 中段的合法种子数组不触发数字失控", () => {
	// 300..429 的 const ids 数组:digitRatio 与 increaseRatio 都够,唯一不该够的是
	// 「它在文本尾部」——旧实现只要有一个合格 run 就 return,于是把后面 12 句正文一起截掉。
	const ids = Array.from({ length: 130 }, (_, i) => 300 + i).join(", ");
	const text = prose(20) + "\n\n```js\nconst ids = [" + ids + "]\n```\n\n" + prose(12);
	assert.ok(text.length > 800, "样本长度要过检测器的文本闸");
	assert.equal(api.detectNumberRunaway(text), null, "合法列表不是失控");
});

test("#239 尾部真的失控时,trimTo 指向尾段起点而不是中段合法列表", () => {
	const ids = Array.from({ length: 130 }, (_, i) => 300 + i).join(", ");
	const runaway = Array.from({ length: 260 }, (_, i) => 9000 + i).join(". ") + ".";
	const text = prose(20) + "\nconst ids = [" + ids + "]\n" + prose(6) + "\n" + runaway;
	const hit = api.detectNumberRunaway(text);
	assert.ok(hit !== null, "尾部计数流必须仍然命中");
	assert.ok(hit.trimTo >= text.indexOf("9000"), "trimTo 必须落在真失控起点,而不是中段的合法列表");
	assert.ok(text.length - (hit.trimTo + hit.chars) <= 400, "命中的 run 要贴着文本尾部");
});

test("#239 尾部的计数流即使落在未闭合围栏里仍然命中", () => {
	// 该检测器进的是 confirmed-repeat 桶(精确重复类),按既有契约「精确重复与非法
	// 调用无论出现在哪里都切」——所以不做围栏豁免,否则一个孤立的 ``` 就是免死金牌。
	// #239 的围栏豁免被这条「尾向」规则取代:后面的正文会先把它排除掉。
	const ids = Array.from({ length: 300 }, (_, i) => 1000 + i).join(". ") + ".";
	const text = prose(10) + "\n```\n" + ids;
	assert.ok(api.detectNumberRunaway(text) !== null);
});

// ---- #240 裸 tool_call 块要看块内内容 ---------------------------------------

test("#240 围栏里的完整 tool_call 示例不是伪调用", async () => {
	assert.equal(typeof softCutHandler, "function", "agent/soft-cut 必须注册,否则下面的断言全是空跑");
	const text = "工具调用要写成结构化的,不要写成文本标签。例如:\n\n```\n<tool_call>\n<function name=\"edit\">\n<parameter name=\"path\">a.txt</parameter>\n</function>\n</tool_call>\n```\n\n" + prose(12);
	const decision = await cutOf(text);
	assert.notEqual(decision?.cutClass, "pseudoTool", "文档示例不得被判成伪调用");
});

test("#240 围栏外带 function name 的裸块仍然命中", async () => {
	assert.equal(typeof softCutHandler, "function", "agent/soft-cut 必须注册,否则下面的断言全是空跑");
	const text = "我先这样调用:\n\n<tool_call>\n<function name=\"edit\">\n<parameter name=\"path\">a.txt</parameter>\n</function>\n</tool_call>\n\n" + prose(12);
	const decision = await cutOf(text);
	assert.equal(decision?.cutClass, "pseudoTool", "真·文本化调用必须仍然被拦");
});

test("#240 只有成对标签、块内没有名字信号的示例不命中", async () => {
	assert.equal(typeof softCutHandler, "function", "agent/soft-cut 必须注册,否则下面的断言全是空跑");
	const text = "格式长这样:\n\n<tool_call>some text</tool_call>\n\n" + prose(12);
	const decision = await cutOf(text);
	assert.notEqual(decision?.cutClass, "pseudoTool");
});

// ---- #241 撇号不得吞掉后文句号 ---------------------------------------------

test("#241 含撇号的段落与不含撇号时句数一致", () => {
	// 样本必须真的带撇号字符:写成 doesnt 时一个引号都没有,断言在任何实现下都成立。
	const withApostrophe = "It doesn't stop here. 我先看 files' 目录. 然后确认结论: 是缓存问题. 最后给出修复方案.";
	const withoutApostrophe = "It does not stop here. 我先看 files 目录. 然后确认结论: 是缓存问题. 最后给出修复方案.";
	assert.ok(/['"]/.test(withApostrophe), "样本必须含引号字符,否则是个空测试");
	assert.equal(
		api.splitSentences(withApostrophe).length,
		api.splitSentences(withoutApostrophe).length,
		"一个撇号不能改变断句数量"
	);
});

test("#241 撇号在前时,后面落单的引号也不得吞句号(引号预算与消耗口径一致)", () => {
	// 旧实现里预算把词内撇号也数成「后面还有引号可配对」,于是撇号之后的落单引号照样开栈。
	const text = "it doesn't stop. 他说 '还没写完. 后面一句. 第三句.";
	assert.ok(api.splitSentences(text).length >= 3, "得到 " + api.splitSentences(text).length + " 句");
});

test("#241 落单的引号不吞掉后续句号", () => {
	const text = "他说 \"这里还没写完. 后面还有一句. 最后一句.";
	const sentences = api.splitSentences(text);
	assert.ok(sentences.length >= 3, "奇数个引号不得把整段压成一句,得到 " + sentences.length);
});
