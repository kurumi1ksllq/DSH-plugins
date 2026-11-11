# spec: 校准块纠正——ecc-agent-presets 已由用户启用(#183)

> 用户 2026-11-11 告知:自己在 profile 里启用了 `ecc-agent-presets`。
> #180(PR #181)刚合并的两份 update 文档把「未写进 bundles、当前不加载」记为已知缺口,该断言现已过期。

## 1. 问题(已复核)

| 事实 | 证据 |
| --- | --- |
| `dsh.profile.bundles` 已含 `ecc-agent-presets` | 读 `~/.dsh/profiles/web/package.json`;本仓库 8 个 bundle 全部 LOADED |
| 两份 update 文档仍写「不加载」 | `docs/update-scheme.md:15`、`docs/update-checkout.md:8` |
| profile patch 仍只有 5 个 `preset-*` 行 | 其余 133 个由 `ecc-agent-presets` 的 bundle patch 提供(符合设计) |

## 2. 目标

两份文档的现状校准块与 profile 实况一致;其余内容不动。

## 3. 边界

- 只改 `docs/update-scheme.md`、`docs/update-checkout.md` 各一行。
- 不动 profile、不重启 DSH、不改包代码 → **不升包版本**。
- 不改其它文档与测试。

## 4. 裁剪(自决留证)

- 分级:`standard`(触及 2 个文件,按 FLOW.md 的字面口径不算 trivial)。
- **裁掉双轴 review**,依据 FLOW.md「自决边界·裁剪」:改动是把两行过期事实改成已复核事实,无接口、无行为、无契约变更;事实由 `test/docs-contract.test.mjs`(31 条)与 `pnpm verify` 兜住。裁剪结论写进 commit 与 PR。

## 5. 验收

- 两份文档不再出现「ecc-agent-presets 不加载」的现状断言。
- `node --test test/docs-contract.test.mjs` 31/31 绿;`pnpm verify` 绿。
- 反向验证:把任一行改回「未加载」→ 由人工核对(无自动契约覆盖此句,已在 spec 记录该缺口)。
