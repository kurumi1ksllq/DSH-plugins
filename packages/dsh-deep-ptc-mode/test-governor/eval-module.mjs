// 合并包测试共用的 eval 加载辅助(与上游 anchor 测试同法:读源码、剥 import/export、
// new Function 还原模块作用域)。合并包两条:
// ① 惰性 peer 导入用了顶层 await,new Function(非 async)不兼容 —— 剥掉 try/catch,
//    保留 createUserMessage 透传桩;
// ② #116 起 lib/governor.js 是装配入口(经 import + 单行 export 转出五个 governor-*.mjs
//    模块),须递归收集相对导入的 governor 模块并按依赖序拼接各模块源码,再剥
//    import/export 行。拼接产物必须语法有效(anchor-contract 测试可写 /tmp/gov-bundle.js
//    后用 node --check 验证)。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 装配入口对 governor 子模块的相对导入行(import { a, b } from "./governor-x.mjs")与
// re-export 行(export { a } from "./governor-x.mjs",若未来改写为此形态)。
function importedRelatives(line) {
	const m = line.match(/^(?:import|export)\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/);
	if (!m) return null;
	if (!m[2].startsWith("./")) return null; // 只展开相对导入(装配入口的全部依赖都是本包文件)
	return { from: m[2] };
}

// 递归收集模块源码(DFS:被依赖者先入列,与其在原单文件中的声明序一致)。
function collectModules(entryUrl, seen = new Set()) {
	const source = readFileSync(entryUrl, "utf8");
	const parts = [];
	for (const line of source.split("\n")) {
		const rel = importedRelatives(line);
		if (!rel) continue;
		const childUrl = new URL(rel.from, entryUrl);
		if (seen.has(childUrl.href)) continue;
		seen.add(childUrl.href);
		parts.push(...collectModules(childUrl, seen));
	}
	parts.push(source);
	return parts;
}

export function readEvalSource(url) {
	const sources = collectModules(url, new Set([url.href]));
	let source = sources
		.map((s) =>
			s
				.replace(/^import .*$/gm, "")
				.replace(/^export \{.*$/gm, "")
				.replace(/try \{\n\t\(\{ createUserMessage \} = await import\("@deepseek-ai\/dsh-llm"\)\);\n\} catch \{[\s\S]*?\n\}\n/, "\n")
				.replace(/^let createUserMessage = \(input\) => input;$/m, "\n")
		)
		.join("\n");
	if (source.includes("await import")) throw new Error("eval source still contains top-level await");
	return source;
}
