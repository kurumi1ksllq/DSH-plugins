/**
 * dsh-stall-governor — 惰性 peer 导入:@deepseek-ai/dsh-llm 的 createUserMessage。宿主内由内核提供;单测/CI 无运行时,导入失败时透传桩兜底(见 governor.js 文件头注释)。
 *
 * #116 拆分:本文件全部声明自原 lib/governor.js 等价整块搬入(逐字未改),导入为新增。
 */

// 上游运行时依赖 @deepseek-ai/dsh-llm(createUserMessage,软停收尾指令构造)。宿主内该 peer
// 由内核提供;单测/CI 环境没有运行时,惰性导入失败时以透传桩兜底——软停消息退化为纯文本,
// 其余判据与事件全部不受影响(fail-open:设置便利性永远不是插件启动失败的理由)。
let createUserMessage = (input) => input;
try {
	({ createUserMessage } = await import("@deepseek-ai/dsh-llm"));
} catch {
	// peer 缺失:保留透传桩,见上方注释。
}

// 单行导出:测试的 eval 加载器按行剥 export,多行导出会留下悬挂表达式
export { createUserMessage };
