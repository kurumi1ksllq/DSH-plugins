// 合并包测试共用的 eval 加载辅助(与上游 anchor 测试同法:读源码、剥 import/export、
// new Function 还原模块作用域)。合并包多一条:惰性 peer 导入用了顶层 await,
// new Function(非 async)不兼容 —— 剥掉 try/catch,保留 createUserMessage 透传桩。
import { readFileSync } from "node:fs";

export function readEvalSource(url) {
	let source = readFileSync(url, "utf8");
	source = source
		.replace(/^import .*$/gm, "")
		.replace(/^export .*$/gm, "")
		.replace(/try \{\n\t\(\{ createUserMessage \} = await import\("@deepseek-ai\/dsh-llm"\)\);\n\} catch \{[\s\S]*?\n\}\n/, "\n")
		.replace(/^let createUserMessage = \(input\) => input;$/m, "\n");
	if (source.includes("await import")) throw new Error("eval source still contains top-level await");
	return source;
}
