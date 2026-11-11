# D1 — 统一权威 checkout(运维方案)

> **现状校准（2026-11-11,main @ 9efbf72）**：本方案**已执行完成**,下文保留为执行当时的原始记录。
>
> - profile `/root/.dsh/profiles/web` 的 **8 条**本仓库 `link:` 全部指向 `/root/DSH-plugins`:
>   `dev-flow`、`dsh-credential-vault`、`dsh-deep-ptc-mode`、`dsh-inventory`、`dsh-task-dispatcher`、`dsh-websearch-failover`、`ecc-agent-presets`、`dsh-skill-surface`。
> - `node scripts/check-profile.mjs` 在本 worktree 会把 8 条报成「loads from a DIFFERENT checkout」(link 指向主 checkout),这是预期;在主 checkout 里跑应为 `profile ok: 8 linked bundle(s)`、0 条该告警。
> - `ecc-agent-presets` 曾只 link 未列入 `dsh.profile.bundles`(不加载);**2026-11-11 已由用户启用**,现 8 个本仓库 bundle 全部加载。
> - `node scripts/update.mjs plan` 会把 8 个本地包全部报 `/root/DSH-plugins`。
> - 运行时 DSH `0.2.2-rc.1`;registry 4 个:`@deepseek-ai/dsh-mcp-client@0.2.2-rc.1`、`dsh-context@0.83.0`、`dsh-tool-search@0.1.10`、`@wxg-prc-cpg/browser-skill-dsh-plugin@0.4.2`。
> - 旧 checkout `/root/dsh-workspace/DSH-plugins` 已不再被任何被加载的包引用;**目录本身尚未退役**(移动前先确认脚本不再引用)。
> - 正文里的 `dsh-ctx-guard`、`@local/dsh-prompt-inject`、`dsh-git-status` 是当时记录的包,现已删除或并入其他包。
> - 阶段 3(重启)以 Web GUI 插件页的实际 `active` 数为准——本文不做断言。

- 状态:**已执行完成(2026-11-11 复核)**——原文状态为「待批准」,现已作废。
- 关联:`docs/update-scheme.md` §4.4、决策点 D1。
- 前置结论:**未经你明确同意,不重启 DSH**。

## 1. 问题:有两份同名仓库在跑

profile `/root/.dsh/profiles/web` 的 6 个 `link:` 插件(当时)被劈成两半:

| checkout | 路径 | 加载的包 |
| --- | --- | --- |
| **A** | `/root/DSH-plugins` | `dsh-credential-vault`、`dsh-git-status` |
| **B** | `/root/dsh-workspace/DSH-plugins` | `@local/dsh-prompt-inject`、`dsh-ctx-guard`、`dsh-inventory`、`dsh-websearch-failover` |

两份是独立 clone:各自 `.git`、各自对象库、各自 remote(B 是 shallow、走 gh-proxy)。

### 后果(已经发生,不是理论)

1. **验证与实际运行脱钩**:在 A 里改代码、`pnpm gate` 全绿,线上那 4 个包一个字节都不变。
2. **更新只覆盖一半**:任何"更新仓库"的直觉动作,产出混代 profile(2 新 4 旧)。
3. **假更新信号**:任一侧拉到新 commit,L2 的 `plan` 就把 4 个包报成 `updatable`,内容却与插件无关。
4. `check-profile.mjs` 每次都打 4 条 "loads from a DIFFERENT checkout" 警告 —— P1-5 关卡在正确报警。

## 2. 目标

当时那 6 个 `link:` 包全部从 A 加载,B 退役。达成后 A 里的 `pnpm gate` 才真正代表线上。

## 3. 为什么必须重启

HMR 用 `ino:size:mtimeMs` 比对模块。**原地换文件**走 `module-comparison`,可免重启;
把 `link:` 指向**另一个目录**会触发 `restart-required(package-moved)` —— 换目录 = 必须重启。
这是 DSH 的安全边界,不是缺陷。窗口 = 一次进程重启,进行中的会话会断开重连。

## 4. 原始执行步骤(已于 2026-11-04 执行完成,仅存档)

### 阶段 0 — 预检(已跑,全绿)

| 检查 | 结果 |
| --- | --- |
| B 工作区是否干净 | 干净,无未提交改动 |
| B 是否有 A 没有的提交 | **无**(`7b624ef` 是 A 的祖先) |
| A 上 4 个包目录 / 入口文件 | 齐全、存在 |
| A 上 websearch 生成物 | `plugin/lib is up to date (5 files)` |
| A 是否同步 origin/main | 是(`9e95269`) |

### 阶段 1 — 改 profile 接线(不重启不生效)

改 `/root/.dsh/profiles/web/package.json` 四行,把 `link:/root/dsh-workspace/DSH-plugins/...`
换成 `link:/root/DSH-plugins/...`:

- `@local/dsh-prompt-inject` → `packages/dsh-prompt-inject`
- ~~`dsh-ctx-guard` → `packages/dsh-ctx-guard`~~(该包已从仓库删除,此项不适用)
- `dsh-inventory` → `packages/dsh-inventory`
- `dsh-websearch-failover` → `packages/dsh-websearch-failover/plugin`(注意 `/plugin` 后缀不能漏)

**改动前逐字节快照**五个文件到 `$DSH_HOME/update/snapshots/<runId>/`:
`package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、`pnpm-workspace.yaml`、`compatibility.json`。
(后两个最容易漏 —— DSH 管理器自身的失败恢复刻意不还原 `pnpm-workspace.yaml`。)

### 阶段 2 — 重新链接 node_modules

profile 的 `node_modules/<pkg>` 是符号链接,必须指向新目标。用 **pnpm**,不手写 symlink,
否则 lockfile 与实际脱节:

```bash
cd /root/.dsh/profiles/web && pnpm install --prefer-offline
```

然后 `node scripts/update.mjs plan` 确认:8 个包全报 `/root/DSH-plugins`,混代警告消失。

### 阶段 3 — 重启 DSH(需要你明确批准)

**我不会自己执行。** 由你确认后重启 `dsh web`。

### 阶段 4 — 重启后验证

```bash
node scripts/check-profile.mjs     # 期望 0 warning
node scripts/update.mjs plan       # 期望 8 包同属一个 checkout
```

再在 Web GUI 插件页确认 8 个插件都是 `active`(不是 `failed`)。

## 5. 回退

任一步出问题,**先回退文件,不要盲目再重启**:

1. 把快照目录里五个文件逐字节拷回 `/root/.dsh/profiles/web/`;
2. 重新 `pnpm install --prefer-offline`;
3. 再重启一次回到原状。

A/B 工作区都干净,不存在"丢代码"风险,回退只影响接线。

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 会话中断(重启) | 排在你不用时做 |
| 4 个包换成 A 的版本 | A 只比 B 多一个提交 `9e95269`,且只新增 `scripts/update/`,插件代码零差异 |
| `pnpm-lock.yaml` 被改写 | 已快照可回退 |
| 重启后加载失败 | A 上 4 包均通过 gate + 入口导入检查;阶段 4 有验证点 + 回退路径 |

## 7. 附带收益

完成后 B 目录退役(先确认 `check-artifacts.mjs` / `check-profile.mjs` 不再引用,再移动,不要直接 rm)。
