# #182 websearch 的 scripts.test 真正覆盖全部离线套件

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

- 只动测试脚本、测试文件与根 `package.json`；不改失败转移引擎、API、面板行为。
- 从 `origin/main` 起分支（已从 `7cc69c8` 起）。
- 不改 profile、不重启 DSH。
