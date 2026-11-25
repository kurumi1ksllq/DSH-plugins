# issue-237:delegate_role 的启动 spec 摊平

**分级:trivial**(单包、单条调用形状 + 对应测试断言)

## 目标

`packages/dsh-task-dispatcher/lib/role-tools.mjs` 里 `subagents.startActivation()` 的入参把 `prompt`/`parent`/`maxDepth` 埋进了 `request` 子对象,而宿主 `SubagentActivationSpec` 要求它们是顶层字段:

- 类型:`@deepseek-ai/dsh-subagent/lib/types/types.d.ts:23`(`extends Omit<SubagentStartRequest,'label'|'signal'>`)
- 读取:`dsh-subagent/lib/index.js:1479/1492/1557`(`spec.parent`、`spec.prompt`)、`:3019/3024`(`spec.provider`、`spec.parent.id`)

所以 `delegate_role` 100% 抛 `TypeError: Cannot read properties of undefined (reading 'id')`。修法:把 `request` 摊到顶层。

## 边界

- 只改这一处调用形状与对应断言;不动工具签名、不动 `buildDelegationRequest` 的返回值(它仍是「provider 无关的请求部分」)。
- 不引入 `agentPreset`(delegate.mjs 开头的不变量保留)。

## 验收

- `test/role-tools.test.mjs` 里的 `seen.request.*` 断言全部改成 `seen.*`,并新增一条「spec 不得有 request 键」的断言。
- 把实现改回嵌套形状时测试必须变红(反向验证)。
- `pnpm test` / `pnpm verify` 绿;包升 patch 版本 + CHANGELOG。
