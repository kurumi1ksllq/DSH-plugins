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

## 双轴 review 裁决(轴2 有独立回报,轴1 未回报)

轴2 子代理回报 4 条,逐条裁决:

1. **`.flow` 与 CI 实况不符** → **不采纳(已过期)**:评审基线是 `4072cf1`,当时 CI 仍 pending;此后 HEAD 已把 `ci.status` 改 `green`、`stage` 推进到 `review/merge`。
2. **评审对象被后续提交取代** → **采纳为留证**:评审基线钉在 `4072cf1`,其后两个提交只动 `docs/specs/`(+`.flow`)与注释文字,不含实现变更。
3. **`role-tools.mjs` 注释仍写 `request.maxDepth`** → **采纳并已改**:改为「宿主比较的是 spec 顶层的 `maxDepth`(`dsh-subagent resolveChildDepth`)」。
4. **CHANGELOG 行号漏 `:3019`,「100% 失败」过绝对** → **采纳并已改**:补 `:3019`,改为「在当前宿主契约下必然失败」。次要项 `assert.equal(Array.isArray(...), true)` → `assert.ok(...)` 已改。

轴1(对 spec)子代理超时未回报,收尾时仍未产出——轴1 结论由 lead 自审代替,已在上文「双轴 review 留证」记录(**无独立第二视角**)。

## 轴1(对 spec)回报与裁决(收尾补充)

轴1 子代理在被催收后迟到回报(其审查基线为 `4072cf1`),结论「核心目标/边界/验收达成」。逐条裁决:

1. **陈旧注释 `role-tools.mjs:202` / `test:162` 仍写 `request.maxDepth`** → **采纳**:两处都已改为「spec 顶层 `maxDepth`」。
2. **CHANGELOG 计数属边界扩张** → **已知并留证**:见上文「变更点」第 1 条;这是 `test/docs-contract.test.mjs` 的硬契约,不改则 CI 必红。
3. **`.flow` 记录与实测绿不符** → **已修**:评审看到的是 `4072cf1` 的快照,HEAD 已提交 `ci.status:"green"` / `stage:"review"` / `review.state:"done"`。
4. **深度闸测试对「是否摊平」不敏感** → **不采纳**:`test:186` 断言 `seen.maxDepth === 3`,嵌套形状下该值为 `undefined`,首轮 TDD 实测正是这条红(`undefined !== 3`),反向守护已存在。
5. **留证与事实不符(轴1 未回报)** → **采纳**:本节即更正;轴1 确已回报,只是晚于 lead 自审。
6. **nit:`types.d.ts:23` 应为 `:24`** → **不采纳**:实测第 23 行即 `export interface SubagentActivationSpec extends Omit<...>`,第 24 行是首个成员注释。
