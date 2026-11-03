# DSH-plugins

一个仓库，七个独立插件。每个目录都是可以直接被 DeepSeek Harness profile `link:` 的 bundle，各自有自己的 `package.json`、`cordis.patch.yml`、版本号和测试。

**这个仓库只放插件。** 服务器怎么配 DSH、profile 怎么接、密钥怎么管，都不在这里。

| 目录 | 包名 | 在 DSH 里做什么 |
| --- | --- | --- |
| [`packages/dsh-credential-vault`](packages/dsh-credential-vault) | `dsh-credential-vault` | 凭据保险库：服务器密码 / GitHub token / API key 的 AES-256-GCM 加密存储，`credential` 工具按名读取（reveal 全审计），管理界面在 dsh-inventory 的工具管理页 |
| [`packages/dsh-git-bash-tool`](packages/dsh-git-bash-tool) | `dsh-git-bash-tool` | Windows 专属：把 shell 换成 Git Bash，并关掉 pwsh 工具 |
| [`packages/dsh-git-status`](packages/dsh-git-status) | `dsh-git-status` | 只读 Git 概览：分支与最近提交、改动文件列表与只读 diff、stash 内容、冲突独立计数；装了 gh CLI 时还有未合并 PR 和 issue，分支名/commit 可复制可跳 GitHub |
| [`packages/dsh-inventory`](packages/dsh-inventory) | `dsh-inventory` | 安装清单 + 工作区 MCP/skill 开关 + 工具归属反查（含 `inventory-gate` 第二行） |
| [`packages/dsh-prompt-inject`](packages/dsh-prompt-inject) | `@local/dsh-prompt-inject` | 往所有 Agent 系统提示词注入一段可编辑文本，编辑器在 dsh-inventory 的工具管理页 |
| [`packages/dsh-websearch-failover`](packages/dsh-websearch-failover/plugin) | `dsh-websearch-failover` | `web_search` 有序多提供方失败转移，提供方管理器在 dsh-inventory 的工具管理页 |

`packages/dsh-websearch-failover` 是 websearch 的仓库根（含 `lib/`、`scripts/`、`test/`），真正装进 DSH 的 bundle 是它下面的 [`plugin/`](packages/dsh-websearch-failover/plugin)。

## 装上

profile 的 `package.json` 里逐个 link，包名不需要改：

```json
"dependencies": {
  "@local/dsh-prompt-inject": "link:../../packages/dsh-prompt-inject",
  "dsh-git-bash-tool": "link:../../packages/dsh-git-bash-tool",
  "dsh-inventory": "link:../../packages/dsh-inventory",
  "dsh-websearch-failover": "link:../../packages/dsh-websearch-failover/plugin"
}
```

相对路径 `../../packages/...` 假设 profile 目录与本仓库的 `packages/` 同级。然后 `pnpm install`，重启 DSH。要装哪个就留哪个，删掉一行等于不装。

## 开发

```bash
pnpm install          # 一次装齐 workspace 依赖
pnpm test             # 七个包全部测试
pnpm verify           # 校验每个包仍是合法 bundle
```

单包：`pnpm --filter dsh-inventory test`。

### 改代码前先读 `AGENTS.md`

**本仓库有强制的开发流程。** 任何会改动文件内容的请求——包括“只改一行”——
都要先调用 `dev-flow` skill：`issue → 分支 → TDD → PR → CI → 双轴 review → merge`。

规则入口见 [`AGENTS.md`](AGENTS.md)，完整规则在
[`packages/dev-flow-skill/SKILL.md`](packages/dev-flow-skill/SKILL.md)。
禁止直接改 `main`；merge 需要用户明确说出 `merge #<PR 号>`。

## 边界

- `dsh-lsp-actions` 不在本仓库。它是 PerryLink 上游的 fork，有自己的 workspace、lockfile 和发布流水线，跟着上游走。
- 根 `package.json` 不声明 `dsh.bundle`，否则它会变成第六个 bundle。
- 各包的包名、行 id、`cordis.patch.yml` 里的 `- id:` 一律不动，DSH 靠这些识别插件。
- `scripts/verify-packages.mjs` 只校验 `packages/` 内部，不检查任何 profile。宿主怎么接线是宿主的事。

## 跨机同步（dsh-inventory 的一部分）

同步能力在 [`dsh-inventory`](packages/dsh-inventory) 里，不是一个单独的插件。它做两件事：

- **发布**：把本机的插件 / MCP / skill 清单写成一份 `dsh-manifest.json`，推到清单仓库。默认会先脱敏（密钥、本机绝对路径），面板会告诉你脱掉了什么。
- **按需拉取**：读清单仓库，和本机现状比对，列出差异（`missing` / `outdated` / `blocked` / `disabled` / `current` / `local-only`），**你勾哪项就装哪项**，不会自动装。

`blocked` 是给不适合本机的项准备的：Windows 专属插件在 Linux 上、需要 GPU 的 skill 在没显卡的机器上、依赖 `officecli` 但没装的情况。它们不会被当成 `missing`，也不会出现在可勾选列表里。

配置（仓库地址、token、每项的平台/依赖标注）存在 `$DSH_HOME/plugin-sync.json`，不在 profile 里，也不会被发布。

HTTP 接口：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/inventory/sync` | GET | 配置状态 + 清单差异 |
| `/inventory/sync/config` | GET/POST | 读/改仓库地址与 token |
| `/inventory/sync/preview` | GET | 生成本机清单，返回脱敏报告，不写仓库 |
| `/inventory/sync/apply` | POST | `{selection:[...]}` 装勾选项；`{action:"publish"}` 发布 |
