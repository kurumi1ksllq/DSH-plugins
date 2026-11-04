# dsh-inventory

DSH 的安装清单插件。左侧栏 **「工具管理」** 面板分两部分：

- **总览**：先放三块**可改的运行时设置**——**Web 搜索提供方**（调用优先级、各家余额、冷却倒计时、启用/停用、刷新余额）、**凭据保险库**（掩码列表、新增/编辑/删除、主密钥轮换、使用日志）、**提示词注入**（注入到所有 Agent 系统提示词的文本，直接编辑保存），然后才是这台机器上装了什么：**插件包 / MCP 服务器 / 技能** 三块；
- **工作区**：先列出所有工作区，点进某一个工作区就是它的详情页——每个 MCP / 技能一行，**一个能力只有一处开关能改结果**。

分段控件另有 **同步**。Web 搜索提供方 / 凭据保险库 / 提示词注入各有自己的分段标签，可以单独打开成大页；三者都直接读 host 的路由（`/websearch-failover/api/*`、`/credential-vault/api/*`、`/prompt-inject/state`），**不再占用侧边栏入口**（`dsh-websearch-failover`、`dsh-credential-vault`、`@local/dsh-prompt-inject` 的浏览器半区现在只注册各自的文案字典，页面由本面板渲染）。

本包有**两个插件入口**：

| 入口 | 行 id | 作用 |
|---|---|---|
| `dsh-inventory` | `inventory` | 快照聚合 + `GET /inventory/snapshot` + `POST /inventory/workspace`（分配）+ 面板 |
| `dsh-inventory/gate` | `inventory-gate` | 按工作区门控 MCP：只有会话 cwd 命中 `<workspace>/.dsh/mcp.json` 才挂载对应服务器 |

两者分开成两行是有意的：清单是 HTTP 面，门控挂在每个 agent 生命周期上；分开后任一半失败都不会拖垮另一半。

### 门控行的 `serverNameSuffix`

bundle 里的 gate 行**不带 config**，装上去就按 `.dsh/mcp.json` 里写的 `serverName` 原样挂载，工具名是 `mcp__<serverName>__<tool>`。

如果你的 profile 已经把某个同名服务器注册成**全局行**（比如全局 `officecli`），同一作用域里再加一个同名 gate 实例会撞名。这种情况在自己的 profile `cordis.patch.yml` 里覆盖：

```yaml
- id: inventory-gate
  name: 'dsh-inventory/gate'
  config:
    serverNameSuffix: '-ws'    # 得到 mcp__officecli-ws__*
```

按 id 的 patch 是**整体替换 config**，不深度合并；省略的键回落 `gate.js` 的 `DEFAULTS`。清单页读回这个后缀，所以工作区详情页显示的挂载名和 gate 实际挂的一致。

### 模型怎么知道这个能力

门控只决定挂不挂，它不会向模型解释自己——一个在无关工作区里的会话，看到的是「没有那些工具」，而不是「这里可以声明 MCP」。同理，一个被要求「帮我装个 MCP / 技能」的模型如果不知道约定，会自己造一份全局副本，把按工作区的模型破坏掉。

所以 `index.js` 通过 `ctx.systemPrompt.section()` 注册一段全局提示（`name: dsh-inventory:workspace-capabilities`、`order: 150`），内容包含：

- **注册与启用分开**：注册是全局的、惰性的；启用是按工作区的，agent 创建时读一次
- MCP 注册形态：profile patch 里一条**停用**的 `@deepseek-ai/dsh-mcp-client` 行（`disabled: true`），定义留在 `config` 里
- MCP 启用形态：把该 `config` 拷进 `<workspace>/.dsh/mcp.json` 的 `servers[name]`，挂载名带 gate 后缀
- 技能注册形态：`$DSH_HOME/inventory/skills/<name>/SKILL.md`（仓库）；启用形态：`<projectRoot>/.dsh/skills/<name>` 目录链接
- 怎么查当前状态：`GET /inventory/snapshot` 的 `vault` / `workspaces[].mcp` / `workspaces[].skills`，或侧边栏「工具管理 → 工作区 → 某个工作区」

这段进每个请求，约 150 token。它注册在 `webServer` 守卫之前，所以没有 Web 服务器的 profile（headless / ACP）里模型同样能看到。

### 测试与覆盖点(0.7.1)

更新路由的 apply 全流程在 `performUpdate({repo, stateDir, respond, reconcile})` 里,仓库与
状态目录都是参数 —— 测试在临时 git 仓库上跑,绝不碰真实 checkout 与真实 `$DSH_HOME`。
(0.7.0 的一条 route 测试会真的 `git fetch` 并写真实的 `last.json`,曾覆盖用户看到的更新结果。)

两个覆盖点:

| 变量 | 作用 |
| --- | --- |
| `DSH_INVENTORY_UPDATE_REPO` | 指定要更新的仓库(默认从本插件文件位置反解出 git 顶层) |
| `DSH_HOME` | 状态目录所在(`<DSH_HOME>/plugin-update/last.json`) |

`DSH_INVENTORY_UPDATE_REPO` **必须是绝对路径**(相对值会被忽略,以免按服务进程的 cwd 解析到
别的仓库),并且仍要过 `<root>/packages/dsh-inventory/package.json` 的 `name === 'dsh-inventory'`
校验;`DSH_HOME` 只决定状态文件写在哪,没有可校验的仓库身份。

## Plugins-page update button (0.7.0)

`dsh-inventory` contributes two cells to the Plugins page's own slot contract —
nothing in the host package is patched:

| Slot | What it draws |
| --- | --- |
| `plugins.detail.actions` | 「更新到 x.y.z」at the head of a bundle's detail page |
| `plugins.detail.badge` | 「可更新 a → b」next to the version |

Both render `null` unless the subject's package name is a bundle **in the
checkout this plugin runs from**, so every other plugin's page is untouched.

Clicking one advances that whole checkout (`git fetch` + `git merge --ff-only`)
and then asks for one recomposition:

```js
ctx.get('hmr').runExclusive(() => ctx.get('hmr').reconcileProfile())
```

That is the `dsh-hmr` public API and the path `dsh-plugin-manager` itself uses,
so a successful update needs **no restart**. A profile without `hmr`
(headless/SDK) gets an honest `restart-required / no-hmr` instead, and this
plugin never restarts anything.

Two rules the implementation must keep, both from `dsh-hmr`'s "the old version is
not restored":

1. every refusal (dirty tree, detached HEAD, not fast-forwardable, already up to
   date) happens **before** a single file moves;
2. the caller is answered **before** the recomposition, because the bundle being
   updated may be this one and a recomposition stops it.

Routes: `GET /inventory/plugin-update` (state + per-bundle versions) and
`POST /inventory/plugin-update/apply`.

## 显示什么

| 分区 | 数据源 | 说明 |
|---|---|---|
| **Web 搜索提供方** | `GET/POST /websearch-failover/api/*`（`dsh-websearch-failover` 的 host 半区） | 顺序即调用优先级：拖动或上/下移按钮调整；每行显示余额（按各家单位）、状态点与冷却倒计时；详情给出重置时间、密钥、本地调用统计、启用/停用、只刷新这一家。**余额只在点「刷新余额」时才请求**（接口按次计费） |
| **凭据保险库** | `GET/POST /credential-vault/api/*`（`dsh-credential-vault` 的 host 半区） | 掩码列表 + 详情；新增/编辑、删除、主密钥轮换、使用日志；**导出/导入**（0.5.0：口令加密 .dsvault 信封，跨设备同步，按 id 去重） | 掩码列表 + 详情；新增/编辑（编辑时留空即保留原值）含**服务**与**别名**字段、名称下方实时显示**规范化 slug**、`kind` 可选「数据库」，删除、主密钥轮换、使用日志。**任何路由都不回传明文**，面板只显示 `preview`；别名是 AI 唯一不可写的元数据 |
| **提示词注入** | `GET/POST /prompt-inject/state`（`@local/dsh-prompt-inject` 的 host 半区） | 编辑注入到所有 Agent 系统提示词的文本；空文本本地拦截不发请求，保存后新的模型请求即生效 |
| 插件包 | profile `package.json`（dependencies + `dsh.profile.bundles`） | 标出未安装（orphan）、已加载、声明来源 |
| MCP 服务器 | `@deepseek-ai/dsh-mcp-client` 行 + 运行时工具前缀 | 每台的连接状态、工具数、脱敏后的 command/url；全局开关在这一行 |
| 技能 | 磁盘根目录扫描 + `ctx.skills.list()` | 只列磁盘上的技能：含 `disable-model-invocation` 的屏蔽桩、来源 rank；插件在运行时注册的（没有目录、没有 SKILL.md）**不列也不计数**；全局开关在这一行 |
| **工作区 → 列表** | `ctx.workspaceRegistry.list()` | 一卡一个工作区：title、path、已声明的 MCP 数、**技能「已开启/总数」**——和详情页同一个集合（已装技能 ∪ 该工作区自己的项目根，去掉运行时注册与当前隐藏的）；整卡可点进详情 |
| **工作区 → 详情** | 该工作区的 `.dsh/mcp.json` + 项目 skill 根 + 全局 MCP / 技能清单 | MCP 与技能各一行一条；**只给"由本工作区决定"的行开关**，全局已可用的行折叠成「全局已可用」并锁住（语义见下节）；标题的「N 项」和 hint 永远同一集合 |

前两行是**可改的运行时设置**，也是原先两个独立侧边栏入口（`websearch-failover`、`prompt-inject`）搬进来的位置：它们各有分段标签，且都直接读 host 路由，不经过 `/inventory/snapshot`。它们是独立组件，只在外壳渲染时挂载一次，所以刷新清单不会打断一次正在进行的排序或编辑。

工具清单与技能 → 工具依赖图不在总览页：总览回答「装了什么」，技能分区里仍能看到每个技能引用到的工具（`N 工具`、`N 条引用` 徽章与展开行），工作区详情页不再重复这两块。

### 官方条目默认不显示

「工具管理」回答的是「这台机器上我装了什么」，不是「DSH 自带什么」。所以 `@deepseek-ai/*` 的插件包（`dsh-base`、`dsh-web-app`、experimental bundle 等）**默认不列出**。

工具栏「总览 / 工作区」旁边的 **显示官方** 按钮把它们临时放回来，再点一次（此时按钮写「隐藏官方」）收起。统计卡片跟着当前可见集合走；插件包分区如果只是因为全被隐藏而空着，会写「官方条目已隐藏」而不是「没有插件」。

`mcp__<server>__*`、第三方插件包、技能都不受影响——那些才是要看的。

### 单个技能可以隐藏

技能一多，列表就不适合一眼看完。每行右侧有个眼睛按钮：点一下，只藏这一条——分区和其他行照旧，工作区详情里的同名技能一起藏。隐藏集合按名字记在 `localStorage` 的 `dsh-inventory:hidden-skills`，重开面板也不会自己回来；工具栏的 **显示已隐藏 N** 按钮把藏起来的行放出来（变暗显示），行尾的眼睛再点一次就取消隐藏。隐藏只影响列表，不改变技能是否被模型加载。

## 工具管理页与其它 bundle 的关系

「工具管理」页不只渲染本插件自己的数据：几个分段标签的内容，实际调用的是**另外三个
bundle 的宿主路由**。

| 分段 | 调用的路由前缀 | 由谁注册 |
| --- | --- | --- |
| 凭据保险库 | `/credential-vault/api/*` | `dsh-credential-vault` |
| Web 搜索提供方 | `/websearch-failover/api/*` | `dsh-websearch-failover` |
| 提示词注入 | `/prompt-inject/*` | `@local/dsh-prompt-inject` |

这三个 bundle 在 `package.json` 里**没有声明为本插件的依赖**（DSH 的 bundle 之间没有
依赖机制，profile 决定谁被加载）。所以：

- profile 里**同时启用**这四个 bundle 时，整页可用；
- 只启用 `dsh-inventory` 时，这三个分段会显示「操作失败 (HTTP 404)」——不是 bug，
  是宿主路由确实不存在；
- `scripts/check-profile.mjs` 会对这种「inventory 在、分段 bundle 不在」的组合给出
  **告警**（不是错误），帮你发现漏装。

## 技能 → 资产依赖图

技能发现是 **depth 1**（`<root>/<name>/SKILL.md`），和 DSH 的发现规则一致。所以「路由 skill + `refs/` 附属资源」这种结构里，`refs/` 下的文件对扫描器是**不存在的**——面板上看不到谁依赖谁，也看不到引用有没有断。

`lib/skill-deps.js` 补上这一层：对每个已发现的 skill，读它的 `SKILL.md` 和 `refs/**/*.md`，抽出正文里提到的本地路径，解析成绝对路径，`existsSync` 判定存在性。

**只认这些显式形态**（宁可少一条，不可错一条）：

| 认 | 例 |
|---|---|
| 盘符绝对路径 | `C:\Users\me\.dsh\skills\office\refs\officecli-xlsx.md` |
| 已知资产前缀 | `refs/` `reference/` `references/` `scripts/` `assets/` `templates/`，**且该前缀目录在 skill 内确实存在** |
| `../` 相对 | `../morph-ppt/reference/styles/INDEX.md` |
| 旧式 skill 引用 | `skills/officecli-pptx/SKILL.md` |
| markdown 链接 | `[x](refs/a.md)` |
| 裸文件名 | 仅当它在同目录 / `refs/` / `references/` 下**真的存在** |

**明确忽略**：命令片段（`officecli create a.pptx`）、URL（`http://HOST:8188/prompt`）、XML 路径（`/body/p[1]`、`/Sheet1/A1`）、占位符（`refs/<name>.md`）、裸目录（`reference/`），以及**前缀目录不存在**的相对路径（`scripts\selftest.py` 写在 `E:\AI\...\py.bat` 旁边时，它属于那个外部项目，不是本 skill 的资产）。

三条实现细节，改之前先看：

1. **相对路径以文件所在目录为基准**，不是 skill 根。`refs/morph/guide.md` 里的 `reference/rules.md` 指向 `refs/morph/reference/rules.md`。
2. **重复目录前缀去一次**：`reference/styles` 写在 `reference/` 里，落点是 `reference/styles`，不是 `reference/reference/styles`。
3. **自环与越界丢弃**：`office/SKILL.md` 提到自己不算边；解析结果不在技能根内的一律不认。

产出挂在快照两处：每个 skill 行的 `deps: { assets, refs, missing, edges }`，以及顶层 `skillDeps: { skills, assets, edges, missing }` 总计。缺失的边同时写进 `warnings`（`code: skill-ref-missing`），所以不展开技能行也能在页面顶部看到。

面板表现：技能行多一个「N 资产」徽章（有缺失时变红点），展开后先列文件引用（`from → to`，缺失的带「引用缺失」徽章），再列原来的工具引用。

`node scripts/preview.mjs` 会把这些直接打出来，不用起 DSH：

```
office (user-dsh) · 66 assets · 53 refs · 1 MISSING
ui-design (user-dsh) · 4 assets · 3 refs
```



## 注册与启用（这是本插件的核心约定）

**注册是全局的、惰性的；启用是按工作区的。** 没启用的能力不 spawn、不进模型目录，所以上下文只为已启用的东西付费。

| 能力 | 注册在哪 | 为什么惰性 |
|---|---|---|
| MCP | profile 的 `cordis.patch.yml` 里一条 `@deepseek-ai/dsh-mcp-client` 行，**停用**（`disabled: true`） | 停用的 loader 行不 spawn、不注入工具，但定义还在，随时可按工作区启用 |
| 技能 | `$DSH_HOME/inventory/skills/<name>/SKILL.md`（**仓库**） | 仓库不是任何技能根（不在 `~/.dsh/skills`、`~/.agents/skills`、项目根里），DSH 扫不到 |

## 启用（工作区详情页的开关做什么）

工作区详情页有两个分区：**MCP 服务器** 和 **技能**。每条一行。工作区列表把 DSH 的**默认工作区**排在最前并标「默认工作区」——它读自 `$DSH_HOME/storages/workspace.json` 的 `global.defaultWorkspaceId`（`workspaceRegistry` 没列出它时也会从 storage 补一行），所以默认工作区和别的仓库一样可以开关 MCP / 技能。

**判定规则只有一条：一个能力只有一处开关能改变结果。**

| 全局状态 | 工作区行 | 谁说了算 |
|---|---|---|
| 全局**开** | 锁定 + 原因（「全局已挂载」/「全局可用」/「全局已禁用」），不给开关 | 总览页的全局开关 |
| 全局**关** | 开关就是唯一决定权 | 工作区详情页 |

所以工作区页不会出现「开着的开关点了没反应」或「两个开关抢一个结果」。具体到每种行：

| 行 | 开 | 关 |
|---|---|---|
| MCP（全局未挂载） | 写进本工作区 `.dsh/mcp.json` → 只在这个工作区挂载，名字带 `-ws` | 删掉这条声明 |
| MCP（全局挂载中） | 锁定，带「全局已挂载」徽章——整台机器都能用；想按工作区管，先在总览把它停用 | — |
| MCP（全局挂载 + 本工作区也声明） | 锁定，再加「重复挂载」徽章——两个实例同时存在（`mcp__<name>__*` 与 `mcp__<name>-ws__*`），工具翻倍；去掉本工作区声明需要先在总览停用全局 | — |
| 技能（仓库内，未启用） | 建目录链接 `<projectRoot>/.dsh/skills/<name>` → 仓库目录 | 删链接 |
| 技能（全局根上，已启用） | 锁定，写「全局可用」——`~/.dsh/skills`、`~/.agents/skills`、`$DSH_CUSTOM_SKILL_DIRS` 每个会话都扫，所有工作区已经能用；要关去总览 | — |
| 技能（全局根上，已屏蔽） | 锁定，写「全局已禁用」——链接过去还是同一份带 `disable-model-invocation: true` 的 SKILL.md，开关会说谎；要在总览里开启 | — |
| 技能（已启用，非本页链接） | 锁定，带「非本页链接」徽章——手工拷进来的目录不归本页删 | — |

锁定行不会混在可切换行里：详情页的技能分区先列**本工作区能决定**的行，再把全局已可用的技能折叠进「**全局已可用 N 项**」（默认收起，展开是锁定行，只陈述状态）。MCP 分区同理按「已开启在上」排序，全局行带「全局」计数。

**只有仓库（vault）技能才真正按工作区启用。** 全局根上的技能对每个工作区都可见，所以工作区页对它们只陈述状态、不给开关；宿主也照着这条规则拒写——`POST /inventory/workspace` 对全局根上的技能返回 400，不建重复链接（重复链接会让 rank 100 的项目副本覆盖 rank 400 的全局副本，面板里还会多一条技能重名）。MCP 没有这条硬拒绝：gate 会给工作区副本加 `-ws` 后缀，所以同名声明不会撞名，但会**重复挂载**——这正是「重复挂载」徽章要提醒的。

由插件在运行时注册的技能（`ctx.skills.list()` 里没有磁盘目录的那些）**不列、不计数**：没有目录可链接，也没有 SKILL.md 可看，面板回答的是「这台机器上装了什么」。

工作区列表卡片直接写「技能 已开启 X/N」：X/N 和详情页分区头是同一个集合（已装技能 ∪ 该工作区自己的项目根，去掉运行时注册的、去掉当前隐藏的），一眼就能看出这个工作区开了多少、一共多少，不用自己拼两个数。详情页分区头写「N 项」，hint 是「已开启 X/N」；有技能被隐藏时 hint 追加「已隐藏 K」，N 跟着可见行数走。一次只允许一个写请求在飞，其余开关全部禁用；失败信息显示在面板顶部的错误条里，可关闭。

写入落点：

| 能力 | 写到哪里 | 谁读 |
|---|---|---|
| MCP | `<workspace>/.dsh/mcp.json` 的 `servers[name]` | `dsh-inventory/gate`，在 agent 创建时读一次（下一个会话生效） |
| 技能 | `<projectRoot>/.dsh/skills/<name>` → 指向**仓库目录**的目录链接（Windows 用 junction，不需要管理员） | `@deepseek-ai/dsh-skill-filesystem`（项目根 = 最近的 `.git` 祖先，没有 `.git` 就是工作区目录本身） |

两条设计取舍：

1. **技能是链接不是拷贝**：仓库里只有一份，链接跟着它走；关掉只删链接。若目标是一个真实目录（比如 skills-manager 拷进去的），host 会拒绝并说明原因，开关也直接锁定，不会删别人的内容。
2. **MCP 声明原样拷贝**：从全局行（含停用的「仅注册」行）的运行配置（含 `env`/`headers`）或另一个工作区的 `.dsh/mcp.json` 复制一份写入；`env` 不进快照，只在写盘时用。

## 概览页的开关（全局层）

概览页的 **MCP 服务器** 与 **技能** 两个分区，每行右侧是全局层操作。两个分区都按「已启用在上、已关闭在下」排序（再按名字），所以关掉的不会混在中间。

| 行 | 操作 | 含义 / 落点 |
|---|---|---|
| MCP（全局注册行） | 开关「全局挂载」 | 开 = 每个工作区都挂载；关 = **仅注册**（带「仅注册」徽章），之后到工作区页按工作区启用。落点：profile `cordis.patch.yml` 的 `- id: mcp-xxx` + `disabled: true` |
| 技能（`~/.dsh/skills`、`~/.agents/skills`、`$DSH_CUSTOM_SKILL_DIRS`） | 开关 + 「收进仓库」 | 开关 = `SKILL.md` frontmatter 的 `disable-model-invocation`；「收进仓库」= 把目录移进 `$DSH_HOME/inventory/skills`，从此不全局生效 |
| 技能（仓库内） | 徽章「仓库」+「移回全局根」 | 不渲染全局开关（它本来就不生效）；「移回全局根」把它移回 `~/.dsh/skills` |
| 技能（随包） | — | 只读，不能移动，只能靠开关屏蔽 |
| 技能（运行时注册） | — | 锁定，徽章写「运行时注册，无磁盘文件」 |
| 技能（项目级 `.dsh/skills` / `.agents/skills`） | — | 锁定，徽章写「项目级技能」——按工作区管，用工作区详情页 |

技能分区头部还有「**全部收进仓库**」：把全局根上的技能一次性移进仓库（随包技能跳过并列出原因）。

MCP 的全局开关走宿主自己的 `pluginManager.setPluginEnabled(entryId, enabled)`：它写 profile patch 并**热重载**那一行，返回 `live: true`。安装里没有 `pluginManager` 时退化为直接写 patch（`lib/global-patch.js`），只追加/改写「只有 `id` + `disabled` 的尾部覆盖块」，带 `config` 或注释的块一律不碰，此时返回 `live: false`，下次启动 DSH 生效。技能开关改它自己的 frontmatter，因此 `lib/skill-toggle.js` 只动那一行：BOM、CRLF、其它键、正文一字不改，且幂等（已经是目标状态时 `changed: false`）。

## 写入边界

- 四个端点：`GET /inventory/snapshot`、`POST /inventory/workspace`、`POST /inventory/global`、`POST /inventory/vault`
- 工作区分配只写**已登记工作区**的 `<workspace>/.dsh/` 里；请求里的路径不在 `workspaceRegistry.list()` 中直接 404，不会拿任意路径写盘
- 全局开关只写两处：profile 的 `cordis.patch.yml`（MCP 行），或**全局技能根上某个技能的 `SKILL.md` frontmatter 里那一行**（技能）
- 仓库操作只动 `$DSH_HOME/inventory/skills` 与 `$DSH_HOME/skills`：移动是 rename（同一份内容），移动后会把登记工作区里指向旧路径的技能链接改指新路径；真实目录一律不动
- 不写 state 文件，不改其它配置，不注册模型可见的工具 / prompt 段落
- 每次写入后立刻作废快照缓存，下一次 `GET` 读到的就是新状态

## 快照接口

```
GET  /inventory/snapshot[?refresh=1]
POST /inventory/workspace
POST /inventory/global
POST /inventory/vault
```

`POST /inventory/workspace` 请求体：

```json
{ "workspace": "<workspace.path>", "kind": "mcp" | "skill", "action": "add" | "remove", "name": "<serverName | skillName>" }
```

成功 `200 { ok: true, workspace, kind, action, name, path }`（`path` 是实际写入的声明文件或链接）；失败 `400/404/500 { ok: false, error }`，`error` 是可直接展示给用户的中文说明。方法不对 `405`。请求体上限 64 KB。

`POST /inventory/global` 请求体：

```json
{ "kind": "mcp" | "skill", "name": "<serverName | skillName>", "enabled": true }
```

成功 `200 { ok: true, kind, name, enabled, changed, live, via?, path? }`：`live: false` 表示写进了 patch 但需要重启才生效（只在没有 `pluginManager` 的兜底路径出现），`via` 为 `pluginManager | patch`，技能回 `path`。失败 `400/404/500 { ok: false, error }`（未知目标 404、不可开关 400、写盘异常 500），方法不对 `405`。

`POST /inventory/vault` 请求体：

```json
{ "action": "in" | "out" | "in-all", "name": "<skillName，action 为 in/out 时必填>" }
```

成功 `200 { ok: true, moved: string[], skipped: [{ name, reason }] }`（`in-all` 会跳过随包技能并给出 `reason: 'bundled'`）；`404` 找不到技能、`400` action/name 非法或目标重名、`500` 移动失败、`405` 方法不对。

返回 `packages / rows / mcp / skills / tools / edges / warnings / counts`，以及工作区视图的 `workspaces / globalMcp / gateServerNameSuffix / workspaceRegistryAvailable`、全局开关能力位 `globalToggle: { mcp, skill, via }` 和技能仓库 `vault: { dir, count }`。`globalMcp` **只含已启用的行**（停用行是「仅注册」，不算全局挂载）。MCP 的 `env` 与 `headers` 一律不返回，`args` 里的密钥值会被替换为 `<redacted>`。

`mcp[]` 每项：`{ entryId, server, transport, command?, url?, enabled, fiberPhase, status, toolCount, toolNames, toggleable, disabledReason }`；`status` 为 `connected | failed | no-tools | disabled`（`disabled` 是被关掉的行，不算故障、不产出 warning）。`skills[]` 每项：`{ name, description, source, rank, path, modelInvocable, userInvocable, disabled, bodyBytes, deps, edges, global, vaulted, toggleable, disabledReason }`——`global` 表示它来自机器级技能根，`vaulted` 表示它已收进仓库（`source: 'vault'`，只在启用的工作区里加载），`toggleable` 表示这一行现在真的能点，`disabledReason` 为 `runtime | project-scope | unreadable | no-writable-profile | vaulted`（能点时为 `null`）。

`workspaces[]` 每项：`{ id, title, path, available, mcp: { status, file, servers[], error? }, skills: [{ source, dir, rank, exists, skills[], diagnostics[] }], counts }`。`skills[].skills[].linked` 是 host 的 `lstat` 结论：`true` 表示这是本页建的链接（可以移除），手工拷贝进来的真实目录为 `false`（详情页把开关锁死，不给删）。`mcp.status` 为 `ok | missing | invalid`；`servers[].mountedAs` 是门控加过后缀的实际挂载名（读自 `inventory-gate` 行的 `serverNameSuffix`）。

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
    - id: inventory-gate
      name: "dsh-inventory/gate"
```

重启 DSH 后，左侧栏会出现「工具管理」入口；点进去是整页面板，左上角「‹ 返回对话」回到聊天。

`inventory-gate` 是可选的：只插 `inventory` 就只有清单页，没有按工作区门控；需要门控就一起插上，再给各工作区放 `.dsh/mcp.json`（格式见上文「模型怎么知道这个能力」）。

## 开发

```bash
node --test test/*.test.mjs     # 单元测试（离线，不依赖 DSH）
node scripts/preview.mjs        # 用 profile 配置 + 真实 skill 目录跑一遍静态汇总
node scripts/smoke.mjs --snapshot=<snapshot.json>   # 用抓到的真实快照跑 host 集成冒烟
```

`npm test` 覆盖（253 个用例 / 22 个文件）：多帧 zstd 会话解码、frontmatter（含 CRLF / BOM / symlink）、技能扫描与去重、四层边匹配、会话实证窗口、快照组装、包安装判定、工具归属推断、tool-search 折叠判定、客户端侧栏入口 + 主面板注册与三态渲染、**总览三块**（插件包 / MCP / 技能，统计卡与分区同名同数）、**分配写入面**（`lib/assign.js` 的 MCP 声明与技能链接，断言写完之后门控 `planMount` 与技能扫描真的能看见；路由的 405/400/404、缓存作废、未登记工作区拒绝、**全局根技能拒写**）、**全局开关**（frontmatter 与 patch 写入、pluginManager 路径、兜底往返）、**技能仓库**（`lib/vault.js` 的移进/移出/重名/单文件；路由的 in/out/in-all、bundled 跳过、移动后快照翻转、仓库技能可分配）、客户端仓库 UI（无开关的仓库行、收进/移回/全部收进三个按钮的 POST body、仅注册徽标），以及**工作区详情行语义**（全局已挂载的 MCP 锁定并标「重复挂载」、全局技能锁定「全局可用 / 全局已禁用」并折进「全局已可用」、只有仓库技能给开关、头部「已开启 N/M · 全局 K」）。

`scripts/smoke.mjs` 会起一个 stub Cordis 上下文（含一个临时工作区），跑真实的 `apply()` 和三个 HTTP handler，验证 17 项：HTTP 200、幽灵包识别、deferred 计算、`bsk_*` 归属、`tool_search` 归属、**已启用的 MCP 全部连通**、技能扫描、屏蔽桩、会话实证、冷构建 <3s、agent 平面工具收录、global 平面 mcp 工具收录、平面计数上报、payload 无密钥，以及**分配往返**（给临时工作区分配一个 MCP → 刷新快照能看到 → 移除 → 快照恢复）。本机实测冷构建 **~600 ms**，15s 缓存命中 **3–4 ms**，payload 约 80 KB。

## 实测数据（本机 2026-10-25 审计，live 快照）

| 项 | 值 |
|---|---|
| 插件包 | 18：13 已加载、5 个「无自身加载行」（bundle 由 include 组成，loader 不暴露同名行）、0 未安装 |
| Loader 行 | 222 行 / 212 个不同模块名（其中 25 行 disabled） |
| MCP | 4 台全连通，41 个工具（codegraph 1 / davinci-resolve 37 / officecli 1 / context7 2），`mcp__` 前缀零遗漏 |
| 技能 | 磁盘 28（user-dsh 27 + user-agents 1）+ 插件运行时 7；面板只列磁盘那 28 条（运行时注册不列、不计数），磁盘侧零漏扫，7 个屏蔽桩 |
| 工具 | 113 = 全局平面 77 + agent 平面 36（4 个活跃 agent 的并集）；归属：内置 55 / MCP 41 / 插件 17 / 未识别 0；被 tool-search 折叠 98 |
| 关系边 | 131，其中 22 条带会话实证；96 个工具没有被任何技能指名 |

> 加载行与工具的总数仍写在快照里（`counts.rows` / `counts.tools` / `edges`），但不再占总览页的分区——工具数只在技能行的 `N 工具`、`N 条引用` 徽章和展开行里出现。

> 「未安装」判定看两件事：`package.json` 在**且**它声明的入口文件（`main` / `exports["."]`）也在。只有目录没有入口的包会被标 `orphan` 并在 `broken` 里写明缺什么——这正是首版把「包存在但没激活」误报成「幽灵包」后补的判据。

> 「已加载」不能只看同名行：bundle 的行是它 include 的模块（`dsh-doublecheck/grill`、`@deepseek-ai/dsh-llm` …），包本身没有同名行。判据按「同名行 → 以 `包名/` 开头的子行」逐级回退，`active` 优先；两者都没有的包标 `rowless`，UI 显示「无自身加载行」，不冒充「未加载」。

> 工具必须同时读两个平面：`ctx.tools.schemas()` 不带 scope 只返回**全局层**，而 `read/write/edit/pwsh/skill/todo_write` 这些核心工具由 agent preset 注册在**每会话平面**。只读全局会静默丢掉它们（这正是首版漏掉的东西）。插件通过 `ctx.get('agents').list()` 枚举活跃 agent，再按 agent 取 `schemas(agent)`，与全局层取并集，并在快照里回报 `toolPlanes`。

### 准确性边界（哪些是事实、哪些是推断）

| 面 | 证据等级 | 边界 |
|---|---|---|
| 插件包 / MCP 列表 | 事实（loader 与磁盘） | 完整；「已加载」见上条回退规则。加载行本身不再上总览页，只作为「已加载」的判据 |
| MCP 工具清单 | 事实（工具注册表前缀） | 与实际数量逐台核对一致 |
| 技能 | 事实（磁盘扫描） | 只扫固定根目录，且 `cwd` 取 host 进程目录；**别的会话工作区里的项目级 `.dsh/skills` 不会出现**。运行时注册的技能只在快照里，面板不列 |
| 工具清单 | 事实（注册表并集） | 只覆盖快照时刻已注册的；插件注册的临时工具看不到 |
| 工具归属 | 推断 | `mcp__*` 确定；内置查静态名单；插件靠扫包内 JS 字面量——找不到就标「未识别」，不瞎猜 |
| 技能 → 工具 | 推断 | 文本匹配 + 会话窗口证据；命中次数只代表最近 12 个会话、窗口 8 次调用 |


## 生效方式

- **host 侧代码**：DSH 启动时加载，改完要重启 DSH（当前 profile 没开源码 HMR，`touch cordis.patch.yml` 不会重载插件代码；实测改了 `index.js` 后旧进程里 `/inventory/global` 仍是 405）。
- **client 侧代码**：浏览器里刷新页面即可；如果面板没变，说明这个 profile 缓存了客户端 bundle，重启 DSH 再刷新。
- **全局开关本身**：MCP 走 `pluginManager` 时立刻生效（它自己热重载那一行）；没有 `pluginManager` 时写进 patch，重启后生效。技能开关改的是磁盘 frontmatter，`dsh-skill-filesystem` 的 watcher 会自己失效缓存，所以当前进程内也立刻生效。
- **仓库移动**：rename 立即生效——移进仓库的技能立刻从全局根消失（不再进任何会话的技能目录），移出同理；移动后登记工作区里指向旧路径的链接会被改指新路径。**按工作区启用/停用**要等下一个会话（gate 与技能发现都在 agent 创建时读一次）。
- 加载失败最多让这一行 fiber 变 `failed`，不会阻止 DSH 启动；去掉 `cordis.patch.yml` 里的 `- insert: inventory` 即可回滚（回滚不会撤销已经分配出去的 `.dsh/mcp.json`、技能链接、仓库移动，或全局开关写下的 `disabled: true` / `disable-model-invocation: true`，需要的话手动改回）。

## 跨机同步(三种直连方式)

同步=把本机插件/MCP/技能清单发布成一个 JSON 文件(`dsh-manifest.json`),另一台机器拉回来对比、挑选安装。清单文件放哪里,由「同步方式」决定:

| 方式 | 适用 | 地址格式 | 鉴权 |
| --- | --- | --- | --- |
| `github` | 海外机器 / 默认 | `owner/repo` 或 GitHub URL | GitHub token(Bearer) |
| `gitee` | 国内机器,国内直连 | `owner/repo` 或 Gitee URL | Gitee token(`access_token` 查询参数) |
| `http` | 自建直连,不走任何 Git 托管 | 完整 `http(s)://…/dsh-manifest.json` 直链 | `Authorization: Bearer <token>` |

- `github` / `gitee` 共用同一套读取顺序:raw → contents API → `git clone` 兜底;发布走各家的 contents API(GitHub 用 sha 更新,Gitee v5 用 `branch` 字段)。
- `http` 模式:GET 读、PUT 发布,请求头带 `Authorization: Bearer <token>`;404 视为「远端还没有清单」,第一次发布即创建。服务器上现成的端点:`http://103.236.71.248:10100/dsh-sync/dsh-manifest.json`(nginx dav 写入 `/var/www/dsh-sync/`,token 在服务器 `/root/.dsh-sync-endpoint-token`)。国内机器连 GitHub 不稳时,推荐用这一条,或把清单镜像到 Gitee 仓库。
- 面板「同步方式」下拉切换;`mode` 与 `repoUrl` 持久化在 `~/.dsh/plugin-sync.json`。
- 清单顶层可选 `repoUrl`(插件仓库地址,在面板「插件仓库地址」里填):新机器上 `repo` 来源的插件需要仓库副本(`~/.dsh/plugin-repo` 或 `$DSH_PLUGIN_REPO`),没有副本时会用这个地址自动 `git clone --depth 1` 一次;克隆失败给出可操作的错误,不会静默重试。
- 发布前照例过脱敏(secret / 绝对路径),清单本身可以公开存放。

### 多台机器同时发布(舰队清单 v2)

从 0.3.0 起,清单文件升级为「舰队文档」:每台机器把自己的清单写进**以 machineId 命名的分节**,不再整文件覆盖。

```json
{
  "fleetVersion": 2,
  "generatedAt": 1730000000000,
  "machines": {
    "host-a-1a2b": { "manifestVersion": 1, "generatedAt": 1730000001000, "plugins": [/* host-a 的清单 */], "mcp": [], "skills": [] },
    "host-b-3c4d": { "manifestVersion": 1, "generatedAt": 1730000002000, "plugins": [/* host-b 的清单 */], "mcp": [], "skills": [] }
  }
}
```

**两台机器同时发布会怎样?** 发布循环是「读 → 合并 → 条件写」,谁也不会吃掉谁:

1. **读**:拉取当前远端文档,解析出所有机器分节;
2. **合并**:只替换**自己 machineId** 那一节,其他机器的分节原样保留;
3. **条件写**:
   - `github`/`gitee`:contents API 带 sha 更新,别人先写过则 sha 过期 → 409/422 → 重读重合重试(最多 3 次);
   - `http`:PUT 带 `If-Match: <etag>`;若端点忽略 If-Match(nginx dav 就忽略),PUT 成功后再 GET 校验自己的分节是否真的落地,没落地就重读重合重试;
4. **拉取方看到的视图**:各分节按条目合并——同一条目(`kind:name`)以 `generatedAt` 最新的机器为准,所以每台机器发布自己的真实状态,安装对比时两边清单都可见。

补充规则:

- `machineId` = `主机名-4位hex`,首次使用时铸造并持久化在 `~/.dsh/plugin-sync.json`,可用环境变量 `DSH_MACHINE_ID` 覆盖;
- 旧版(0.2.x)单机清单文档仍可读取,解析为一个 `default` 分节;首次发布新格式时该分节被本机接管,不会留下幽灵条目;
- 舰队最多 **32** 台机器,满了会明确报错而不是挤掉别人;
- 面板状态卡显示「舰队清单:N 台机器 · 本机 <machineId>」;发布按钮文案为「发布本机清单(合并入舰队)」。

## 已知限制

- 工具归属是推断：`mcp__<server>__*` 确定；`BUILTIN_TOOLS` 只收 DSH 本体注册的工具（把它写成插件工具会导致归属错判，且扫描会跳过内置名）；其余通过扫描插件包 JS 里的工具名字面量判定，找不到就标「未识别」。
- 全局视图的技能只扫固定根目录（项目 `.dsh/skills`、项目 `.agents/skills`、`$DSH_CUSTOM_SKILL_DIRS`、`~/.dsh/skills`、`~/.agents/skills`、`$DSH_BUNDLED_SKILL_DIR`），其中「项目」取 host 进程的 `cwd`；工作区视图改为按每个工作区自己的项目根扫，共享根只扫一次。
- 会话实证只读最近 12 个会话文件，窗口 8 次工具调用。
- 快照缓存 15 秒；`?refresh=1` 强制重算。
- 被屏蔽的 skill（`disable-model-invocation: true`）在运行时注册表里看不见，只能靠磁盘扫描，因此显示为「已屏蔽」。
- **分配**只对已登记工作区生效；只能分配**磁盘上有目录**的技能（插件运行时注册的技能没有目录，链接不了）。
- 技能目标根按 DSH 的规则取「最近的 `.git` 祖先」：几个工作区共享同一个 git 根时，给其中一个分配技能，整棵仓库都会看到它（DSH 本身就这么发现技能，不是本插件的选择）。
- Windows 上目录用 junction（不需要管理员）；单文件技能 `<name>.md` 只能建文件符号链接，普通权限下可能失败并报错。
- 全局注册的 MCP 行**启用**时仍然对所有工作区可用（DSH 的 loader 行没有按工作区过滤的能力）：那时详情页把开关锁成「开」，想按工作区管就先在总览把它停用（变成「仅注册」）。
- 全局开关只覆盖「全局注册」的 MCP 行与「机器级技能根」的技能；项目级技能、仓库技能与运行时注册的技能不做隐式写入（仓库技能用「移回全局根」或工作区开关）。
- 仓库移动是同一磁盘上的 rename：`$DSH_HOME` 与仓库在同一棵树里，不会跨盘；随包技能只读，`in-all` 会跳过它并写进 `skipped`。
- 收进仓库会**改掉技能的磁盘路径**（`~/.dsh/skills/<name>` → `$DSH_HOME/inventory/skills/<name>`）。如果有别的地方按绝对路径引用它（例如 `~/.dsh/AGENTS.md` 里写死的 `~/.dsh/skills/office/SKILL.md`），那些引用要跟着改，或者这类被引用的技能别收进仓库、继续留在全局根。
- 移动后修链接只修「指向旧路径的符号链接/junction」；真实目录与指向别处的链接不动（那可能是别人的内容）。
- 技能开关是改 `SKILL.md` 的 frontmatter，所以对「屏蔽桩」（正文本身就是 DISABLED 说明的 office-* 那类）打开只是去掉 `disable-model-invocation: true`，不会把真实内容变回来。
- MCP 开关依赖 `pluginManager`（DSH 自带，profile 里有 `@deepseek-ai/dsh-plugin-manager` 行时存在）。它拒绝的行（`readOnlyReason` 非空、`unaddressable`）会原样报错，不会绕过它自己写 patch。
- 技能链接指向工作区之外（`~/.dsh/inventory/skills` 等）；文件沙箱只允许读工作区外路径的策略下，链接目标可能读不到，此时技能不会生效。

## 面板布局约定（改 UI 前先读）

根节点是**唯一滚动容器**（`height: 100%` + `overflowY: auto`）。由此有三条硬约定：

1. 根节点的**每个直接子节点**都必须 `flexShrink: 0`（header / toolbar / chips / warn / errorBox / section）。列向 flex 默认把子元素压扁：分区一被压缩，`overflow: hidden` 会把展开的行裁掉，而且根节点 `scrollHeight` 永远等于 `clientHeight`——滚动条不出现，展开多了就再也看不到下面的内容。
2. 行内统一 `alignItems: center`，不要用 `baseline`。徽章盒（16px 行高 + 边框 = 18px）比文字行高，基线对齐会让徽章看起来比同一行的文字高一截。
3. 空字段不要渲染占位元素。`h('span', null, '')` 宽高都是 0，但仍然吃掉一个 `gap`，行与行之间的间距就歪了。

回归测试在 `test/client.test.mjs`（`panel rows stay whole and aligned once a lot is expanded`）：断言根节点子元素不收缩、全树无 `baseline`、无版本号的包行不产出空 span。

