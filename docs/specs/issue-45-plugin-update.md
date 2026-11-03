# 插件页一键更新(每个插件详情页头部一个「更新」)

- 分级:`standard`
- 关联:issue #45
- 用户已定:① 按钮挂在**每个插件的详情页头部**;② 点任一插件的「更新」= **更新整个 checkout**,结果里列出所有变了的插件

## 1. 技术地基(已取证,不改宿主)

| 事实 | 证据 |
| --- | --- |
| 插件页是宿主包 `dsh-client-ui-plugin-manager`,对外暴露 slot | `lib/types/client/slot-contract.d.ts` |
| `plugins.detail.actions` = 详情页头部、在开关/卸载之前,带 `subject` | `slot-contract.d.ts:56-70`;`lib/client.js:2726,2784,2855` |
| `plugins.detail.badge` = 标题旁、版本号之后 | `lib/client.js` 的 `renderSlot("plugins.detail.badge", {subject})` |
| `PluginsSubject` 给到 `pkg{name,version,installed,availability,official,enabled,rows}` | `slot-contract.d.ts:56-63` |
| 运行时触发重组合的官方 public API | `ctx.get('hmr').runExclusive(() => hmr.reconcileProfile())`,`dsh-hmr/lib/index.js:748,1320` |
| 这正是 plugin-manager 自己用的路 | `dsh-plugin-manager/lib/index.js:2366` |
| 有第三方注册先例 | `dsh-cordis-client-runner/lib/client.js:4562` |
| **替换失败不恢复**,旧代码直接死,只报 `failed` | `dsh-hmr` README 原话;`evict` 无备份 `:1274-1281` |
| 被更新的插件会在调用返回前被 stop | `stopPlanned` 先 `registry.delete` + `await fiber` 再 `recomposeProfile` |
| `link:` 包改文件**本身不触发**重组合 | `dsh-hmr/lib/index.js:838,853-864` |

## 2. 目标

在 DSH 插件页里,对**本仓库的每个 bundle**,详情页头部出现「更新到 x.y.z」按钮与「可更新」标签;点一下完成更新并**免重启**生效;失败如实报 `failed`。

## 3. 边界

- 改:`packages/dsh-inventory/`(`index.js`、`client.js`、新增 `lib/plugin-update.js`、`package.json` 版本、测试、README)
- 不改:宿主包(`dsh-client-ui-plugin-manager` 等)、profile 接线、`pnpm-lock.yaml`、任何其它 bundle
- 不重启 DSH;`hmr` 缺失时**只报** `restart-required/no-hmr`
- **不做**逐插件独立更新:7 个 bundle 同处一个 checkout,`git merge --ff-only` 必然整体推进

## 4. 后端设计

### 路由(挂进现有 `syncRoutes` 数组,继承 origin 守卫与错误模板)

| 路由 | 方法 | 返回 |
| --- | --- | --- |
| `/inventory/plugin-update` | GET | `{repo, head, target, behind, bundles:[{name,version,nextVersion,updatable,active}]}` |
| `/inventory/plugin-update/apply` | POST | `{ok, from, to, changed:[{name,from,to}], restart:{application,restartReason}, failed?}` |

### 判定「有新版」

`git fetch` 后读目标 ref 上**每个 `packages/*/package.json` 的 `version`**,与本机 `node_modules/<pkg>/package.json` 比。不按 tag(同 commit 多 tag,`git describe` 会答错包名 —— 见 `scripts/update/plan.mjs:26-45`)。

### apply 序列(顺序不可调换)

```
1. 前置校验(任一失败即中止,不动文件)
   · 工作树干净           → git status --porcelain 为空
   · 能 ff-only           → 目标 ref 是 HEAD 的后代或等于 HEAD
   · entry probe          → 每个受影响 bundle 入口可 import(失败即拒)
2. 快照 → $DSH_HOME/plugin-update-backups/<ts>/(package.json, pnpm-lock.yaml, git HEAD)
3. git merge --ff-only <target>
4. lockfile 变了 → pnpm install;websearch 源码变了 → pnpm build:websearch
5. res.end()                       ← 必须先返回(更新的可能就是本插件)
6. hmr.runExclusive(() => hmr.reconcileProfile())
7. 结果落盘到 $DSH_HOME/plugin-update/last.json,面板刷新时读取
```

### 失败语义

- 第 1/2/3/4 步失败 → 还原快照,**运行中的代码未受影响**(报告 `ok:false` + 原因)
- 第 6 步失败 → 旧代码已死,**如实报 `failed`**,提示「修好文件后再点一次」;**不谎称回滚**

## 5. 前端设计

在 `client.js` 的 `apply()` 里新增两个 slot 注册(照 `sidebar.panellist` 的写法 `client.js:4346-4357`):

- `plugins.detail.actions`:对本仓库 bundle 渲染「更新到 x.y.z」/「已是最新」;`window.confirm` 在 `run()` **之前**(照 `CredentialVault.remove` `client.js:2530-2538` 的 confirm-before-run)
- `plugins.detail.badge`:可更新时显示「可更新 a → b」
- 非本仓库包 → **返回 null**(别的插件页零变化)
- 文案键加进 `client.js:53`(zh)与 `:352`(en)两个内联字典

## 6. 验收

1. 单测:非本仓库包 → slot 渲染 `null`;本仓库包 → 按钮出现且文案含目标版本(黑盒断言组件输出,不测私有函数)
2. 单测:apply 的前置校验——工作树脏 / 无法 ff-only / entry probe 失败,三种都必须**在动文件之前**中止
3. 契约:新路由常量被 `test/host-route.test.mjs` 的常量断言覆盖
4. `pnpm test` + `pnpm verify` 全绿;`dsh-inventory` 版本 bump
5. 人工验收(需你批准):在插件页点一次,确认免重启生效、fiber 回到 `active`

## 7. Tickets

| # | 标题 | 依赖 | 验收 |
| --- | --- | --- | --- |
| T1 | `lib/plugin-update.js`:repoRoot 解析、fetch/ff-only 探测、远端版本读取、前置校验 | — | 纯函数可测;脏工作树/非 ff 都返回 `{ok:false}` 且不写文件 |
| T2 | host 路由 GET/POST + 先响应后重组合 | T1 | 常量进路由断言;apply 顺序有测试(用一个假 hmr 断言"响应先于重组合") |
| T3 | client slot 注册(`plugins.detail.actions` + `.badge`) | T2 | 非本仓库包渲染 null;本仓库包按钮文案含目标版本 |
| T4 | 文案键(zh/en 内联字典)+ confirm-before-run | T3 | 两个字典键集一致(契约测试) |
| T5 | 版本 0.6.0 → 0.7.0、README、`pnpm verify` | T1-T4 | 版本纪律绿 |

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| 失败不恢复 → 插件 `failed` | 前置 entry probe;失败只报 `failed`,不谎称回滚 |
| 更新的是 inventory 自己 → 面板断连 | 先 `res.end()`;文案提示「面板会刷新」 |
| `hmr` 缺失(headless/SDK) | 降级 `restart-required/no-hmr`,绝不自动重启 |
| 多设备同时更新同一 checkout | 前置"工作树干净";后续可加 `$DSH_HOME` 编排锁 |
| 用户以为"只更新了这一个" | 结果里显式列出 `changed:[{name,from,to}]` 全部条目 + 文案说明"同一仓库一起更新" |
