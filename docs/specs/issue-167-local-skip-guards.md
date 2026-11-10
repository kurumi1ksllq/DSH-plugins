# issue-167 / #168 · 缺 node_modules 时按前置跳过,而不是假红

> 分级 standard（改 4 个测试文件 + 新增 1 个探针 + 新增 spec）。两个 issue 同源同修,合一个 PR。

## 现象

在**没有 node_modules** 的 checkout（如 `git worktree` 出来的干净树）里跑 `pnpm test`：

- `packages/dsh-deep-ptc-mode`：175 测 20 红（`Cannot find module 'js-yaml'`、`Cannot find package 'react'`、`cannot resolve @deepseek-ai/dsh-web-app/presets/ptc.patch.yml`）
- 仓库契约：`verify-clean` 的清理用例红（断言"宿主 checkout 必须保留 node_modules"，而它本来就没有）

CI 上不出现（workflow 先 `pnpm install`）。但本地/多 worktree 场景下极易被误读成"刚改的东西弄坏了它"。

## 目标

前置缺失时 `skip`（并给出原因），有前置时照常运行——不是删除测试、也不是无条件跳过。

## 设计

新增 `packages/dsh-deep-ptc-mode/test/support/prerequisites.mjs`：
`missingModule([...])` / `skipUnlessModules([...])`，用 `createRequire` 探测解析。

| 文件 | 前置 | 处理 |
| --- | --- | --- |
| `test/settings-ui.test.mjs` | `react`、`react-test-renderer` | 缺失则整文件以一条 skip 呈现 |
| `test/tool-controls-ui.test.mjs` | 同上 | 同上 |
| `test/upstream.test.mjs` | `js-yaml` | 同上（17 条里 15 条需要解析器） |
| `test/execution.test.mjs` | `js-yaml` + 官方 preset 可解析 | 仅 3 条 composition 用例跳过 |
| `test/verify-clean.test.mjs` | 宿主 checkout 有 `node_modules` | 该用例 skip 并说明原因 |

## 验收

| # | 验收 | 结果 |
| --- | --- | --- |
| D1 | 无 node_modules 的 worktree：deep-ptc `0 red` | ✅ 175 测 / 149 过 / 0 红 / 26 跳过 |
| D2 | 无 node_modules 的 worktree：仓库契约 `0 red` | ✅ 87 测 / 86 过 / 0 红 / 1 跳过 |
| D3 | 有 node_modules 的主 checkout：**不跳过**、全绿 | ✅ 175 过 / 0 跳过 |
| D4 | CI（先 install）保持全量 | 由 workflow `pnpm install` + `pnpm test` 保证 |

## 裁剪

无裁剪。
