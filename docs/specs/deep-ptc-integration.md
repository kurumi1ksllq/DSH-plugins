# 深度 PTC 模式集成 monorepo

上游：`lishize20040802-rgb/dsh-deep-ptc-mode` @ 1.7.3（MIT，Node >=24，DSH >=0.2.2-rc.1）。
用户要求：fork 到自己账号，并把插件集成进本 monorepo。

## 目标

1. GitHub 侧：fork 上游到 `kurumi1ksllq/dsh-deep-ptc-mode`。
2. monorepo 侧：新增 `packages/dsh-deep-ptc-mode`，成为第八个 bundle。
3. 全部校验绿：`pnpm verify` + `pnpm test`。

## 边界

- 上游业务代码（`lib/`、`scripts/`、`test/`、`cordis.patch.yml`、`compatibility.json`、`assets/`）原样拷贝，不改逻辑。
- 上游包名 `dsh-deep-ptc-mode`、cordis 行 id、engines（`node>=24`、`dsh>=0.2.2-rc.1`）、peerDependencies（8 个 `@deepseek-ai/*`，link: 安装时宿主路由必需）原样保留。
- `package.json` 仅改 `repository` 字段指向 fork 地址；author/license 保留上游署名。
- 拷贝排除：`package-lock.json`（npm 锁文件，本仓用 pnpm）、`.gitattributes`、`.gitignore`。
- 不在本仓库做 profile 接线（宿主侧自行 `link:`）；`check-profile` 注册后须保持 green。
- 不升版本号（保持 1.7.3；该包未打 tag，bump 检查自动跳过）。
- 允许的仓库配套改动：
  - `scripts/verify-packages.mjs`：`EXPECTED` 清单加一行；client 检查改为按宿主真实行为解析 `exports["./client"]`（string 或 `{default}`，断言目标存在；声明 dsh.client 但缺 exports 时报错）——停点2 重新确认项；
  - `scripts/check-profile.mjs`：`SHIPPED` 映射加一行；
  - `.github/workflows/ci.yml`：node-version 22 → 24（上游 engines 要求 node>=24，现有包声明兼容 24）；
  - 根 `package.json` 描述 seven → eight；
  - `README.md` / `AGENTS.md` / `CHANGELOG.md` / `docs/update-scheme.md` / `docs/update-checkout.md` 计数与清单更新（7 → 8）；
  - `test/docs-contract.test.mjs`：计数断言同步（见 TDD 说明）；
  - `pnpm-lock.yaml`：新增 importer 与 `js-yaml` / `react` / `react-test-renderer` 条目。

## 验收

1. `packages/dsh-deep-ptc-mode` 为自描述 bundle：`verify-packages` 输出 `dsh-deep-ptc-mode@1.7.3 -> packages/dsh-deep-ptc-mode`。
2. `pnpm install` 通过；`pnpm-lock.yaml` 含 `packages/dsh-deep-ptc-mode` importer 与 `js-yaml@4.3.2` 条目；不含 `@deepseek-ai/*` 的注册表依赖条目。
3. `pnpm verify` 全绿（含 check-bundle-versions 对新包 engines.dsh / test script 的检查）。
4. `pnpm test` 全绿：上游自带 8 个测试文件全部通过 + 仓库级 docs-contract 等测试通过。
5. 文档契约：README / AGENTS.md / CHANGELOG / update-scheme 的 bundle 计数 = 8，且 README bundles 清单含 `dsh-deep-ptc-mode`。
6. GitHub 存在 fork `kurumi1ksllq/dsh-deep-ptc-mode`。
7. PR 通过 CI + 双轴 review。

## Tickets（有序）

1. fork 上游仓库到 kurumi1ksllq（`gh repo fork`，不落本地文件）。
2. 克隆上游到 /tmp，拷贝为 `packages/dsh-deep-ptc-mode`（按边界排除）。
3. `pnpm install` 更新 lockfile；验证 peer 依赖不被自动安装（如 pnpm 尝试自动安装导致失败，则仓库 `.npmrc` 关闭 `auto-install-peers` 并在 PR 说明）。
4. `verify-packages` EXPECTED + `check-profile` SHIPPED 注册第八个 bundle。
5. `ci.yml` node-version 22 → 24。
6. 文档契约更新 7 → 8（红 → 绿）：README、AGENTS.md、CHANGELOG.md、update docs、docs-contract.test.mjs 断言同步。
7. 全量验收：`pnpm verify && pnpm test`。
8. push → PR（`Closes #<issue>`）→ CI → 双轴 review。

## TDD 说明

- 红：拷贝新包后 `docs-contract`（断言计数 7 vs 实际 8）与 `verify-packages`（EXPECTED 缺失）天然变红，红因正确指向"第八个 bundle 未登记"。
- 绿：更新计数文档、注册脚本清单后转绿。
- 上游自带测试作为既有回归套件跑绿；不新增针对上游私有符号的测试。
- `docs-contract.test.mjs` 的变更点：其"历史计数 8 属过期值"的豁免假设在集成后失效（8 成为当前值），需同步调整该断言。这是测试契约变更，已在边界中列明。

## 已知风险

- pnpm 对 8 个 `@deepseek-ai/*` peerDependencies 的处理：预期为告警不阻断；若 pnpm 尝试从公共 registry 自动安装导致失败，按 ticket 3 的兜底方案处理。
- 上游测试是否依赖宿主运行时：本地 node v24.15.0 先跑，必要时在 ticket 7 前解决。
- CI node 22 → 24 影响全仓库测试；现有包 engines 均声明兼容 24，向后兼容风险低。
