# dsh-task-dispatcher

向会话所有成员(主 agent 与每个 teammate)注入**一个** runtime-context 段(`dsh:auto-delegation-discipline`)。段内只有**两个标题**:

1. **委派纪律**(heading):开工三问(绑到 `todo_write`,无该工具时写进首条回复) + 分档表(单线程 / `subagent`·`subagent_fork` / 扇出:有 `workflow` 用它、没有则用 N 个 `subagent` 并行 / 组队 / 对抗验证) + 停手线 + 去重与投递语义 + 等待与轮询上限,含队友向下委派的显式授权。
2. **声明式路由表**(routingHeading):列出可委派的子 agent preset(id → 职责),模型按子任务内容选择 `agent_preset` 参数——"AI 理解内容并决策派给哪个 subagent"的依据。

等待/轮询/并发是委派纪律下的**一条 bullet**,不是独立小节——`renderDelegationText` 只输出上面两个标题。

> 运行时工具描述(`spawn_teammate` / `wait_agent` / `subagent`)不在本仓库,改不到的部分记在 `docs/specs/issue-187-upstream-request.md`。

teammate 经 `composeFrom` 继承父组合,因此文本对主 agent 与 teammate 同时生效;深度上限由 DSH `dsh-subagent` 的深度闸与 `maxDepth` 设置执行(`dsh-subagent/lib/index.js` 的 `delegationDepthOf`/`SubagentDepthError` 派生链),注入文本只引用机制、不固定具体数值。

## 配套

- 路由表里的 preset id 必须真实存在于 profile,并与 `dsh-deep-ptc-mode/lib/model.mjs` 的 `DELEGATION_PRESET_WHITELIST`(derive 期打点,`preset.json` 保持官方原样)双向镜像——契约测试双向守护,改动需两处同步。
- 注入走 `systemPrompt.context`(与 deep-ptc governor 同一通道);恒定文本利于 KV cache。
- locale 固定 zh(操作者工作语言);`lib/delegation-text.mjs` 的 en 字典为预留。

## 测试

```bash
pnpm test   # 或包内 node --test test/*.test.mjs
```
