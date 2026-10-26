# dsh-inventory

DSH 的只读安装清单插件。在 **左侧栏「安装总览」** 面板里显示这台机器上实际装了什么；面板顶部可切到 **「按工作区」**，看每个工作区自己声明了什么。

本包有**两个插件入口**：

| 入口 | 行 id | 作用 |
|---|---|---|
| `dsh-inventory` | `inventory` | 只读快照聚合 + `GET /inventory/snapshot` + 面板 |
| `dsh-inventory/gate` | `inventory-gate` | 按工作区门控 MCP：只有会话 cwd 命中 `<workspace>/.dsh/mcp.json` 才挂载对应服务器 |

两者分开成两行是有意的：清单是只读 HTTP 面，门控挂在每个 agent 生命周期上；分开后任一半失败都不会拖垮另一半。

### 门控行的 `serverNameSuffix`

bundle 里的 gate 行**不带 config**，装上去就按 `.dsh/mcp.json` 里写的 `serverName` 原样挂载，工具名是 `mcp__<serverName>__<tool>`。

如果你的 profile 已经把某个同名服务器注册成**全局行**（比如全局 `officecli`），同一作用域里再加一个同名 gate 实例会撞名。这种情况在自己的 profile `cordis.patch.yml` 里覆盖：

```yaml
- id: inventory-gate
  name: 'dsh-inventory/gate'
  config:
    serverNameSuffix: '-ws'    # 得到 mcp__officecli-ws__*
```

按 id 的 patch 是**整体替换 config**，不深度合并；省略的键回落 `gate.js` 的 `DEFAULTS`。清单页读回这个后缀，所以「按工作区」视图显示的挂载名和 gate 实际挂的一致。

## 显示什么

| 分区 | 数据源 | 说明 |
|---|---|---|
| 插件包 | profile `package.json`（dependencies + `dsh.profile.bundles`） | 标出未安装（orphan）、已加载、声明来源 |
| 插件加载行 | `ctx.loader.entries()` | 条目 id、模块名、启用状态、fiber 阶段 |
| MCP 服务器 | `@deepseek-ai/dsh-mcp-client` 行 + 运行时工具前缀 | 每台的连接状态、工具数、脱敏后的 command/url |
| 技能 | 磁盘根目录扫描 + `ctx.skills.list()` | 含 `disable-model-invocation` 的屏蔽桩、来源 rank |
| 工具 | `ctx.tools.schemas()` | 全量工具，含被 tool-search 折叠的（`deferred`） |
| 技能 → 工具 | SKILL.md 正文匹配 + 会话日志 | 四层：精确工具名 / MCP 服务名 / 外部命令 / 脚本路径；会话实证附命中次数 |
| **按工作区** | `ctx.workspaceRegistry.list()` + 每个工作区的 `.dsh/mcp.json` + 项目 skill 根 | 每个工作区声明的 MCP（含门控后的挂载名）、全局注册的 MCP、以及它可用的技能（按来源分组） |

## 只读保证

- 只有 `GET /inventory/snapshot`，没有写端点
- 不写任何 state 文件，不改 profile 配置，不改 SKILL.md
- 不注册模型可见的工具、skill 或 prompt 段落

## 快照接口

```
GET /inventory/snapshot[?refresh=1]
```

返回 `packages / rows / mcp / skills / tools / edges / warnings / counts`，以及按工作区视图的 `workspaces / globalMcp / gateServerNameSuffix / workspaceRegistryAvailable`。MCP 的 `env` 与 `headers` 一律不返回，`args` 里的密钥值会被替换为 `<redacted>`。

`workspaces[]` 每项：`{ id, title, path, available, mcp: { status, file, servers[], error? }, skills: [{ source, dir, rank, exists, skills[], diagnostics[] }], counts }`。`mcp.status` 为 `ok | missing | invalid`；`servers[].mountedAs` 是门控加过后缀的实际挂载名（读自 `inventory-gate` 行的 `serverNameSuffix`）。

## 安装

```bash
git clone https://github.com/kurumi1ksllq/dsh-inventory.git

# 在 profile 目录下，把插件 link 进 profile
cd ~/.dsh/profiles/desktop
pnpm add "link:<仓库克隆到的绝对路径>/dsh-inventory"
```

然后把 `dsh-inventory` 加进 `package.json` 的 `dsh.profile.bundles`，并在 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: inventory
      name: "dsh-inventory"
```

重启 DSH 后，左侧栏会出现「安装总览」入口；点进去是整页面板，左上角「‹ 返回对话」回到聊天。

## 开发

```bash
node --test test/*.test.mjs     # 单元测试（离线，不依赖 DSH）
node scripts/preview.mjs        # 用 profile 配置 + 真实 skill 目录跑一遍静态汇总
node scripts/smoke.mjs --snapshot=<snapshot.json>   # 用抓到的真实快照跑 host 集成冒烟
```

`npm test` 覆盖：多帧 zstd 会话解码、frontmatter（含 CRLF / symlink）、技能扫描与去重、四层边匹配、会话实证窗口、快照组装、包安装判定、工具归属推断、tool-search 折叠判定、客户端侧栏入口 + 主面板注册与三态渲染。

`scripts/smoke.mjs` 会起一个 stub Cordis 上下文，跑真实的 `apply()` 和 HTTP handler，验证 14 项：HTTP 200、幽灵包识别、deferred 计算、`bsk_*` 归属、`tool_search` 归属、MCP 全连通、技能扫描、屏蔽桩、会话实证、冷构建 <3s、agent 平面工具收录、global 平面工具收录、平面计数上报、payload 无密钥。本机实测冷构建 **626 ms**，15s 缓存命中 **3–4 ms**，payload 约 82 KB。

## 实测数据（本机 2026-10-25 审计，live 快照）

| 项 | 值 |
|---|---|
| 插件包 | 18：13 已加载、5 个「无自身加载行」（bundle 由 include 组成，loader 不暴露同名行）、0 未安装 |
| Loader 行 | 222 行 / 212 个不同模块名（其中 25 行 disabled） |
| MCP | 4 台全连通，41 个工具（codegraph 1 / davinci-resolve 37 / officecli 1 / context7 2），`mcp__` 前缀零遗漏 |
| 技能 | 35 = 磁盘 28（user-dsh 27 + user-agents 1）+ 插件运行时 7；磁盘侧零漏扫，7 个屏蔽桩 |
| 工具 | 113 = 全局平面 77 + agent 平面 36（4 个活跃 agent 的并集）；归属：内置 55 / MCP 41 / 插件 17 / 未识别 0；被 tool-search 折叠 98 |
| 关系边 | 131，其中 22 条带会话实证；96 个工具没有被任何技能指名 |

> 「未安装」判定看两件事：`package.json` 在**且**它声明的入口文件（`main` / `exports["."]`）也在。只有目录没有入口的包会被标 `orphan` 并在 `broken` 里写明缺什么——这正是首版把「包存在但没激活」误报成「幽灵包」后补的判据。

> 「已加载」不能只看同名行：bundle 的行是它 include 的模块（`dsh-doublecheck/grill`、`@deepseek-ai/dsh-llm` …），包本身没有同名行。判据按「同名行 → 以 `包名/` 开头的子行」逐级回退，`active` 优先；两者都没有的包标 `rowless`，UI 显示「无自身加载行」，不冒充「未加载」。

> 工具必须同时读两个平面：`ctx.tools.schemas()` 不带 scope 只返回**全局层**，而 `read/write/edit/pwsh/skill/todo_write` 这些核心工具由 agent preset 注册在**每会话平面**。只读全局会静默丢掉它们（这正是首版漏掉的东西）。插件通过 `ctx.get('agents').list()` 枚举活跃 agent，再按 agent 取 `schemas(agent)`，与全局层取并集，并在快照里回报 `toolPlanes`。

### 准确性边界（哪些是事实、哪些是推断）

| 面 | 证据等级 | 边界 |
|---|---|---|
| 插件包 / 加载行 / MCP 列表 | 事实（loader 与磁盘） | 完整；「已加载」见上条回退规则 |
| MCP 工具清单 | 事实（工具注册表前缀） | 与实际数量逐台核对一致 |
| 技能 | 事实（磁盘 + 运行时注册） | 只扫固定根目录，且 `cwd` 取 host 进程目录；**别的会话工作区里的项目级 `.dsh/skills` 不会出现** |
| 工具清单 | 事实（注册表并集） | 只覆盖快照时刻已注册的；插件注册的临时工具看不到 |
| 工具归属 | 推断 | `mcp__*` 确定；内置查静态名单；插件靠扫包内 JS 字面量——找不到就标「未识别」，不瞎猜 |
| 技能 → 工具 | 推断 | 文本匹配 + 会话窗口证据；命中次数只代表最近 12 个会话、窗口 8 次调用 |


## 生效方式

- **host 侧代码**：DSH 启动时加载，改完要重启 DSH（当前 profile 没开源码 HMR，`touch cordis.patch.yml` 不会重载插件代码）。
- **client 侧代码**：浏览器里刷新页面即可。
- 插件本身是只读的，加载失败最多让这一行 fiber 变 `failed`，不会阻止 DSH 启动；去掉 `cordis.patch.yml` 里的 `- insert: inventory` 即可回滚。

## 已知限制

- 工具归属是推断：`mcp__<server>__*` 确定；`BUILTIN_TOOLS` 只收 DSH 本体注册的工具（把它写成插件工具会导致归属错判，且扫描会跳过内置名）；其余通过扫描插件包 JS 里的工具名字面量判定，找不到就标「未识别」。
- 全局视图的技能只扫固定根目录（项目 `.dsh/skills`、项目 `.agents/skills`、`$DSH_CUSTOM_SKILL_DIRS`、`~/.dsh/skills`、`~/.agents/skills`、`$DSH_BUNDLED_SKILL_DIR`），其中「项目」取 host 进程的 `cwd`；「按工作区」视图改为按每个工作区自己的目录扫项目根，共享根只扫一次。
- 会话实证只读最近 12 个会话文件，窗口 8 次工具调用。
- 快照缓存 15 秒；`?refresh=1` 强制重算。
- 被屏蔽的 skill（`disable-model-invocation: true`）在运行时注册表里看不见，只能靠磁盘扫描，因此显示为「已屏蔽」。

## 面板布局约定（改 UI 前先读）

根节点是**唯一滚动容器**（`height: 100%` + `overflowY: auto`）。由此有三条硬约定：

1. 根节点的**每个直接子节点**都必须 `flexShrink: 0`（header / toolbar / chips / warn / errorBox / section）。列向 flex 默认把子元素压扁：分区一被压缩，`overflow: hidden` 会把展开的行裁掉，而且根节点 `scrollHeight` 永远等于 `clientHeight`——滚动条不出现，展开多了就再也看不到下面的内容。
2. 行内统一 `alignItems: center`，不要用 `baseline`。徽章盒（16px 行高 + 边框 = 18px）比文字行高，基线对齐会让徽章看起来比同一行的文字高一截。
3. 空字段不要渲染占位元素。`h('span', null, '')` 宽高都是 0，但仍然吃掉一个 `gap`，行与行之间的间距就歪了。

回归测试在 `test/client.test.mjs`（`panel rows stay whole and aligned once a lot is expanded`）：断言根节点子元素不收缩、全树无 `baseline`、无版本号的包行不产出空 span。

