# Issue #197:Git 面板(dev-flow 任务板)移到右侧栏

> 三问:① 可拆 = 是(client.js 改造 / 3 个既有测试适配 / 文档与版本,三块互不依赖);
> ② 值得第二视角 = 是(右侧栏是宿主对外契约,tab 类型注册写错会静默不显示,与 #161 同类静默失效);
> ③ 可并行 = 部分(测试适配与文档可并行),但实现与测试必须同一条红绿链。
>
> 分级:**standard**。改动跨 `client.js`、`package.json`(client.inject)、3 个测试文件、2 份文档、版本号。

## 背景

`packages/dev-flow/client.js` 现在把 Git 面板挂成左侧栏入口 + 主区整页:

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'git-status', ... }, SidebarIcon))
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'git-status', ... }, GitPanel))
```

用户要求把它移到**右侧栏**。

宿主侧右侧栏的扩展契约(实测读自
`@deepseek-ai/dsh-client-ui-sidebar-right` 0.2.2-rc.1 的 `lib/types/client/contract/slots.d.ts`
与 `tab-registry.d.ts`)是两段式:

1. **类型声明** — `ctx.sidebarRightTabs.register({ id, kind, priority, title, guide })`
2. **正文** — `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: <definition.id> }, Body)`
3. **标题**(可选) — `sidebar.right.pane.tab.title`,同 key

body 收到的是 session 作用域标准 props(`sessionId`)加框架注入的 `useTabInfo()`。
`sessionId` 直接可用,因此现有的 `retainedSessionId(ctx)`(从 sessions 列表反查 retainedBy.mainView)
与 `ctx.layout.selectPanel(null)` 回退按钮都失去存在理由。

## 目标

1. Git 面板成为右侧栏的一个 tab 类型:kind `git-status`,id `dev-flow/git-status`。
2. guide 里有一张入口卡(用户从右侧栏「添加」能找到它),order 排在文件(10)、终端(20)、浏览器(30)之后。
3. 移除 `sidebar.panellist` 与 `main` 两处注册;左侧栏不再有 Git 入口。
4. 面板内容不缩水:八列任务板、需要你出手、未进流程横幅、仓库实况折叠、刷新按钮全部保留。
5. 布局适配窄栏:右侧栏最小 300px、默认约视口 45%,八列横向并排必须横向滚动且每列 240px,
   在窄栏里等于看不见。改为**纵向堆叠**(一列一行,单滚动轴)。

## 边界

- 不改宿主侧(不碰 `@deepseek-ai/dsh-client-ui-sidebar-right`)。
- 不改 host 半边(`git-status-host.js` / `lib-git-status/*`):路由、快照、任务板推导逻辑一行不动。
- 不新增右侧栏专属手势(快捷键、菜单项)——宿主已提供关闭/刷新,本包不重复。
- 不保留左侧栏入口(用户明确要求「移动到右侧栏」,不是「两边都有」)。

## 验收

1. `client.apply` 只注册 `sidebar.right.pane.tab` 与 `sidebar.right.pane.tab.title`,key 等于 tab 定义的 id;
   不再注册 `sidebar.panellist` 与 `main`(**反向验证**:把任一旧注册写回,对应测试必须变红)。
2. 注册的 tab 定义含 `kind`、`priority`、`title()` 与 `guide` 卡(含 `order`)。
3. 面板仍渲染八列列头、需要你出手、未进流程、仓库实况(既有断言不回归)。
4. 任务板容器是纵向堆叠(断言渲染出的容器样式 `flexDirection: 'column'` 且无 `overflowX: 'auto'`)。
5. `sessionId` 从 tab 的 props 进入快照请求(`?sessionId=`),不再依赖 sessions 列表反查。
6. `package.json` 的 `dsh.client.inject` 换成 `@deepseek-ai/dsh-client-ui-sidebar-right`(去掉 layout / sidebar),
   版本升到 0.8.0;CHANGELOG 与 `README-git-status.md` 同步。
7. `pnpm --filter dev-flow test` 与 `pnpm verify` 全绿。

## Tickets

1. 客户端改挂右侧栏 tab(红→绿):新增 `test/client-right-sidebar.test.mjs`,先红后绿。
2. 三个既有测试夹具适配(从找 `main` 改为找 `sidebar.right.pane.tab`)。
3. 清单 / 文档 / 版本。

## 变更(实现中自决,2026-11-13)

1. **面板根容器必须自带滚动轴**(原 spec 未写)。宿主把 tab body 画在
   `overflow: hidden` 的 pane 里(见 `dsh-client-ui-sidebar-right` 的
   `P3OORG_tabBody{...overflow:hidden}`),dock kit 拥有 pane,body 不能滚动它。
   原实现的 `S.page` / `S.pageWide` 没有 `overflowY`,在右侧栏里等于「内容被裁掉、
   也没有滚动条」——看起来像标签页是空的。已给两个根样式加 `height:100%; overflowY:auto`,
   并新增反向验证测试。
2. **chip 标题用 Fragment 而不是 `<span style="display:contents">`**。宿主自己的
   `GuideTitle` / `FilesTitle` 都返回 `React.Fragment`,因为 chip 的盒子由 dock kit 提供,
   多包一层会引入它不预期的布局盒。已照做。
3. **`dsh.client.inject` 原本无测试守护**。仓库里 `dsh-inventory` 有
   `prompt-inject.test.mjs` 断言 inject 数组,`dev-flow` 没有等价守护;而宿主是从
   manifest 而非 `client.js` 的 `inject` 导出解析浏览器依赖的,写错只静默不加载。
   已补一条(正向断言 sidebar-right/locale 在列,反向断言 layout/sidebar 已移除),
   实测把旧数组写回 → 1 红。
4. **既有测试夹具的 `effect` 桩从 `() => {}` 改为 `(fn) => fn()`**。新注册全部包在
   `ctx.effect` 里,空桩会让 `register` 根本不被调用——这不是放宽断言,是让桩与真实
   slot 系统行为一致(真实系统会立即执行)。
