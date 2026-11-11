# #182 websearch 的 scripts.test 真正覆盖全部离线套件

- 分级：`standard`（改 2 个包脚本 + 5 个测试文件 + 根脚本 + 新增守卫 + README/CHANGELOG）

## 目标

`packages/dsh-websearch-failover` 的 `scripts.test` 只跑 3 个套件，末尾挂着一句**空转 glob**（匹配 0 个文件但 exit 0）。本 issue 让门禁真正覆盖全部离线测试文件，并修掉同族的两个静默空转点与一处真实 HOME 污染。

## 现状（实测）

```
node test/test-host-plugin.mjs && node test/test-integration.mjs && node test/test-mutex.mjs && node --test test/*.test.mjs
```

- `test/` 下 11 个 `.mjs`，但 `*.test.mjs` 匹配数 = **0**。`node --test test/*.test.mjs` → `tests 0` / **exit 0**。
- 未覆盖的 8 个文件中，`test-runtime` / `test-balance` / `test-api` / `test-client-static` / `test-client-render` / `mock-failover` 是真回归网。
- `test/probe-bundle.mjs` 是**零断言的辅助模块**（被 `test-host-plugin` 与 `test-integration` import），不是测试。
- 根 `package.json` 的 `test:websearch` 写成 `pnpm --filter websearch-dsh-plugin`，实际包名是 `dsh-websearch-failover`；`pnpm` 输出 `No projects matched` 且 **exit 0**。
- `test-t4web.mjs` 的 `:130` / `:197` 未传 `logPath`，`index.js:118` 缺省回落到 `$DSH_HOME/websearch-failover/plugin.log`。实测 `HOME=/root/fakehome node test/test-t4web.mjs` 会写 1 个文件——**不修则新门禁每次运行都污染真实 HOME**。

## 方案

### 1. 改 `scripts.test`（核心，1 行）

```diff
- "test": "node test/test-host-plugin.mjs && node test/test-integration.mjs && node test/test-mutex.mjs && node --test test/*.test.mjs",
+ "test": "node --test test/mock-failover.mjs test/test-*.mjs",
```

实测：10 文件 / **29 测 / 29 过 / 0 红**，exit 0。

**为什么不用 `test/*.mjs`**：会把零断言的 `probe-bundle.mjs` 算成 1 条「通过」的测试（实测 30 测里 1 条是假的），正好复制本 issue 要消灭的「绿但没测」。

**为什么不用串行 `&&` 逐个补 8 个**：11 段 `&&` 难读、每段各起一个进程，且**新增测试文件仍要手工加进链**——原缺陷会复发。

### 2. 修 `test-t4web.mjs` 的 HOME 污染（必须）

两处 `mod.apply(ctx, {...})` 补 `logPath: join(dir, 'plugin.log')`，用测试自己的临时目录。

### 3. 四个文件的临时目录清理

`mock-failover:48` / `test-runtime:29` / `test-host-plugin:27` / `test-integration:28` 均 `mkdtempSync` 后不清理。补 `process.on('exit', ...)`（与 #145 第 1 条同口径，本 PR 顺手做，避免新门禁把泄漏从 2 个/轮放大到 4 个/轮）。

### 4. 新增防复发 guard

`test/scripts-test-globs.test.mjs`：断言 `packages/*/package.json` 的 `scripts.test` 里每个含 `*` 的 `node --test` 参数，按文件系统展开后 **≥1 个文件**；且根 `package.json` 每个 `pnpm --filter <name>` 能对上真实包名。

### 5. 修根 `test:websearch` 的 filter 名

`websearch-dsh-plugin` → `dsh-websearch-failover`。

## 验收（含反向验证）

**真验收 = R1**（已实测）：把 `lib/core.mjs:486` 的冷却判断改成 `if (false && ...)`：

| 脚本 | 结果 |
| --- | --- |
| 当前 3 套件 + 空转 glob | host/integ/mutex/glob **全部 exit 0**（全绿） |
| 新脚本 | **exit 1**，29 测里 1 红 |

其余三条同样「今天绿、修好才红」：R2 删过期冷却清理段 → `test-t4web` 红；R3 改 order 归一化 → `test-runtime` 红；R4 改 client 模块 id → `test-client-static` + `test-client-render` 2 红。

**不写进验收表**（今天已红，会误导）：首次失败即抛、API 同源校验、余额比减半。

## 版本

`dsh-websearch-failover` 0.5.1 → **0.5.2**（patch）。根 `CHANGELOG.md` 加一条；顺带修正上一轮遗留的 note 计数（`dev-flow@0.7.0` 已打 tag，缺 tag 只剩 `dsh-skill-surface@0.1.0`）。

## 边界

- 只动测试脚本、测试文件、`package.json` 与文档（README/CHANGELOG/spec）；不改失败转移引擎、API、面板行为。
- 从 `origin/main` 起分支（已从 `7cc69c8` 起）。
- 不改 profile、不重启 DSH。

## 变更（2026-11-11，双轴 review 后）

两轴共 13 条，去重 11 条，全部采纳。最重要的三条改变了实现：

### 1. glob 改为覆盖两种命名（原方案会漏文件）

原方案 `test/mock-failover.mjs test/test-*.mjs` 只认 `test-*` 前缀，而**全仓其它 7 个包的测试文件全部叫 `*.test.mjs`**（88 个文件）。任何人按仓库惯例新建 `cache.test.mjs` 都会静默漏检且 exit 0——正是本 issue 要消灭的形状，只是换了个方向。

现改为 `test/mock-failover.mjs test/*.test.mjs test/test-*.mjs`。实测：加一个惯例命名的 `cache.test.mjs`，测试数 29 → **30**（旧写法仍是 29）。

### 2. 守卫加「覆盖率」用例（原守卫只防空 glob）

原守卫只断言「glob 至少匹配 1 个文件」，抓不住「漏文件」。新增用例断言**每个 `test/` 下的 `.mjs` 都被本包的某个 glob 命中**（显式白名单列共享模块）。

这条用例当场抓出**第三个真实缺陷**：`packages/dsh-deep-ptc-mode/test/test-t4ptc.mjs`（10 条 `node:test` 用例）从未被任何脚本执行。已补进该包的 `scripts.test`（deep-ptc 测试数 177 → **187**）。

### 3. 守卫自身重写：真 glob + 覆盖根 scripts + `--filter=` 形式

原 `expand()` 是手写的单星号展开，有四个洞：带斜杠后缀的 pattern 被静默跳过、多星号误判为 0 匹配、`--filter=name` 漏检、根 `package.json` 的 `node --test` 完全不查（而根 `test` 正是门禁本体）。现改用 Node 内置 `globSync`（node ≥22，无实验警告），并纳入根 scripts。

### 4. 其余

- `probe-bundle.mjs` 的临时目录原来只在 `cleanup()` 清，断言先失败即泄漏；改为在 `mkdtemp` 处注册 exit 钩子。
- 措辞校正：`DSH_HOME` 优先于 `HOME`，被写的是**活着的插件日志**，不是运行者的 home。
- spec 首行补分级；CHANGELOG 条目间补空行。

## 验收（更新后）

| 项 | 结果 |
| --- | --- |
| websearch 测试 | 29/29 绿 |
| deep-ptc 测试（含新纳入的 t4ptc） | 187/187 绿 |
| 仓库契约（含守卫 3 条） | 94/94 绿 |
| R1 反向验证 | 旧脚本 4 命令全 exit 0；新脚本 exit 1 / 1 红 |
| 惯例命名覆盖 | 加 `cache.test.mjs` → 29 → 30 |

### 5. 第二轮 review（13 条，全部采纳）的补充修复

| 发现 | 处理 |
| --- | --- |
| 第二处 `apply()` 仍把 `statePath` 落到真实 `$DSH_HOME` | 补 `statePath: join(dir, 'state.json')`。今天没读它，但任何将来触到 `snapshot()`/`search()` 的断言都会读写开发者真实状态 |
| 守卫把 flag 的值当路径（`--test-reporter spec` → 假红） | 加 `VALUE_FLAGS` 白名单，flag 的值被跳过 |
| 守卫 `expand()` 对嵌套 glob 返回 null 后被静默跳过 | 改用 `globSync` 真展开 |
| README 写死「10 个文件 / 29 个测试」 | 去掉数字——本仓已有两条「去掉写死测试数」的先例 |
| `probe-bundle.mjs` 失败路径仍泄漏 | 在 `mkdtemp` 处注册 exit 钩子 |
| spec §边界 与 §版本 自相矛盾 | 边界改为「测试脚本、测试文件、package.json 与文档」 |

**恢复被删的立项依据**（首轮改动误删）：

- `test-t4web` 污染实测：`HOME=/root/fakehome` 跑 → 落 1 个 `plugin.log`；修后 0 个。
- 选型理由：单条 `node --test` 由 glob 自动收新文件，串行 `&&` 每加一个测试文件都要手改。
- 必须从 `origin/main` 起分支：本地陈旧 checkout 会把 #180 的 README 修复回退。