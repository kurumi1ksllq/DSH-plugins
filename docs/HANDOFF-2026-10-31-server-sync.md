# 交接：本地插件改造 → 服务器 dsh web 单向同步

> **2026-10-31 范围重定（最新，优先于下文）**
> 服务器 dsh **当前不需要运作**，唯一硬约束是 **本地不能炸、服务器别关机**。
> 因此：§7 第 5 项（本地起 18238 验证）降级为「可选」；§7 第 7、8 项（`bootstrap.sh` / systemd）
> 降级为备忘，不排期；§6.2 同步排除列表同样只作备忘。
> 已确认的本地安全事实：
> - 当前活着的 18237 由 `DeepSeek Harness.exe` PID **139244** 承载，其环境是
>   `DSH_PROFILE=desktop` / `DSH_PROFILE_DIR=C:\Users\admin\.dsh\profiles\desktop`，
>   **读不到 `profiles/web/`**，两者互不影响。
> - `profiles/web/node_modules` 只含 8 个条目，4 个 `link:` 全部指向本仓库 `packages/`；
>   `packages/*/` 下**没有任何 `node_modules`**，不存在反向污染。
> - `node scripts/build-plugin.mjs --check` → `plugin/lib is up to date (5 files)`，exit 0。
>
> **状态**：`profiles/web/` 已落地并实测通过，尚未 `git commit`。
> **目标**：让 `E:\Project-hub\DSH-plugins` 里的插件能在 Linux 服务器上被 `pnpm install` 解析并加载，
> 服务器配置单向跟随本地。
> 本文只讲**本地与仓库内**要完成的事；服务器 systemd / 反代另文。

---

## 0. 已确定的目录方案（方案 A）

**插件代码仓库同时承载 profile 配置**，`profiles/web/` 与 `packages/` 同级：

```
E:\Project-hub\DSH-plugins\          ← 插件仓库（GitHub: kurumi1ksllq/DSH-plugins）
├── packages/                        ← 5 个插件
│   ├── dsh-ctx-guard/
│   ├── dsh-git-bash-tool/
│   ├── dsh-inventory/
│   ├── dsh-prompt-inject/
│   └── dsh-websearch-failover/
│       ├── lib/                     ← 源码（入库）
│       └── plugin/                  ← 装进 DSH 的 bundle
│           └── lib/                 ← 生成物，.gitignore 排除 ← 见第 2 节
├── profiles/                        ← 【新增】profile 配置
│   └── web/
│       ├── package.json             ← link 用相对路径
│       ├── cordis.yml
│       ├── cordis.patch.yml
│       ├── pnpm-workspace.yaml
│       ├── pnpm-lock.yaml           ← 入库
│       └── node_modules/            ← .gitignore 排除
└── docs/
```

**为什么这个布局好**：`link:` 写 `../../packages/dsh-inventory`，本地 Windows 和服务器 Linux **相对位置完全一样**，所以 `package.json` 和 `pnpm-lock.yaml` 只有一份、都能进 git，服务器上不需要改任何文件。这是方案 A 最核心的价值。

服务器上对应位置：

```
/opt/dsh/DSH-plugins/profiles/web/    ← DSH_PROFILE_DIR 指向这里
```

---

## 1. 已完成项（实测）

`profiles/web/package.json` 现在的依赖：

```json
"dependencies": {
  "@local/dsh-prompt-inject": "link:../../packages/dsh-prompt-inject",
  "dsh-ctx-guard":            "link:../../packages/dsh-ctx-guard",
  "dsh-inventory":            "link:../../packages/dsh-inventory",
  "dsh-websearch-failover":   "link:../../packages/dsh-websearch-failover/plugin",
  "dsh-context": "0.74.0",
  "dsh-plugin-save-token": "^2.4.1",
  "dsh-tool-search": "0.1.8"
}
```

`bundles` 列表（17 项）**不含** `dsh-git-bash-tool`、`browser-skill`、`dsh-lsp-actions`，理由见第 3、4、5 节。

验证结果：

| 检查项 | 结果 |
|---|---|
| `pnpm install` | 成功，4 个 link 依赖全部建链 |
| 软链解析 | 4/4 指向 `packages/` 下正确目录 |
| bundle manifest | 4/4 有 `dsh.bundle.patch` 且文件存在 |
| `pnpm-lock.yaml` | 已生成，link 记录为 `../../packages/...` 相对路径 |
| `cordis.patch.yml` | YAML 解析通过，26 个条目 |
| `node_modules` | 已被 `.gitignore:2` 忽略，不会入库 |

`cordis.patch.yml` 由 desktop 那份派生，**删掉了 `dsh-lsp-actions` 整段**（原 321–530 行，servers 表全是 `E:/Project-hub/lsp-servers/*.exe` 的 Windows 路径，Linux 起不来）。其余 26 个 patch 条目保留。

---

## 2. 必须处理：`plugin/lib/` 是生成物，服务器会崩

### 证据

```
$ git check-ignore -v packages/dsh-websearch-failover/plugin/lib/
packages/dsh-websearch-failover/.gitignore:4:plugin/lib/  packages/dsh-websearch-failover/plugin/lib/

$ git ls-files packages/dsh-websearch-failover/plugin/lib | wc -l
0
```

而 `plugin/index.js:25-38` 硬导入这些文件：

```js
} from './lib/core.mjs'
} from './lib/runtime.mjs'
import { probeBalance } from './lib/balance.mjs'
import { API_BASE, createApiHandler } from './lib/api.mjs'
import { truncate } from './lib/http.mjs'
```

**服务器 clone 下来 `plugin/lib/` 是空的 → 加载 `dsh-websearch-failover` 直接 MODULE_NOT_FOUND。**

### 对照：其他三个包没问题

```
packages/dsh-ctx-guard/lib   : 2 files（已入库）
packages/dsh-inventory/lib   : 15 files（已入库）
```

只有 websearch 需要 build。

### 修复办法（二选一）

**方案 1（推荐，不改仓库约定）**：服务器引导脚本里加一步。

```bash
node packages/dsh-websearch-failover/scripts/build-plugin.mjs
```

实测可用：

```
$ node packages/dsh-websearch-failover/scripts/build-plugin.mjs
build-plugin: plugin/lib ready (5 modules from lib/)
$ node packages/dsh-websearch-failover/scripts/build-plugin.mjs --check
build-plugin: plugin/lib is up to date (5 files)   # exit 0
```

**方案 2**：改 `.gitignore` 让 `plugin/lib/` 入库。但这违背仓库现有设计（见脚本头部注释：“plugin/lib/ is generated output and gitignored; lib/ is the single source of truth”），**不建议**。

> 结论：走方案 1，build 步骤写进 `bootstrap.sh`，且放在 `pnpm install` **之前**（因为 install 时 link 会立刻指向一个缺文件的包）。

---

## 3. 必须处理：`dsh-git-bash-tool` 不上服务器

### 证据

`packages/dsh-git-bash-tool/index.js:25-28`：

```js
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const GIT_BIN = 'C:\\Program Files\\Git\\usr\\bin'
```

其 `cordis.patch.yml` 还会改写 shell 组合：

```yaml
- id: bash-sandbox
  disabled: false
  config: { timeoutMs: 60000 }
- id: pwsh-sandbox
  disabled: true
- id: tool-bash
  disabled: false
- id: tool-pwsh
  disabled: true
- insert:
    - id: git-bash-tool
      name: 'dsh-git-bash-tool'
```

在 Linux 上这条 insert 会把 `bash` 重写成 `C:\Program Files\...\bash.exe` → **服务器上所有 shell 命令全挂**。

### 现状

`profiles/web/package.json` 的依赖和 bundles 里**都已不含它**。desktop 那份保持不动。

### 可选增强

给插件加平台自检，`process.platform !== 'win32'` 时 apply 直接 no-op。这样两份 profile 可以共用 bundle 列表。成本约 5 行，**当前不做也能用**。

---

## 4. 已排除：`dsh-lsp-actions`

本地 `cordis.patch.yml` 的 LSP 段（原 321–530 行）全部指向 Windows 二进制：

```yaml
# >>> dsh-lsp-actions (2026-10-24, 本地 link: E:/Project-hub/dsh-lsp-plugin)
# servers 表全部用「原生 exe」或「node/java + 绝对入口脚本」启动
```

`E:/Project-hub/lsp-servers/` 里是 `marksman.exe`、`csharp/`、`dotnet/`、`omnisharp/` 等 **Windows 版**，同步不过去也不该同步。

`profiles/web/cordis.patch.yml` 已把整段删掉，替换为说明注释。插件 `engines` 要求 `dsh >=0.2.1-0 <0.3.0`，将来要启用时注意版本。

**将来要用 LSP**：在服务器装 Linux 版语言服务器，再在 `profiles/web/cordis.patch.yml` 插入最小行：

```yaml
- insert:
    - id: lsp-actions
      name: dsh-lsp-actions
      inject: [ tools, fs, subprocess ]
      config:
        editor: { enabled: false, requestTimeoutMs: 60000, diagnosticsCacheMaxFiles: 64 }
        servers:
          - command: clangd
            extensionToLanguage: { .c: c, .cpp: cpp }
```

---

## 5. 已排除：`browser-skill`

`@wxg-prc-cpg/browser-skill-dsh-plugin@0.3.3` 依赖本机登录态 Chromium。服务器既无浏览器也无登录态，加载后 `bsk_*` 工具全部报错。已从 web profile 的依赖和 bundles 移除。

---

## 6. 密钥与运行时状态：不进 git

### 6.1 密钥

`cordis.patch.yml` 实测**无内联密钥**（`grep -n "apiKey:"` 无输出），只有环境变量名：

```yaml
providers:
  newapi:
    apiKeyEnv: NEWAPI_API_KEY
  aaaaa:
    apiKeyEnv: AAAAA_API_KEY
```

所以 `cordis.patch.yml` **可以安全入库**。

密钥值走服务器本地：

```ini
# /opt/dsh/secrets.env   (chmod 600, 不进 git)
NEWAPI_API_KEY=...
AAAAA_API_KEY=...
```

systemd 里 `EnvironmentFile=/opt/dsh/secrets.env`。

**特例**：`dsh-websearch-failover` 的 provider 密钥在 `$DSH_HOME/websearch-failover/providers.json`（`plugin/index.js:9`），该文件**不同步**，服务器单独配。

`~/.dsh/.credentials.yaml` 同样不进 git。

### 6.2 运行时状态（禁止同步）

```
sessions/
storages/workspace.json
cache/
attachments/
websearch-failover-state.json
websearch-failover/
dsh-recover-quarantine/
backup/
dsh-runtimes/
```

---

## 7. 待办清单

| # | 事项 | 状态 |
|---|---|---|
| 1 | 建 `profiles/web/` 五件套 | ✅ 完成 |
| 2 | `pnpm install` 生成 lockfile | ✅ 完成 |
| 3 | 4 个 bundle 解析验证 | ✅ 完成 |
| 4 | 删掉 Windows LSP 段 | ✅ 完成 |
| 5 | 首次加载验证（`DSH_PROFILE_DIR=... dsh web`） | ⬜ **未做** |
| 6 | `git commit` | ⬜ 未做，等你确认 |
| 7 | 服务器 `bootstrap.sh`（含 build 步骤） | ⬜ 另文 |
| 8 | 服务器 systemd + `EnvironmentFile` | ⬜ 另文 |

第 5 项是**上线前必须做的**：本地先把问题暴露完，别到服务器才炸。做法：

```bash
DSH_PROFILE=web \
DSH_PROFILE_DIR="E:\Project-hub\DSH-plugins\profiles\web" \
dsh web --port 18238
```

开另一个端口，别撞现有 18237。看 4 个插件是否都加载、`inventory` 页是否正常。

---

## 8. 已知风险

| 风险 | 触发条件 | 应对 |
|---|---|---|
| `plugin/lib/` 空目录 | 服务器未跑 build | 第 2 节，build 写进 bootstrap |
| dsh 版本漂移 | 插件 engines 不匹配 | 锁 `dsh@0.2.1-rc.5`；插件要求 `>=0.2.1-0 <0.3.0` |
| lockfile 路径不一致 | profile 目录被移动 | 保持 `profiles/` 与 `packages/` 同级 |
| gateway baseURL 不通 | 该 IP 有访问限制 | 换官方 endpoint |
| 服务器 workspace 无写权限 | skill 分配报 EACCES | `dsh-inventory` 需要 workspace `.dsh/skills/` 可写 |
| git-bash-tool 误装 | 手动往服务器 profile 加回 | 第 3 节，直接别装 |
