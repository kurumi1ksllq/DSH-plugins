# dsh-websearch-failover

把 DeepSeek Harness 原生 `web_search` 变成**有序多提供方失败转移**：按你排的优先级从上往下依次尝试 Tavily / Exa / Firecrawl / Serper / Brave / Bocha / Jina / Parallel / SearXNG / 任意自定义 HTTP 搜索 API，一家额度耗尽、鉴权失效或报错就自动换下一家，并带配额感知冷却。

同时提供一个**左侧边栏的提供方管理器**：按优先级列出所有提供方，显示各自的余额（额度 / 美元 / 百分比 / 次数 / tokens 混排也按比例画条）、冷却倒计时、本地调用统计，可拖动或按钮调整顺序（最上方最先被调用），可单独启用/停用、刷新余额。

- Bundle 名：`dsh-websearch-failover`；行 id：`websearch-failover`
- Host 半区：`plugin/index.js`（注册 `ctx.web` 提供方 + 侧栏 API）
- Client 半区：`plugin/client.js`（`window.__ModuleLoader__` 浏览器 bundle）
- 无第三方依赖，Node ≥ 22.19（`engines` 声明 `^22.19.0 || >=24.0.0`）

---

## 1. 为什么必须是插件

DSH 自带的 `ctx.web` 只解析**一个**搜索提供方（`@deepseek-ai/dsh-web` 的 `WebRuntime.search()`，源码注释原文：`$DSH_WEB_SEARCH_PROVIDER` “is NOT a hidden priority chain”）：

| 情形 | 原生行为 |
| --- | --- |
| 配了 id，已注册且 `available()` | 用它，不重试 |
| 没配 id，恰好一家可用 | 用它 |
| 没配 id，多家可用 | 抛 `WEB_PROVIDER_AMBIGUOUS`（“configure one explicitly”） |
| 提供方抛错 | 直接冒泡，没有降级、没有额度概念 |

所以本插件做的是：自己注册**一个** id 为 `websearch-failover` 的 provider（原生因此永远只有一个候选，不会 ambiguous），在这个 provider 内部走自己的有序队列 + 冷却状态机。于是原生 `web_search`、所有子智能体、所有队友的搜索都自动获得失败转移能力，无需改提示词。

## 2. 安装

```bash
node scripts/build-plugin.mjs            # 生成 plugin/lib/*.mjs（从 lib/ 复制，幂等）
node scripts/install.mjs --dry-run       # 只看计划（含将要写入的 diff），不写任何东西
node scripts/install.mjs                 # 装进 profile
node scripts/install.mjs --uninstall     # 完全回滚
```

安装器只做四件事：

1. 跑 `scripts/build-plugin.mjs`（失败即中止，profile 一个字节都不动）；
2. 把 `plugin/` 整棵树复制到 `<profile>/node_modules/dsh-websearch-failover/`（先递归删旧副本；`plugin/lib/` 一并复制，所以装完是自包含的，不会反向依赖本仓库）；
3. 在 `<profile>/package.json` 的 `dsh.profile.bundles` 里追加 `"dsh-websearch-failover"`（**不加 dependencies**，DSH 的 loader 直接从 profile 的 `node_modules` 解析 bundle）；
4. 在 `<profile>/cordis.patch.yml` 末尾追加一个带标记的块（`# >>> websearch-failover` … `# <<< websearch-failover`）：

```yaml
- id: web
  config:
    searchProvider: websearch-failover
    fetchProvider: http
- insert:
    - id: websearch-failover
      name: 'dsh-websearch-failover'
```

`fetchProvider: http` 是必须一起写的：profile patch 会**整块替换**目标行的 `config`，只写 `searchProvider` 会把原生 http 抓取器一起冲掉。

每次真正修改前，安装器都会在文件旁边写 `*.bak-websearch-failover-<时间戳>` 备份；内容没变化就不写文件、不产生备份。`--uninstall` 是按文本精确摘除的，所以能把这**两个文件还原到安装前的字节**（`test/test-install.mjs` 会逐字节比对）。唯一例外：如果中途用 DSH 自带的插件管理器增删过别的 bundle，它会整份重写 `package.json`（2 空格 JSON），此时卸载结果语义等价、但不再与最早的备份逐字节相同 —— 那种情况下用 `package.json.bak-websearch-failover-*` 里的原始快照对照即可。

参数：

| 参数 | 作用 |
| --- | --- |
| `--profile <dir>` | 目标 profile，优先级最高 |
| `--source <dir>` | 从另一个 checkout 安装（默认本仓库） |
| `--dry-run` | 打印每一步计划（package/manifest/patch 的 diff 预览），不建目录、不写文件、不跑 build |
| `--uninstall` | 删除包目录 + bundles 条目 + 标记块 |
| `--no-build` | 信任已有的 `plugin/lib/`，跳过构建 |

Profile 解析顺序：`--profile` > `$DSH_PROFILE_DIR` > `$DSH_HOME/profiles/desktop` > `~/.dsh/profiles/desktop`；找不到带 `package.json` 的 profile 会直接报错并列出检查过的路径。

**生效方式**：这个 profile 开着 HMR —— **host 半区**（provider 注册、HTTP API、运行时状态）会热生效，不需要重启 DSH；只有**浏览器半区**（侧边栏入口 + 面板）需要刷新一次页面。装完的提示行会再次提醒。

## 3. 配置：`providers.json`

默认位置（按顺序找第一个存在的）：`$WEBSEARCH_FAILOVER_CONFIG` → `$DSH_HOME/websearch-failover/providers.json` → `~/.dsh/websearch-failover/providers.json`。
文件改完**下一次搜索就生效**（host 按 mtime+size 重新加载，不用重启）。

```json
{
  "defaults": {
    "limit": 8,
    "timeoutMs": 15000,
    "cooldown": { "quota": 1800, "auth": 86400, "error": 60 }
  },
  "providers": [
    { "id": "tavily", "kind": "tavily", "apiKeyEnv": "TAVILY_API_KEY" },
    { "id": "exa", "kind": "exa", "apiKeyEnv": "EXA_API_KEY", "timeoutMs": 15000 },
    { "id": "firecrawl", "kind": "firecrawl", "apiKeyEnv": "FIRECRAWL_API_KEY" },
    { "id": "custom-any", "kind": "custom", "apiKeyEnv": "MY_SEARCH_KEY", "enabled": false,
      "request": { "method": "POST", "url": "https://api.example.com/v1/search",
        "headers": { "authorization": "Bearer ${key}" },
        "body": { "q": "${query}", "size": "${limit}" } },
      "response": { "sourcesPath": "data.items",
        "map": { "title": "name", "url": "link", "snippet": "summary" } } }
  ]
}
```

数组顺序就是优先级（也可在侧栏里用 `runtime.json` 覆盖）。完整示例见 `providers.example.json`。

- **适配器** `kind`：`tavily` `serper` `brave` `bocha` `exa` `jina` `searxng` `parallel` `firecrawl` `custom`。
- `custom`：`request`（method/url/headers/body，占位符 `${key}` `${query}` `${limit}`）+ `response`（`sourcesPath` 点号路径，`map` 里的 title/url/snippet/publishedAt）。
- **key 解析**：`apiKey` 字面值 → `apiKeyEnv`（可加 `apiKeyEnvFallbacks`）→ `keyFile` 首行；`keyOptional: true` 允许无 key（如本地 SearXNG）。
- `enabled: false` 的行不参与搜索，但仍显示在侧栏。
- 其它可用字段：`label`（面板显示名）、`endpoint`、每行自己的 `timeoutMs`。
- **余额**：内置 `firecrawl`、`tavily` 的余额接口（2026-10-24 对真实 API 验证过）：
  - firecrawl `GET https://api.firecrawl.dev/v2/team/credit-usage` → `data.remainingCredits` / `data.planCredits`（v1 的 snake_case 字段也接受）；
  - tavily `GET https://api.tavily.com/usage` → `account.plan_limit - account.plan_usage`。

  其它家若想显示余额，在行里加 `"balance": { "request": {...}, "response": { "remainingPath"|"totalPath"|"usedPath" }, "unit": "credits|usd|percent|requests|tokens" }`；路径可以是单个点号路径，也可以是**候选路径数组**（取第一个能取到值的，用来兼容 v1/v2 或改名后的响应）。没有余额接口就显示中性提示（`status: unknown`），不影响搜索。

## 4. 运行时状态文件

| 文件 | 默认位置 | 写者 | 内容 |
| --- | --- | --- | --- |
| `providers.json` | `$DSH_HOME/websearch-failover/providers.json` | 你手写 | 提供方清单、key 来源、默认参数 |
| `runtime.json` | `$DSH_HOME/websearch-failover/runtime.json` | 插件（侧栏操作、搜索统计、余额刷新） | `version`、`order`（优先级 id 数组）、`disabled`（id → true）、`balances`（每次探测结果）、`stats`（calls / successes / failures / lastUsedAt / lastOutcome / lastError）、`updatedAt` |
| `websearch-failover-state.json` | `$DSH_HOME/websearch-failover-state.json` | 引擎 | 每家的冷却记录：`until`、`reason`（quota/auth/error）、`code`、`message`、`at` |
| `plugin.log` | `$DSH_HOME/websearch-failover/plugin.log` | 插件 | 注册、每次搜索的命中家与 attempts、顺序/启停变更、余额刷新结果 |

前三个文件可被环境变量覆盖：`$WEBSEARCH_FAILOVER_CONFIG`、`$WEBSEARCH_FAILOVER_RUNTIME`、`$WEBSEARCH_FAILOVER_STATE`。文件缺失或 JSON 损坏时一律当作“没有覆盖/没有冷却”，不会让搜索失败。写入是「临时文件 + rename」的原子替换。

`runtime.json` 里的 `order` 只给**已列出**的 id 排序，没列到的保持配置文件里的相对顺序；`disabled` 里的 id 直接从候选队列移除。

## 5. 侧边栏面板

左侧边栏出现「Web 搜索提供方」入口（slot `sidebar.panellist`，order 30，中英跟随界面语言；文案来自 `plugin/locale/{zh,en}.json` 与 `client.js` 内置字典，namespace `websearch-failover`）。

- 左列：按优先级排的提供方列表，每行有序号徽标、名称、余额条、金额+单位、状态点（正常 / 冷却 / 未知，冷却时显示倒计时）。
- 余额条：host 给了 `ratio`（有 total 或 percent 时算得出）就按 `ratio` 画；只有绝对值时按「本面板内最大 remaining」做归一化；完全未知就画空轨道 + 中性提示，绝不出现 NaN 宽度。
- 右列：选中提供方的详情 —— 余额、单位、占比、冷却、key 是否已配置、本地调用统计（次数/成功/失败/最近调用）、启用/停用开关。
- 排序：拖动行，或用上/下移按钮；两者都乐观更新 UI，失败回滚并提示。顺序即调用优先级，面板顶部有「自上而下依次调用，最上方优先」提示。
- 「刷新余额」只在你点击时请求，避免按次计费接口被轮询烧额度；只有存在冷却项时才有 1 秒计时器刷新倒计时文案。
- 「返回对话」调用 `ctx.layout.selectPanel(null)`。

## 6. HTTP API

Host 通过 `ctx.webServer.register({ kind: 'prefix', path: '/websearch-failover/api' })` 暴露四个动作（同源普通 HTTP，不走 `/api` 鉴权层，因此每个写请求都在 host 侧校验来源）：

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/websearch-failover/api/state` | — | `{ ok, generatedAt, order: [id...], providers: [{ id, kind, label, enabled, rank, keyPresent, balance, cooldown, stats }] }` |
| POST | `/websearch-failover/api/order` | `{ "order": ["id1","id2",...] }` | 同上快照 |
| POST | `/websearch-failover/api/refresh` | `{ "ids": ["id1"] }`（省略 = 全部） | 同上快照（`balances` 已更新） |
| POST | `/websearch-failover/api/enable` | `{ "id": "tavily", "enabled": false }` | 同上快照 |

约定：JSON + `cache-control: no-store`；未知路径 404 `not-found`，方法不对 405 `method-not-allowed`，非法请求体 400（`invalid-json` / `invalid-order` / `invalid-ids` / `invalid-enable`），超过 128 KiB 413 `payload-too-large`，跨站写请求 403 `forbidden-origin`（`sec-fetch-site: cross-site`，或 `Origin` 的 host 与 `Host` 不一致时拒绝），内部异常 500 `internal-error`。

**API 永不返回 API key**，只返回 `keyPresent: true/false`；`balance` 里也没有任何凭据。

## 7. 失败分类与冷却

| 分类 | 触发 | 冷却 |
| --- | --- | --- |
| `quota` | HTTP 429 / 402，或响应含 quota / credit / insufficient / balance / rate limit / 额度 / 余额 / 配额… | `cooldown.quota`，默认 1800s，`retry_after` 优先 |
| `auth` | 401，403（无额度字样）、key 缺失 | `cooldown.auth`，默认 86400s |
| `error` | 5xx、网络错误、响应不可解析 | `cooldown.error`，默认 60s |
| `bad_request` | 400 / 422 | 不冷却（配置问题，冷却没意义） |

空结果 → 换下一家但不冷却；冷却中的家不发请求，直接 `skipped`；搜索成功会清掉该家的冷却记录；全部失败抛 `ALL_FAILED` 并附带逐家 `attempts`。侧栏 `stats` 会把每次 `ok` / `failed` / `empty` 记到 `runtime.json`。

## 8. CLI（不装插件也能用）

```bash
node search.mjs "查询词" --limit 8
node search.mjs "查询词" --json
node search.mjs "查询词" --force            # 忽略冷却（刚充值完）
node search.mjs --probe                     # 逐家体检 key（不写冷却状态）
node search.mjs --list                      # 提供方 + 冷却状态
```

`--config PATH` / `--state PATH` 可临时指向别的文件。CLI 与插件共用 `lib/core.mjs`，行为一致。

## 9. 目录结构

```
lib/core.mjs          有序失败转移引擎：HTTP 适配器、错误分类、冷却、状态持久化
lib/runtime.mjs       运行时状态：order / disabled / balances / stats（原子写）
lib/balance.mjs       余额归一化 + 按 kind 探测（内置 firecrawl、tavily）
lib/api.mjs           侧栏四条路由的 HTTP API
lib/http.mjs          共享 HTTP 小工具（同源校验、body 上限、JSON 响应、truncate）
plugin/index.js       host 半区：注册 ctx.web 提供方 + 挂 API
plugin/client.js      浏览器半区：侧栏入口 + 提供方管理器面板
plugin/locale/*.json  侧栏/面板文案字典（中英，namespace websearch-failover）
plugin/icon.svg       图标（24×24 viewBox，currentColor 描边）
plugin/package.json   bundle 声明（dsh.bundle.patch + dsh.client）
plugin/cordis.patch.yml  bundle patch：只 insert 自己那一行
plugin/lib/*.mjs      由 scripts/build-plugin.mjs 从 lib/ 生成的副本（gitignored）
scripts/build-plugin.mjs  生成/校验 plugin/lib
scripts/install.mjs       安装 / 卸载 / 计划预览
search.mjs            CLI
providers.example.json  配置示例
test/*.mjs            离线测试（见下）
tools/                DSH app.asar 只读检查小工具 + 余额接口体检脚本（开发期用，不参与运行）
providers.json / runtime.json / websearch-failover-state.json / plugin.log
                      运行时文件，全部在 $DSH_HOME 下，git 忽略
```

`plugin/lib/` 是**生成产物**：改 `lib/`，然后 `node scripts/build-plugin.mjs`；`node scripts/build-plugin.mjs --check` 在生成物过期时退出 1（适合放进 CI）。

旧原型的单 provider 文件（`plugin/install.mjs`、`plugin/core.mjs`、`test/test-plugin.mjs`）已经删除，现在的目录就是唯一布局：host 半区 `plugin/index.js` + 生成的 `plugin/lib/`，安装/卸载只走 `scripts/install.mjs`。`HANDOVER.md` 是早期原型交接记录，其中“搜索形态/CLI”仍适用，安装与面板部分以本文为准。

根 `package.json` 里的脚本（与仓库内实际定义一致）：

| 脚本 | 命令 |
| --- | --- |
| `npm test` | 依次跑 9 个测试文件（见 §10） |
| `npm run build` | `node scripts/build-plugin.mjs` |
| `npm run build:check` | `node scripts/build-plugin.mjs --check` |
| `npm run plugin:dry` | `node scripts/install.mjs --dry-run` |
| `npm run plugin:install` | `node scripts/install.mjs` |
| `npm run plugin:uninstall` | `node scripts/install.mjs --uninstall` |
| `npm run test:engine` | `node test/mock-failover.mjs` |
| `npm run test:runtime` | `node test/test-runtime.mjs` |
| `npm run test:balance` | `node test/test-balance.mjs` |
| `npm run test:api` | `node test/test-api.mjs` |
| `npm run test:plugin` | `node test/test-host-plugin.mjs` |
| `npm run test:integration` | `node test/test-integration.mjs` |
| `npm run test:client` | `node test/test-client-static.mjs` |
| `npm run test:render` | `node test/test-client-render.mjs` |
| `npm run test:install` | `node test/test-install.mjs` |
| `npm run search` / `probe` / `list` | `node search.mjs …` |
| `npm run probe:balance` | `node tools/probe-balance-endpoints.mjs` |
| `npm run asar:get` / `asar:files` | `node tools/asar-get.cjs` / `node tools/asar-files.mjs` |

## 10. 测试

全部离线，不联网、不碰真实 profile：

```bash
node test/mock-failover.mjs        # 引擎不变量（顺序降级/冷却跳过/force/全挂/空结果/缺 key）
node test/test-runtime.mjs         # runtime.json 归一化、order/disabled、统计、原子写
node test/test-balance.mjs         # 余额归一化（credits/usd/percent/requests/tokens/unknown）+ 内置探测
node test/test-api.mjs             # 四个路由、错误码、同源校验、body 上限
node test/test-host-plugin.mjs     # host 半区契约（stub ctx：注册、available、search、API 注册）
node test/test-integration.mjs     # 真 node:http 回环：起临时服务端跑 host 插件 + API 全链路
node test/test-client-static.mjs   # client.js 静态检查（语法、slot/key、路由、locale、只 require react）
node test/test-client-render.mjs   # 迷你 hook 运行时执行 client.js：渲染文案、余额条宽度、拖动/排序 POST 体、失败回滚
node test/test-install.mjs         # 安装/卸载：dry-run 零写入、diff 计划、幂等、备份、逐字节还原、缺 build 拒装
```

`npm test` 会按上面的顺序全跑一遍。`test/test-install.mjs` 在系统临时目录里造一个假 profile + 假 checkout 跑完整流程，真实 `~/.dsh/profiles/desktop` 永远不参与。

## 11. 安全说明

- **API key 只存在于 `~/.dsh/websearch-failover/providers.json`（或你用环境变量 / keyFile 指定的位置），是明文**；本仓库、`plugin/`、`runtime.json` 里都没有 key。`.gitignore` 已忽略 `providers.json`、`runtime.json`、`websearch-failover-state.json`、`plugin.log`。
- 侧栏 API 只返回 `keyPresent` 布尔值，不返回 key 本身，也不返回上游响应原文。
- 写请求做同源校验（`Origin`/`Host` 不一致或 `sec-fetch-site: cross-site` → 403），body 上限 128 KiB，响应 `no-store`。
- 插件只读写上面列出的 `$DSH_HOME` 文件，不监听其它路由、不发遥测。
- DSH 默认只绑本机回环。别把 DSH 端口暴露到不可信网络：面板能改的是你的搜索优先级与余额探测目标，等同本机 profile 管理权限。
- 余额探测会带着你的 key 请求各家的余额接口（内置只有 firecrawl / tavily，且只在你点「刷新余额」时发生）。

## 12. License

MIT，见 `LICENSE`。

---

## English (short)

**dsh-websearch-failover** is a DeepSeek Harness bundle that turns the native `web_search` into an ordered multi-provider failover chain: providers are tried top-to-bottom in the user's priority order, and quota/auth/transport failures put that provider on a quota-aware cooldown instead of failing the search. It registers a single `websearch-failover` provider on `ctx.web`, so the harness never sees an ambiguous provider set, and it serves a small HTTP API behind a left-sidebar provider manager.

- **Install:** `node scripts/build-plugin.mjs && node scripts/install.mjs` (`--dry-run` to preview, `--uninstall` to roll back byte-for-byte, `--profile <dir>` to target another profile). The installer copies the bundle into `<profile>/node_modules/dsh-websearch-failover/`, appends `"dsh-websearch-failover"` to `dsh.profile.bundles`, and adds one marked block to `<profile>/cordis.patch.yml` that pins `web.searchProvider` (plus `fetchProvider: http`, because a profile patch replaces the row's whole `config`). The profile has HMR enabled, so the host half applies live without restarting DSH; only the browser half needs one page reload.
- **Config:** `~/.dsh/websearch-failover/providers.json` (or `$WEBSEARCH_FAILOVER_CONFIG`) — providers in priority order, key via `apiKey` / `apiKeyEnv` / `keyFile`; adapters `tavily serper brave bocha exa jina searxng parallel firecrawl custom`. Hot-reloaded on the next search. Built-in balance probes (verified against the live APIs on 2026-10-24): firecrawl `GET https://api.firecrawl.dev/v2/team/credit-usage` → `data.remainingCredits` / `data.planCredits` (v1 snake_case also accepted), tavily `GET https://api.tavily.com/usage` → `account.plan_limit - account.plan_usage`.
- **State:** `~/.dsh/websearch-failover/runtime.json` (order, disabled, balances, stats), `~/.dsh/websearch-failover-state.json` (cooldowns), `~/.dsh/websearch-failover/plugin.log`.
- **API:** `/websearch-failover/api/{state,order,refresh,enable}`; POST bodies `{order:[...]}`, `{ids?:[...]}`, `{id,enabled}`. Same-origin checked, 128 KiB body cap, never returns API keys.
- **Tests:** `npm test` runs nine offline files: `test/mock-failover.mjs`, `test/test-runtime.mjs`, `test/test-balance.mjs`, `test/test-api.mjs`, `test/test-host-plugin.mjs`, `test/test-integration.mjs` (real `node:http` loopback), `test/test-client-static.mjs`, `test/test-client-render.mjs` (mini hook runtime executing `client.js`), `test/test-install.mjs` (throwaway temp profile).
- **Security:** API keys live only in `~/.dsh` as plaintext, never in this repository; `.gitignore` covers the config/state/log files.
