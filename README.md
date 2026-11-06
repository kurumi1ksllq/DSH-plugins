# DSH-plugins

一个仓库，八个独立插件。每个目录都是可以直接被 DeepSeek Harness profile `link:` 的 bundle，各自有自己的 `package.json`、`cordis.patch.yml`、版本号和测试。

**这个仓库只放插件。** 服务器怎么配 DSH、密钥怎么管，都不在这里；这里只说 profile 接上去所需的最小接线。

| 目录 | 包名 | 在 DSH 里做什么 |
| --- | --- | --- |
| [`packages/dsh-credential-vault`](packages/dsh-credential-vault) | `dsh-credential-vault` | 凭据保险库：服务器密码 / GitHub token / API key 的 AES-256-GCM 加密存储，`credential` 工具按名读取（reveal 全审计），管理界面在 dsh-inventory 的工具管理页 |
| [`packages/dev-flow-skill`](packages/dev-flow-skill) | `dev-flow-skill` | 开发流程 skill：issue → 分支 → TDD → PR → CI → 双轴 review → merge，含 3 个停点与反绕过硬规则；装上去只注册 skill，不占工具位 |
| [`packages/dsh-git-bash-tool`](packages/dsh-git-bash-tool) | `dsh-git-bash-tool` | Windows 专属：把 shell 换成 Git Bash，并关掉 pwsh 工具 |
| [`packages/dsh-git-status`](packages/dsh-git-status) | `dsh-git-status` | 只读 Git 概览：分支与最近提交、改动文件列表与只读 diff、stash 内容、冲突独立计数；装了 gh CLI 时还有未合并 PR 和 issue，分支名/commit 可复制可跳 GitHub |
| [`packages/dsh-inventory`](packages/dsh-inventory) | `dsh-inventory` | 安装清单 + 工作区 MCP/skill 开关 + 工具归属反查（含 `inventory-gate` 第二行）；**插件页上每个本仓库插件的详情页头部有「更新」按钮**（免重启生效） |
| [`packages/dsh-prompt-inject`](packages/dsh-prompt-inject) | `@local/dsh-prompt-inject` | 往所有 Agent 系统提示词注入一段可编辑文本，编辑器在 dsh-inventory 的工具管理页 |
| [`packages/dsh-websearch-failover`](packages/dsh-websearch-failover/plugin) | `dsh-websearch-failover` | `web_search` 有序多提供方失败转移，提供方管理器在 dsh-inventory 的工具管理页 |

`packages/dsh-websearch-failover` 是 websearch 的仓库根（含 `lib/`、`scripts/`、`test/`），真正装进 DSH 的 bundle 是它下面的 [`plugin/`](packages/dsh-websearch-failover/plugin)。

## 装上

一台从没装过本项目的机器（Node ≥22、pnpm ≥10、已装 DSH），按四步做。

### 1. 拿代码

```bash
git clone https://github.com/kurumi1ksllq/DSH-plugins.git ~/DSH-plugins
cd ~/DSH-plugins && pnpm install
pnpm build:websearch   # 生成 packages/dsh-websearch-failover/plugin/lib（被 gitignore，clone 后不存在）
```

### 2. 在 profile 的 `package.json` 里逐个 link

本仓库共 8 个 bundle:下面 7 条是必装(线上 profile 目前装了前 5 个,`dev-flow-skill` 待补,见 #47),`dsh-git-bash-tool` 是 Windows 专属可选项。包名不需要改；路径写 clone 到的绝对路径（把 `/path/to/DSH-plugins` 换成你的 `~/DSH-plugins`）：

```json
"dependencies": {
  "dsh-credential-vault": "link:/path/to/DSH-plugins/packages/dsh-credential-vault",
  "dsh-git-status": "link:/path/to/DSH-plugins/packages/dsh-git-status",
  "dsh-inventory": "link:/path/to/DSH-plugins/packages/dsh-inventory",
  "@local/dsh-prompt-inject": "link:/path/to/DSH-plugins/packages/dsh-prompt-inject",
  "dsh-websearch-failover": "link:/path/to/DSH-plugins/packages/dsh-websearch-failover/plugin",
  "dev-flow-skill": "link:/path/to/DSH-plugins/packages/dev-flow-skill",
  "dsh-deep-ptc-mode": "link:/path/to/DSH-plugins/packages/dsh-deep-ptc-mode"
}
```

按需再补这条（同样要写进第 3 步的 `bundles`，否则不加载）：

```json
"dependencies": {
  "dsh-git-bash-tool": "link:/path/to/DSH-plugins/packages/dsh-git-bash-tool"
}
```

- `dsh-websearch-failover` 的 `/plugin` 后缀不能少——仓库根不是 bundle。
- `dev-flow-skill` 只注册 skill（包目录内的 `SKILL.md`），不新增工具；装上后会话目录会出现 `dev-flow`。若不想重启 DSH，改用 `~/.dsh/skills/dev-flow` 软链，`skill-filesystem` 会自动发现。
- `dsh-deep-ptc-mode` 是 Agent 模式（preset）插件：新增「深度PTC模式」会话模式，不新增任务工具。安装后需重启 DSH 并新建会话才能在模式选择器里看到它。
- `dsh-git-bash-tool` 是 Windows 专属（把 shell 换成 Git Bash、关掉 pwsh 工具），Linux/macOS 不要加。
- 要装哪个就留哪个，删掉一行等于不装。

### 3. 把包名写进 `dsh.profile.bundles`

**只加 dependencies 不会加载。** 同一个 `package.json` 的 `dsh.profile.bundles` 数组里也必须出现包名，否则 `pnpm install` 一切正常、DSH 里却看不到这个插件。关系是「包含」而不是「相等」：`bundles` 里通常还有 registry 插件和 `@deepseek-ai/*` 宿主行，**只要保证你 link 的每个包名都在里面**。下面只列本仓库的 8 个（不装的可选项删掉）：

```json
"dsh": {
  "profile": {
    "bundles": [
      "dsh-inventory",
      "@local/dsh-prompt-inject",
      "dsh-websearch-failover",
      "dsh-credential-vault",
      "dsh-git-status",
      "dev-flow-skill",
      "dsh-git-bash-tool",
      "dsh-deep-ptc-mode"
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

N 等于你实际留下的 link 条数（5 条必装 + 你选的可选包；当前线上 profile 是 5）。数量对不上，说明第 2 步和第 3 步没对齐。

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
都要先调用 `dev-flow` skill：`issue → 分支 → TDD → PR → CI → 双轴 review → merge`。

规则入口见 [`AGENTS.md`](AGENTS.md)，完整规则在
[`packages/dev-flow-skill/SKILL.md`](packages/dev-flow-skill/SKILL.md)。
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
