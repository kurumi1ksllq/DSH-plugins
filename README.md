# DSH-plugins

一个仓库，五个独立插件。每个目录都是可以直接被 DeepSeek Harness profile `link:` 的 bundle，各自有自己的 `package.json`、`cordis.patch.yml`、版本号和测试。

| 目录 | 包名 | 在 DSH 里做什么 |
| --- | --- | --- |
| [`packages/dsh-ctx-guard`](packages/dsh-ctx-guard) | `dsh-ctx-guard` | 上下文预算硬闸：拒绝超大 write/edit/命令载荷，超过 token 水位冻结扩张类工具，附 `/handoff` 交接命令 |
| [`packages/dsh-git-bash-tool`](packages/dsh-git-bash-tool) | `dsh-git-bash-tool` | 把 Windows 上的 shell 换成 Git Bash，并关掉 pwsh 工具 |
| [`packages/dsh-inventory`](packages/dsh-inventory) | `dsh-inventory` | 安装清单 + 工作区 MCP/skill 开关 + 工具归属反查（含 `inventory-gate` 第二行） |
| [`packages/dsh-prompt-inject`](packages/dsh-prompt-inject) | `@local/dsh-prompt-inject` | 往所有 Agent 系统提示词注入一段可编辑文本，带侧栏编辑器 |
| [`packages/dsh-websearch-failover`](packages/dsh-websearch-failover/plugin) | `dsh-websearch-failover` | `web_search` 有序多提供方失败转移 + 侧栏余额管理器 |

`packages/dsh-websearch-failover` 是 websearch 的仓库根（含 `lib/`、`scripts/`、`test/`），真正装进 DSH 的 bundle 是它下面的 [`plugin/`](packages/dsh-websearch-failover/plugin)。

## 装上

profile 的 `package.json` 里逐个 link，包名不需要改：

```json
"dependencies": {
  "@local/dsh-prompt-inject": "link:E:/Project-hub/DSH-plugins/packages/dsh-prompt-inject",
  "dsh-ctx-guard": "link:E:/Project-hub/DSH-plugins/packages/dsh-ctx-guard",
  "dsh-git-bash-tool": "link:E:/Project-hub/DSH-plugins/packages/dsh-git-bash-tool",
  "dsh-inventory": "link:E:/Project-hub/DSH-plugins/packages/dsh-inventory",
  "dsh-websearch-failover": "link:E:/Project-hub/DSH-plugins/packages/dsh-websearch-failover/plugin"
}
```

然后 `pnpm install`，重启 DSH。要装哪个就留哪个，删掉一行等于不装。

## 开发

```bash
pnpm install          # 一次装齐 workspace 依赖
pnpm test             # 五个包全部测试
pnpm verify           # 校验每个包仍是合法 bundle，且 profile 指到这里
```

单包：`pnpm --filter dsh-inventory test`、`pnpm --filter websearch-dsh-plugin test`。

## 边界

- `dsh-lsp-actions` 不在本仓库。它是 PerryLink 上游的 fork，有自己的 workspace、lockfile 和发布流水线，跟着上游走。
- 根 `package.json` 不声明 `dsh.bundle`，否则它会变成第六个 bundle。
- 各包的包名、行 id、`cordis.patch.yml` 里的 `- id:` 一律不动，DSH 靠这些识别插件。

## profiles/

`profiles/web/` 是**服务器侧 DSH web profile**，与 `packages/` 同级，因此 `link:` 可以用相对路径
（`../../packages/...`），Windows 与 Linux 通用，`package.json` 与 `pnpm-lock.yaml` 各只需一份。

该 profile 刻意**不含** `dsh-git-bash-tool`（硬编码 `C:\Program Files\Git\bin\bash.exe`）和
`browser-skill`（依赖本机登录态 Chromium）。

## 部署到服务器

见 [`docs/HANDOFF-2026-10-31-server-sync.md`](docs/HANDOFF-2026-10-31-server-sync.md)。三条最容易踩的：

> 1. `packages/dsh-websearch-failover/plugin/lib/` 是**生成物且被 .gitignore 排除**，
>    服务器 clone 后必须先在 install 前跑 `node packages/dsh-websearch-failover/scripts/build-plugin.mjs`，
>    否则加载该 bundle 会 MODULE_NOT_FOUND。
> 2. **Node 必须 ≥ 24.2**。dsh 的 `bin.js` 用 `import.meta.main`，低版本上 CLI 会静默 exit 0、零输出。
> 3. **`DSH_HOME` 指到仓库根**，不要用 `DSH_PROFILE_DIR`（会被静默忽略并建一个空 profile）。
