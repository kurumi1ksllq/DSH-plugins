# DSH-plugins

一个仓库，八个独立插件。每个目录都是可以直接被 DeepSeek Harness profile `link:` 的 bundle，各自有自己的 `package.json`、`cordis.patch.yml`、版本号和测试。

**这个仓库只放插件。** 服务器怎么配 DSH、密钥怎么管，都不在这里；这里只说 profile 接上去所需的最小接线。

| 目录 | 包名 | 在 DSH 里做什么 |
| --- | --- | --- |
| [`packages/dsh-credential-vault`](packages/dsh-credential-vault) | `dsh-credential-vault` | 凭据保险库：服务器密码 / GitHub token / API key 的 AES-256-GCM 加密存储，`credential` 工具按名读取（reveal 全审计），管理界面在 dsh-inventory 的工具管理页 |
| [`packages/dev-flow`](packages/dev-flow) | `dev-flow` | 开发流程规则（常驻注入系统上下文）+ 任务板：issue → 分支 → TDD → PR → CI → 双轴 review → merge；并内置只读 Git 任务板面板（原 `dsh-git-status`：分支与最近提交、改动文件、PR/issue 概览 + dev-flow 任务板，一列 = 一个流程节点） |
| [`packages/dsh-inventory`](packages/dsh-inventory) | `dsh-inventory` | 安装清单 + 工作区 MCP/skill 开关 + 工具归属反查（含 `inventory-gate` 第二行）；**插件页上每个本仓库插件的详情页头部有「更新」按钮**（免重启生效） |
| [`packages/dsh-websearch-failover`](packages/dsh-websearch-failover) | `dsh-websearch-failover` | `web_search` 有序多提供方失败转移，提供方管理器在 dsh-inventory 的工具管理页 |
| [`packages/dsh-deep-ptc-mode`](packages/dsh-deep-ptc-mode) | `dsh-deep-ptc-mode` | 深度 PTC 会话模式（preset 插件）：执行环境选择（含 Git Bash 替换）、失速治理双引擎（结论锚点/软切拦截） |
| [`packages/dsh-skill-surface`](packages/dsh-skill-surface) | `dsh-skill-surface` | 只把官方 skill 发现器(provider)补挂到宿主平面;加载器由本包自带且仅对没有官方 skill 的 agent 可见,并支持委派时 `skills: a,b` 点名注入 |

## 装上

一台从没装过本项目的机器（Node ≥22、pnpm ≥10、已装 DSH），按四步做。

### 1. 拿代码

```bash
git clone https://github.com/kurumi1ksllq/DSH-plugins.git ~/DSH-plugins
cd ~/DSH-plugins && pnpm install
```

### 2. 在 profile 的 `package.json` 里逐个 link

本仓库共 8 个 bundle,下面全部必装。包名不需要改;路径写 clone 到的绝对路径(把 `/path/to/DSH-plugins` 换成你的 `~/DSH-plugins`):

```json
"dependencies": {
  "dsh-credential-vault": "link:/path/to/DSH-plugins/packages/dsh-credential-vault",
  "dsh-inventory": "link:/path/to/DSH-plugins/packages/dsh-inventory",
  "dsh-websearch-failover": "link:/path/to/DSH-plugins/packages/dsh-websearch-failover",
  "dev-flow": "link:/path/to/DSH-plugins/packages/dev-flow",
  "dsh-deep-ptc-mode": "link:/path/to/DSH-plugins/packages/dsh-deep-ptc-mode",
  "dsh-task-dispatcher": "link:/path/to/DSH-plugins/packages/dsh-task-dispatcher",
  "dsh-skill-surface": "link:/path/to/DSH-plugins/packages/dsh-skill-surface",
  "ecc-agent-presets": "link:/path/to/DSH-plugins/packages/ecc-agent-presets"
}
```

### 3. 把包名写进 `dsh.profile.bundles`

**只加 dependencies 不会加载。** 同一个 `package.json` 的 `dsh.profile.bundles` 数组里也必须出现包名，否则 `pnpm install` 一切正常、DSH 里却看不到这个插件。关系是「包含」而不是「相等」：`bundles` 里通常还有 registry 插件和 `@deepseek-ai/*` 宿主行，**只要保证你 link 的每个包名都在里面**。下面只列本仓库的 8 个（不装的可选项删掉）：

```json
"dsh": {
  "profile": {
    "bundles": [
      "dsh-inventory",
      "dsh-websearch-failover",
      "dsh-credential-vault",
      "dev-flow",
      "dsh-deep-ptc-mode",
      "dsh-task-dispatcher",
      "dsh-skill-surface",
      "ecc-agent-presets"
    ]
  }
}
```

数组里已有的其它条目（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-experimental-*`、`dsh-context` 等）是宿主自带或另装的 registry 插件，**原样保留，不要把整段替换掉**。

### 4. 安装、校验、重启

```bash
cd ~/.dsh/profiles/<profile> && pnpm install --prefer-offline
node ~/DSH-plugins/scripts/check-profile.mjs   # 期望 profile ok: N linked bundle(s)、无告警
```

N 等于你实际留下的 link 条数（本仓库 8 条必装 + profile 里原有的宿主/registry 行）。数量对不上，说明第 2 步和第 3 步没对齐。

首次接线需要重启一次 DSH（冷启动才会读新的 `package.json`）——**按仓库硬规则，重启必须先拿到用户明确批准**（见 `AGENTS.md` 与 `docs/update-checkout.md`）。重启后在 Web GUI 插件页确认每个插件都是 `active`。

装完之后的日常更新见 [`docs/update-scheme.md`](docs/update-scheme.md)：本地 link 的包是「原地换文件 + 触发一次重组合」，原则上不用重启；registry 来源的包走 DSH 自带的 plugin-manager。

## 开发

```bash
pnpm install          # 一次装齐 workspace 依赖
pnpm test             # 八个包全部测试
pnpm verify           # 校验每个包仍是合法 bundle
```

单包：`pnpm --filter dsh-inventory test`。

### 改代码前先读 `AGENTS.md`

**本仓库有强制的开发流程。** 任何会改动文件内容的请求——包括“只改一行”——
都会自动进入 `dev-flow` 流程（规则由插件常驻注入，不靠“记得加载 skill”）：`issue → 分支 → TDD → PR → CI → 双轴 review → merge`。

规则入口见 [`AGENTS.md`](AGENTS.md)，完整规则在
[`packages/dev-flow/FLOW.md`](packages/dev-flow/FLOW.md)。
禁止直接改 `main`；merge 需要用户明确说出 `merge #<PR 号>`。

## 边界

- `dsh-lsp-actions` 不在本仓库。它是 PerryLink 上游的 fork，有自己的 workspace、lockfile 和发布流水线，跟着上游走。
- 根 `package.json` 不声明 `dsh.bundle`，否则它会变成第九个 bundle。
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
