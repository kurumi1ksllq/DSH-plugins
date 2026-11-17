# issue-222:删除 rules-library 及其仓库引用

## 背景

`~/.agents/rules-library/`（8 个 `*.AGENTS.md`）用户判定为毫无意义，已从本机删除。
全局 `~/.dsh/AGENTS.md` 的「规则库位置」一行与「规则库自动引导(bootstrap)」整节已同步删除。
本 issue 处理仓库内残留的两处引用，使文档与现状一致。

## 目标

删除 DSH-plugins 仓库内对 rules-library 的两处引用。

## 改动

| 文件 | 原行 | 改法 |
|---|---|---|
| `docs/prompt-injection-inventory.md` | 49 | 删除「迁移规则附加层 · 规则库 bootstrap」整行 |
| `docs/specs/issue-211-prompts-owned-by-plugin.md` | 51 | 删除「规则库 bootstrap(`~/.agents/rules-library/`)是部署本地约定，**不**搬进插件。」一行 |

## 边界

- 只改这两行，不碰其它内容。
- 历史 spec 的其余决策记录不动，仅移除已失效的一条引用。
- 本机目录与全局 AGENTS.md 的改动在仓库外完成，不在本 PR 范围。

## 验收

- `docs/prompt-injection-inventory.md` 与 `docs/specs/issue-211-prompts-owned-by-plugin.md` 中 `rules-library` 零命中。
- `pnpm test` 与 `pnpm verify` 全绿。

## 分级

**trivial**：纯文档删行，无代码、无行为变更；裁掉双轴 review，四件套仍全跑。

## 变更记录

- 无。
