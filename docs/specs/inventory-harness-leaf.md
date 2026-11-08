# inventory 测试 harness:面板内挂载叶子组件(#93)

来源:PR #92 双轴 review 轴2 #8,记为债务。issue #93。分级:standard。

## 现状(事实,均已核实)

- `makeReactRuntime`(test/client.test.mjs)的 `stateHooks/effectHooks/callbackHooks` 为**全局单份数组**,useState 等按全局 cursor 取槽位。
- `bootPanel` 的 `tree() = resolveTree(render(main.component))`;resolveTree 在渲染循环**外**直接调用叶子组件函数,其 hooks 写进面板的槽位数组,与面板自身 hook 槽位冲突(实测 vault 的 entries 读到 null)。
- 因此 rail-flow 测试(`nav rail switches views...`)对「点击凭据保险库后」只断言 raw 树上 NavRail 元素的 `props.active === 'credentials'`(半内部断言),而非解析树上的 `aria-current`(行为断言);测试注释明说这是 harness 缺陷的绕行。
- 另:rail 项收集用「带 aria-label 的按钮」泛化收集(`aria-label !== undefined`),未按 6 个视图名精确枚举,若 rail 内将来出现其它带 label 的按钮会误计数。

## 方案

1. **harness per-component hook 命名空间**:每个组件函数(WeakMap 按函数身份)独立 slots;render 循环与叶子展开均进入「当前组件」命名空间,面板与叶子互不串写。
2. **渲染循环内完成叶子展开**:render 每轮把树中的函数组件展开完(有界),叶子组件的 effects 参与轮末执行,deps 语义不变;新 hook 产生的 dirty 触发下一轮,与现状一致。`tree()` 返回完全解析的树。
3. **rail-flow 改行为断言**:点击「凭据保险库」后,断言解析树上 `aria-label='凭据保险库'` 的 rail 项 `aria-current === 'page'`;删除对 raw `props.active` 的断言(rawTree 若无其余使用则一并移除)。
4. **rail 项精确枚举**:按 6 个视图名(总览 / 工作区 / 同步 / Web 搜索提供方 / 提示词注入 / 凭据保险库)以 aria-label 精确枚举收集与计数。

## 边界

- 只改 `packages/dsh-inventory/test/client.test.mjs`(纯测试);不改 `client/` 源码、不改其它包、不改面板行为。
- 不追求完整 React 语义:同一组件函数在树中出现两次时共享命名空间(harness 已知限制,现状无此用例)。
- vault mount 后的 fetch 由 bootPanel 既有 mock 应答(`/credential-vault/api/*` 空数据),不新增网络桩。
- `seedState` 语义保持:种子写入**根组件**命名空间(update-action 测试依赖)。
- 版本纪律:纯测试改动不升版本号、不打 tag(循 #134「pure-test no tag」先例);若 check-bundle-versions 拦截则升 patch 并在 .flow 记 note。

## 验收

1. rail-flow 对「凭据保险库」点击后断言解析树 `aria-current='page'`;vault 在面板树内可解析,entries 不串写为 null。
2. rail 项按 6 个视图名精确枚举,计数断言与 aria-current 形状解耦。
3. **反向验证**:把 NavRail 高亮逻辑改坏(active 判定恒 false)时,rail-flow 两条测试必须变红。
4. 完工四件套全绿:`pnpm test`、`pnpm verify`(仓库无独立 typecheck/lint,循定义跳过)。

## Tickets(有序)

| # | 标题 | 说明 |
|---|---|---|
| 1 | harness per-component 命名空间 + 循环内展开 | 红:rail-flow 改 aria-current 断言先红(harness 现状解析 vault 串 hook);绿:实现命名空间后通过 |
| 2 | rail 项精确枚举 + 反向验证 | 6 视图名枚举;临时改坏 NavRail 验证变红后还原 |
| 3 | 四件套收尾 | pnpm test + pnpm verify 全绿 |
