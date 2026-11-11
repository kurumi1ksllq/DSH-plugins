# Doublecheck report（历史快照）

> **历史快照（2026-10-25，0.3.x 时期）**：本文记录的是旧 `plugin/` 布局与独立安装器的
> 一次排查；安装方式与包布局已在 0.4.0 变更，现状见 [README.md](README.md)。
>
> Verdict: **green**

> 由 `doublecheck_report` 生成（2026-10-25T23:5x+08:00，本会话两次调用）。本机 `fs` seam 未挂载，工具无法自行落盘，故按工具返回的正文原样写入本文件。

## Spec

- **Goal**：让 dsh-websearch-failover 插件的左侧栏面板在 DSH Desktop 重新显示，并让 pnpm install 不再把它从 profile 的 node_modules 里 prune 掉（根因：未声明为依赖，被 pnpm 移入 node_modules/.ignored）。
- **Scope**：在范围内：(1) 已把 `~/.dsh/profiles/desktop/node_modules/.ignored/dsh-websearch-failover` 挪回 `node_modules` 并验证 bundle 完整；(2) 改 `scripts/install.mjs`：安装时在 profile `package.json` 的 `dependencies` 写入 `"dsh-websearch-failover": "link:<repo>/plugin"`，卸载时按文本精确移除；(3) 同步改 `test/test-install.mjs` 的期望（原来断言「不加 dependency」）；(4) 对真实 profile 跑一次 install 写入 `link:` 声明；(5) 更新 `HANDOVER.md` / `README.md` 记录根因与 pnpm 交互。不在范围内：插件运行时代码（`index.js` / `client.js` / `lib/*.mjs` / `cordis.patch.yml` 内容）、插件 UI 与功能、`web_fetch` 覆盖、DSH 自身源码、git 提交、自动重启 DSH Desktop。
- **Acceptance criteria**：
  1. `node tools/verify-installed.mjs` 输出 `installed bundle verified`，provider `available=true`。
  2. 真实 profile `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里含 `"dsh-websearch-failover": "link:E:/Project-hub/DSH-plugins/packages/dsh-websearch-failover/plugin"`，且 `dsh.profile.bundles` 与 `cordis.patch.yml` 的 managed 块保持不变。
  3. `npm test` 全绿（9 个测试文件全过），其中 test-install 覆盖：安装后 dependencies 含 link: 值、重复安装为 unchanged、`--uninstall` 逐字节还原 manifest 与 patch。
  4. 模拟 pnpm 的 extraneous 判定：声明后该目录出现在依赖树中（可用 `pnpm install` 在真实 profile 上复核，目录不再进 `.ignored`）。
  5. 用户重启 DSH Desktop 后 `GET /websearch-failover/api/state` 返回 200、boot graph 含 `dsh-websearch-failover`、左侧栏出现提供方管理器。
- **Failure modes**：profile 没有 `dependencies` 对象 → 报错拒装、零写入；已有不同 spec → 原地替换不重复；`--uninstall` 逐字节还原；仓库目录移动 → link 失效，文档写明重跑 install；pnpm 把目录换成 symlink → 加载行为不变，installer 重复执行需能覆盖 symlink；插件运行时代码与运行时状态不得被触碰；重启时机由用户决定。
- **Priorities**：先恢复可见性，再根治防复发，最后文档；正确性与幂等性优先于安装速度；测试全绿优先于少改文件；可选：真实 profile 实跑 `pnpm install` 复核。
- **Non-goals**：不改插件功能/UI/排序/余额逻辑；不新增 npm 依赖；不动 DSH 自身 `app.asar`；不自动重启或杀掉用户的 DSH Desktop；不 git commit / push；本轮固定 `link:`；不清理 profile 里其它 `.bak`。

## Test evidence

- failing runs: 0
- passing runs: 3

| 时间线 | 结果 | 内容 |
|---|---|---|
| 红 | fail | 改实现后旧断言失败：manifest 期望里没有 dependency 行（红证据） |
| 绿 | pass | `npm test`（9 文件，含 install 契约 14 条） |
| 绿 | pass | `node --check` + 全量 `npm test`，`npm_exit=0` |
| 绿 | pass | 真实 profile 重跑 install（symlink 状态幂等）+ 全量套件 `npm_exit=0` |

对抗审查期间补的两条用例（先红后绿）：

- `a stale dependency spec is replaced in place` —— dependencies 里已有 `link:E:/old/checkout/plugin` 时，安装后原地改写为当前 checkout 的 spec，键只出现一次，其它依赖保留。
- `re-install over a symlinked bundle updates it without damaging the checkout` —— 把 `node_modules/<bundle>` 换成 pnpm 风格的目录 symlink 后再次安装：内容更新、被链接的 checkout 完好、未被递归删除。

## Adversary review

Verdict: **unavailable**

原因（本机环境，不是交付缺陷）：本 host 的 subagents 走 `startActivation` 路径，`dsh-doublecheck` 的 adversary 评审在该路径下要求 `adversaryPreset`（只读 Agent Preset），当前 profile 的 `- id: doublecheck-guard` 行未配置该键，插件因此返回 `unavailable`，而不是伪造一个评审结论。

## Verification

Not run.

原因：`doublecheck_report` 的逐维度校验走 `workflowEngine` seam，本次调用返回 `null`（未运行）；本机未留下主进程日志，无法进一步定位是 seam 未挂载还是 verify provider 拒绝。

## Delivery

- implementation edits: 8
- 改动文件：`scripts/install.mjs`、`test/test-install.mjs`、`HANDOVER.md`、`README.md`（插件运行时代码未动，`git status` 仅这四个）

## 未关闭项

- 验收标准 5（重启后侧栏可见、`api/state` 200、boot graph 含插件）需用户在重启 DSH Desktop 后确认。在确认之前，本交付只能称为 **green**（证据齐全、审查未运行），不能称为 **proven**。
