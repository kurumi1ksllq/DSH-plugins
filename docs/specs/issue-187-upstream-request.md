# 上游请求单（#187 的 B/C/E 项 + 一项扩展）

本文件记录**本仓库改不到、需要向上游 DSH 提的改动**。四个 issue（#185-#188）里，凡是落在运行时工具描述与 schema 上的部分都在这里，仓库侧只能改注入文本。

> 第 4 节（`waitForChildren` 未暴露为工具）**不在原 issue 的四项边界内**，是本轮调研的扩展发现——它解释了「模型手上没有『等我这 N 个后台子代理』这个动作」，与 #187 的根因 3 同源，故一并记录。

出处均在 `/opt/dsh-runtime/dshcli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（不在任何 git 仓库、locale 只有 `meta` 键、`Config` schema 无 description 覆盖字段）。

## 1. `wait_agent` 的 noProgress 文案没有说明覆盖面

**文件**：`dsh-experimental-tool-agent-team/lib/index.js:32`（常量 `NO_ACTIVE_PEER_MESSAGE`）

**现状**：

> No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.

**问题**：这句话的每一处都在讲「Team member」，但读的人（模型）会把它当成「所有后台子代理」。事故里正是这条误判触发了重复建队：两个 `subagent` 正在跑，`wait_agent` 返回 no-active-peer，模型据此判定子代理已死。

**建议**：追加一句

> This covers Team members only — background subagents are not Team members. Their results arrive as inbox notifications when they finish; do not poll for them.

## 2. `subagent` 的描述没说结果怎么到达

**文件**：`dsh-tool-subagent/lib/index.js:373`（description 拼装）与 `:500-507`（`tool:subagent` section）

**现状**：只说 "The runtime notifies you when it finishes."，且 `:500-507` 那段协作指导已含 "continue useful work while they run / end your turn instead of sleeping or polling"，但**没说** (a) 结果以 inbox 通知形式到达、(b) `wait_agent`/`list_agents` 看不见它。

**建议**：在那段 section 里补

> The completion notice arrives as an inbox message. Background subagents do not appear in `wait_agent` or `list_agents`; do not use them to poll for a subagent's result.

## 3. `spawn_teammate` 不支持 `agent_preset`

**文件**：`dsh-experimental-tool-agent-team/lib/index.js:251-275`（tool schema）；`dsh-experimental-agent-team/lib/index.js:1007-1046`（`spawnAdmitted` 的 request）

**现状**：`spawn_teammate` 的参数只有 `name` / `description` / `prompt` / `context`，**没有 `agent_preset`**。而 `subagent` 有（`dsh-tool-subagent/lib/index.js:389-393`，enum 取自 `allowedAgentPresets`）。

**后果**：teammate 继承父组合（实测 child session 头 `agentPreset: "deep-ptc"`），而 subagent 能拿到 `code-reviewer`。所以「组队做 review」拿不到 reviewer 角色——不只是重复，还是**不等价的重复**。

**建议**：让 `spawn_teammate` 接受 `agent_preset`，对齐 `subagent` 的实现路径（`dsh-subagent/lib/index.js:1452/1458` 把 `request.agentPreset` 落进 child session meta 与 composition）。

**注意**：这是运行时改动，不是文本改动——涉及 tool schema、`spawnAdmitted` 的 request 构造、`startActivation` 传参，以及 `team/member` 事件版本。**本仓库无法承载。**

## 4. （可选）「等全部后台子代理」没有一等能力

`subagents.waitForChildren` 存在，但只在 `dsh-acp` / `dsh-headless` / `dsh-goal-round-driver` / `dsh-sdk-jsonrpc-server` 里被宿主调用，**未暴露为工具**。模型手上没有「我现在有 N 个后台子代理在跑，等它们全部结束」这一个动作，只能自己拼。

**建议**：考虑暴露为工具，或至少在 `subagent` 描述里说明结果会自动唤醒。

## 本仓库已做的部分

- 注入文本（`packages/dsh-task-dispatcher/lib/delegation-text.mjs`）已补：去重纪律、投递语义（inbox / `wait_agent` 覆盖面）、等待与轮询纪律、并发纪律。
- 注入文本对 Lead 与每个 teammate 都生效（`index.js` 的 `systemPrompt.context` 段，teammate 通过 `composeFrom` 继承）。

## 为什么不在本仓库「代理」这些改动

用 dispatcher 注册一个同名工具覆盖 `wait_agent` 会双重注册冲突：`systemPrompt.context` 的 `NamedEntries` 对同 scope 同名注册直接抛错（`dsh-system-prompt/lib/index.js:205-207`），工具注册走 `tools.register` 的 scope 遮蔽，覆盖官方工具属高危行为。不做。