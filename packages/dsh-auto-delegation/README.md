# dsh-auto-delegation

向会话所有成员(主 agent 与每个 teammate)注入两段 runtime-context:

1. **委派纪律**:开工三问 + 分档表(单线程 / `subagent`·`subagent_fork` / `workflow` 扇出 / 组队 / 对抗验证),含队友向下委派的显式授权。
2. **声明式路由表**:列出可委派的子 agent preset(id → 职责),模型按子任务内容选择 `agent_preset` 参数——"AI 理解内容并决策派给哪个 subagent"的依据。

teammate 经 `composeFrom` 继承父组合,因此两段文本对主 agent 与 teammate 同时生效;`maxDepth: 3` 允许队友向下两层委派。

## 配套

- 路由表里的 preset id 必须真实存在于 profile;`dsh-deep-ptc-mode` preset.json 的 `allowedAgentPresets` 白名单镜像同一组 id(改动需两处同步,见 spec issue-151 §验收 C)。
- 注入走 `systemPrompt.context`(与 deep-ptc governor 同一通道);恒定文本利于 KV cache。

## 测试

```bash
pnpm test   # 或包内 node --test test/*.test.mjs
```
