# DSH-plugins

一个仓库，六个独立插件。每个目录都是可以直接被 DeepSeek Harness profile `link:` 的 bundle，各自有自己的 `package.json`、`cordis.patch.yml`、版本号和测试。

**这个仓库只放插件。** 服务器怎么配 DSH、profile 怎么接、密钥怎么管，都不在这里。

| 目录 | 包名 | 在 DSH 里做什么 |
| --- | --- | --- |
| [`packages/dsh-ctx-guard`](packages/dsh-ctx-guard) | `dsh-ctx-guard` | 上下文预算硬闸：拒绝超大 write/edit/命令载荷，超过 token 水位冻结扩张类工具，附 `/handoff` 交接命令 |
| [`packages/dsh-git-bash-tool`](packages/dsh-git-bash-tool) | `dsh-git-bash-tool` | Windows 专属：把 shell 换成 Git Bash，并关掉 pwsh 工具 |
| [`packages/dsh-inventory`](packages/dsh-inventory) | `dsh-inventory` | 安装清单 + 工作区 MCP/skill 开关 + 工具归属反查（含 `inventory-gate` 第二行） |
| [`packages/dsh-plugin-sync`](packages/dsh-plugin-sync) | `dsh-plugin-sync` | 启动时对齐插件：读目标 git 仓库的清单，比对本 profile 已装的，缺的装、旧的报 |
| [`packages/dsh-prompt-inject`](packages/dsh-prompt-inject) | `@local/dsh-prompt-inject` | 往所有 Agent 系统提示词注入一段可编辑文本，带侧栏编辑器 |
| [`packages/dsh-websearch-failover`](packages/dsh-websearch-failover/plugin) | `dsh-websearch-failover` | `web_search` 有序多提供方失败转移 + 侧栏余额管理器 |

`packages/dsh-websearch-failover` 是 websearch 的仓库根（含 `lib/`、`scripts/`、`test/`），真正装进 DSH 的 bundle 是它下面的 [`plugin/`](packages/dsh-websearch-failover/plugin)。

## 装上

profile 的 `package.json` 里逐个 link，包名不需要改：

```json
"dependencies": {
  "@local/dsh-prompt-inject": "link:../../packages/dsh-prompt-inject",
  "dsh-ctx-guard": "link:../../packages/dsh-ctx-guard",
  "dsh-git-bash-tool": "link:../../packages/dsh-git-bash-tool",
  "dsh-inventory": "link:../../packages/dsh-inventory",
  "dsh-plugin-sync": "link:../../packages/dsh-plugin-sync",
  "dsh-websearch-failover": "link:../../packages/dsh-websearch-failover/plugin"
}
```

相对路径 `../../packages/...` 假设 profile 目录与本仓库的 `packages/` 同级。然后 `pnpm install`，重启 DSH。要装哪个就留哪个，删掉一行等于不装。

## 开发

```bash
pnpm install          # 一次装齐 workspace 依赖
pnpm test             # 六个包全部测试
pnpm verify           # 校验每个包仍是合法 bundle
```

单包：`pnpm --filter dsh-inventory test`、`pnpm --filter dsh-plugin-sync test`。

## 边界

- `dsh-lsp-actions` 不在本仓库。它是 PerryLink 上游的 fork，有自己的 workspace、lockfile 和发布流水线，跟着上游走。
- 根 `package.json` 不声明 `dsh.bundle`，否则它会变成第七个 bundle。
- 各包的包名、行 id、`cordis.patch.yml` 里的 `- id:` 一律不动，DSH 靠这些识别插件。
- `scripts/verify-packages.mjs` 只校验 `packages/` 内部，不检查任何 profile。宿主怎么接线是宿主的事。

## 插件自动对齐

[`dsh-plugin-sync`](packages/dsh-plugin-sync) 启动时读目标仓库根目录的 `dsh-plugins.json`，比对本 profile 已装插件的版本。默认只报告，`apply: true` 才真正安装/更新。默认 `repo` 为空，即完全静默不联网。
