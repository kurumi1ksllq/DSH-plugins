/**
 * The always-on flow contract.
 *
 * This text rides the assembled system prompt on every turn (see index.js), so
 * it is written to be *short*. What has to survive compression is only the part
 * that changes behaviour:
 *
 *   1. when the flow starts (any request that writes repo files),
 *   2. how many times the user is asked (exactly twice),
 *   3. which decisions are the agent's own (all the technical ones),
 *   4. the rules that must never bend (main, private tests, state file).
 *
 * The markers this text must keep are owned by `lintContract` in lib/lint.mjs
 * (one list, so a rewrite cannot satisfy the doc and miss the injected text).
 *
 * The procedure itself — TDD loop, review prompt, state-file schema, branch
 * protection commands — stays in the packaged `FLOW.md` and is read once when
 * the flow actually starts. Duplicating it here would cost every turn for text
 * that is only needed inside a flow.
 *
 * @module dev-flow/contract
 */

/**
 * Render the flow contract.
 * @param {{docPath: string}} options absolute path of the packaged FLOW.md.
 * @returns {string} model-facing contract text.
 */
export function renderFlowContract({ docPath } = {}) {
  if (typeof docPath !== 'string' || docPath.length === 0) {
    throw new Error('[dev-flow] renderFlowContract requires the absolute path of FLOW.md')
  }
  return `[dev-flow] 工程流程契约(插件常驻,不依赖技能加载)

触发:任何会导致仓库文件内容变化的请求(含"只改一行""改个错别字")走本流程;纯只读问答、状态询问、会话级操作不进流程。
规程全文(进流程时读一次,细节以它为准):${docPath}

链路:意图 → issue → 分支 → TDD → PR → CI → 双轴 review → 合并。

只与用户交互两次,其余全部自己判断:
1. 意图:开工前用一句大白话复述"你要的是什么 + 我打算怎么做",用 ask_user_question 请用户确认或否决。
   用户不是程序员,选项只能是「是不是这个意思 / 要不要做」这类判断;不得把 trivial/standard、issue、PR、diff 等术语当决策项抛给用户。
2. 合并:做完(CI 绿、review 收尾)后问「要不要合并」,选项「合并 / 先不合并」,附一句建议与理由。
   只有这一步需要口令:卡片点选「合并」等同授权;"嗯 / 好 / 继续 / 通过"不算。

以下事项自决并留证,不要问用户:
- 分级(trivial/standard)与是否需要裁剪某阶段 → 写进 spec 与 docs/specs/.flow/<issue>.json。
- 仓库没有 CI → 自动补一个最小 workflow(test + verify)后继续。
- CI 红 → 自修,最多 2 轮;仍红则不合并,附失败要点报结论。
- 双轴 review 的每条发现 → 自己裁决:改,或不改并写理由;结论落进 PR 描述。
- 实现中发现 spec 需要调整 → 在 spec 里记「变更点 + 理由」后继续,不回头重开确认。

硬规则:
- 禁止直接改 main:改动走 issue-<n>-<desc> 分支 → PR。
- 禁测私有函数、调用次数、内部顺序;只测公开行为与输出。
- 每个流程节点写一次 docs/specs/.flow/<issue>.json(任务板的唯一进度源)。
- 破坏性操作(rm -rf、drop/truncate、force-push、重启宿主进程)先说明再问,其余不要停。`
}
