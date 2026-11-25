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

## 变更点(实现中调整,留证)

1. **CHANGELOG 计数**:本 PR 新增一条 Unreleased 记录,仓库级契约测试(`test/docs-contract.test.mjs`「Unreleased note count」)要求计数与条目数一致,故把「本段现有 82 个条目」改为 83、缺 tag 清单加入 `dsh-task-dispatcher@0.9.4`(74+7+2=83)。这属于流程必备的连带改动,不改变本 issue 的边界。

## 双轴 review 留证

两个子代理(`agent-1` 轴1 / `agent-2` 轴2)按模板派出,8 分钟后仍未回报(一次催收无果),按「委派失败由 lead 兜底」处理——**以下两轴结论由 lead 自审得出,未获得独立第二视角**:

- **轴1(spec 一致性)**:实现与 spec 的目标/边界一致(`buildDelegationRequest` 未改、未引入 `agentPreset`);验收项「spec 不得有 request 键」已落为断言。**未验证项**:acceptance 里「摊平后能通过宿主能力校验」未在真机跑过 `delegate_role`(需重载 DSH 宿主,不在本会话授权内),证据是类型契约(`types.d.ts:23`)与宿主读取点(`spec.parent.id` :3024、`spec.prompt` :1557、`spec.maxDepth` :1497/:3021)均为顶层。
- **轴2(仓库规范)**:断言只走公开行为(工具 `execute()` 交给 `startActivation` 的 spec),反向验证已实测(改回嵌套时 4 条红,含 1 条 TypeError);src 中已无 `spec.request` 残留(全仓 grep 仅命中 websearch 的同名字段,无关);无凭证/危险指令引入;CHANGELOG 版本纪律由 `pnpm verify` 绿确认。
