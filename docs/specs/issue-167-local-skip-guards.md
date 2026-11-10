# issue-167 / #168 · 缺 node_modules 时按前置跳过,而不是假红

> 分级 standard（改 4 个测试文件 + 新增 1 个探针 + 新增 spec）。两个 issue 同源同修,合一个 PR。

## 现象

改动前实测（issue #167 的原始证据，本分支复测一致）：packages/dsh-deep-ptc-mode 171 测 / 151 过 / 20 红。


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
| D1 | 无依赖的 worktree：deep-ptc **0 red** | ✅ 177 测 / 153 过 / **0 红** / 24 跳过 |
| D2 | 无依赖的 worktree：仓库契约 **0 red** | ✅ 87 测 / **87 过 / 0 红 / 0 跳过**（#168 不再需要跳过） |
| D3 | 依赖齐备（按 pnpm 布局软链实测）：**零跳过** | ✅ 177 过 / 0 跳过；契约 87/87 / 0 跳过 |
| D4 | CI：先 install 故全量 | 见下方「覆盖取舍」 |

## 覆盖取舍（review 后修正）

- **前置必须是测试真正需要的东西**：execution 的 3 条 composition 用例读的是仓库内 test/fixtures/*.patch.yml，只需要 js-yaml。
  初版把前置写成"已安装宿主声明"，而 @deepseek-ai/dsh-web-app 只是 peer（.npmrc 里 auto-install-peers=false），CI 永远不装——
  那会让它们在 CI 上永久跳过。已收窄为 js-yaml。
- **跳过范围必须贴住依赖**：upstream 的 17 条里 2 条不需要解析器（peer 声明检查、指向性验证）保持照常运行；
  verify-clean 只把 node_modules 那一条断言改成条件，泄漏检查照跑。
- CI 的期望不是"零跳过"，而是"依赖齐备时零跳过、依赖缺失时只跳真正依赖它的用例"。

## 裁剪

无裁剪。
