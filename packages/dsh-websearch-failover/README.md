# dsh-websearch-failover

把 DeepSeek Harness 原生 `web_search` 变成**有序多提供方失败转移**：按你排的优先级从上往下依次尝试 Tavily / Exa / Firecrawl / Serper / Brave / Bocha / Jina / Parallel / SearXNG / 任意自定义 HTTP 搜索 API，一家额度耗尽、鉴权失效或报错就自动换下一家，并带配额感知冷却。

同时在 **工具管理（dsh-inventory）** 页里渲染一个**提供方管理器区块**：按优先级列出所有提供方，显示各自的余额（额度 / 美元 / 百分比 / 次数 / tokens 混排也按比例画条）、冷却倒计时、本地调用统计，可拖动或按钮调整顺序（最上方最先被调用），可单独启用/停用、刷新余额。

- Bundle 名：`dsh-websearch-failover`；行 id：`websearch-failover`
- Host 半区：`index.js`（注册 `ctx.web` 提供方 + 管理 API）
- Client 半区：`client.js`（`window.__ModuleLoader__` 浏览器 bundle）
- 无第三方依赖，Node ≥ 22（`engines` 声明 `>=22`）

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

本包是 [DSH-plugins](../../README.md) 仓库的 bundle 之一(完整清单见根 README)。0.4.0 起包根就是 bundle 本体（不再有 `plugin/` 子目录，也没有需要构建的副本）；按根 README 的「装上」接线：

1. profile 的 `dependencies` 写 `"dsh-websearch-failover": "link:<仓库绝对路径>/packages/dsh-websearch-failover"`；
2. 同一份 `package.json` 的 `dsh.profile.bundles` 加 `"dsh-websearch-failover"`——只加依赖不会加载；
3. 在 `<profile>/cordis.patch.yml` 追加（`fetchProvider: http` 必须一起写，profile patch 会整块替换该行 `config`）：

```yaml
- id: web
  config:
    searchProvider: websearch-failover
    fetchProvider: http
- insert:
    - id: websearch-failover
      name: 'dsh-websearch-failover'
```

首次接线需要一次 DSH 冷启动才会读新的 `package.json`——**重启必须先拿到用户明确批准**（见仓库根 `AGENTS.md`）。

**生效方式**：profile 开着 HMR —— **host 半区**（provider 注册、HTTP API、运行时状态）原地换文件后热生效，不需要重启 DSH；UI 区块由 `dsh-inventory` 的「工具管理」页渲染（分段标签「Web 搜索提供方」或总览里的同名分区），改完刷新一次页面即可。

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

数组顺序就是优先级（也可在工具管理页里用 `runtime.json` 覆盖）。完整示例见 `providers.example.json`。

- **适配器** `kind`：`tavily` `serper` `brave` `bocha` `exa` `jina` `searxng` `parallel` `firecrawl` `custom`。
- `custom`：`request`（method/url/headers/body，占位符 `${key}` `${query}` `${limit}`）+ `response`（`sourcesPath` 点号路径，`map` 里的 title/url/snippet/publishedAt）。
- **key 解析**：`apiKey` 字面值 → `apiKeyEnv`（可加 `apiKeyEnvFallbacks`）→ `keyFile` 首行；`keyOptional: true` 允许无 key（如本地 SearXNG）。
- `enabled: false` 的行不参与搜索，但仍显示在工具管理页。
- 其它可用字段：`label`（面板显示名）、`endpoint`、每行自己的 `timeoutMs`。
- **余额**：内置 `firecrawl`、`tavily` 的余额接口（2026-10-24 对真实 API 验证过）：
  - firecrawl `GET https://api.firecrawl.dev/v2/team/credit-usage` → `data.remainingCredits` / `data.planCredits`（v1 的 snake_case 字段也接受）；
  - tavily `GET https://api.tavily.com/usage` → `account.plan_limit - account.plan_usage`。

  其它家若想显示余额，在行里加 `"balance": { "request": {...}, "response": { "remainingPath"|"totalPath"|"usedPath" }, "unit": "credits|usd|percent|requests|tokens" }`；路径可以是单个点号路径，也可以是**候选路径数组**（取第一个能取到值的，用来兼容 v1/v2 或改名后的响应）。没有余额接口就显示中性提示（`status: unknown`），不影响搜索。

- **重置时间**：面板右列会显示「重置」一行，字段是 `balance.resetKind` + `balance.resetsAt`（epoch ms）。内置规则（2026-10-24 核实）：

  | 提供方 | `resetKind` | 语义 |
  | --- | --- | --- |
  | firecrawl | `period-end` | 取上游 `data.billingPeriodEnd`，面板显示具体时间 + 倒计时（你这个账户是每月 17 日 11:43） |
  | tavily | `monthly-first` | 官方规则：每月 1 日重置（显示「每月 1 日重置 · 下次 …」） |
  | parallel | `monthly-allowance` | 每月免费额度恢复，**预付费额度不重置** |
  | exa / 其余 | `none` | 预付或按量计费，不按月回血 |

  自定义提供方也可以声明：`"balance": { ..., "reset": { "kind": "period-end", "path": "data.billingPeriodEnd" } }` 或 `{ "kind": "monthly-first" }` / `{ "kind": "monthly-allowance" }` / `{ "kind": "none" }`。上游没给时间时 `resetsAt` 为 `null`，面板显示「未知，先刷新余额」或对应规则文案，不会出现 NaN。

## 4. 运行时状态文件

| 文件 | 默认位置 | 写者 | 内容 |
| --- | --- | --- | --- |
| `providers.json` | `$DSH_HOME/websearch-failover/providers.json` | 你手写 | 提供方清单、key 来源、默认参数 |
| `runtime.json` | `$DSH_HOME/websearch-failover/runtime.json` | 插件（工具管理页操作、搜索统计、余额刷新） | `version`、`order`（优先级 id 数组）、`disabled`（id → true）、`balances`（每次探测结果）、`stats`（calls / successes / failures / lastUsedAt / lastOutcome / lastError）、`updatedAt` |
| `websearch-failover-state.json` | `$DSH_HOME/websearch-failover-state.json` | 引擎 | 每家的冷却记录：`until`、`reason`（quota/auth/error）、`code`、`message`、`at` |
| `plugin.log` | `$DSH_HOME/websearch-failover/plugin.log` | 插件 | 注册、每次搜索的命中家与 attempts、顺序/启停变更、余额刷新结果 |

前三个文件可被环境变量覆盖：`$WEBSEARCH_FAILOVER_CONFIG`、`$WEBSEARCH_FAILOVER_RUNTIME`、`$WEBSEARCH_FAILOVER_STATE`。文件缺失或 JSON 损坏时一律当作“没有覆盖/没有冷却”，不会让搜索失败。写入是「临时文件 + rename」的原子替换。

`runtime.json` 里的 `order` 只给**已列出**的 id 排序，没列到的保持配置文件里的相对顺序；`disabled` 里的 id 直接从候选队列移除。

## 5. 提供方管理界面（在「工具管理」页里）

入口在 `dsh-inventory` 的**工具管理**页：分段控件上的「Web 搜索提供方」标签，或总览里的同名分区（默认展开）。本 bundle 的浏览器半区只注册 `websearch-failover` 命名空间的文案字典，**不再注册 `sidebar.panellist` / `main` 槽位**，所以侧边栏没有独立入口。

- 列表：按优先级排的提供方，每行有序号徽标、名称、余额条、金额+单位、状态点（正常 / 冷却 / 未知，冷却时显示倒计时），右侧是上移/下移按钮；也可以直接拖动行。
- 余额条：host 给了 `ratio`（有 total 或 percent 时算得出）就按 `ratio` 画；只有绝对值时按「本面板内最大 remaining」做归一化；完全未知就画空轨道 + 中性提示，绝不出现 NaN 宽度。
- 详情：选中提供方的详情 —— 余额、单位、占比、**重置时间**（`period-end` 显示具体时间+倒计时，`monthly-first` 显示每月 1 日，`monthly-allowance` 说明付费额度不重置，`none` 表示不按月）、冷却、key 是否已配置、本地调用统计（次数/成功/失败/最近调用）、启用/停用开关。
- 排序：拖动行，或用上/下移按钮；两者都乐观更新 UI，失败回滚并提示。顺序即调用优先级，区块顶部有「从上往下依次调用，最上方优先」提示。
- 「刷新余额」只在你点击时请求，避免按次计费接口被轮询烧额度；只有存在冷却项时才有 1 秒计时器刷新倒计时文案。
- 「返回对话」由外壳自身提供，本 bundle 不再处理。

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

空结果 → 换下一家但不冷却；冷却中的家不发请求，直接 `skipped`；搜索成功会清掉该家的冷却记录；全部失败抛 `ALL_FAILED` 并附带逐家 `attempts`。工具管理页 `stats` 会把每次 `ok` / `failed` / `empty` 记到 `runtime.json`。

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
index.js             host 半区：注册 ctx.web 提供方 + 挂管理 API
client.js            浏览器半区：提供方管理器面板（渲染在 dsh-inventory 的工具管理页）
cordis.patch.yml     bundle patch：只 insert 自己那一行
package.json         bundle 声明（dsh.bundle.patch + dsh.client）
lib/core.mjs         有序失败转移引擎：HTTP 适配器、错误分类、冷却、状态持久化
lib/runtime.mjs      运行时状态：order / disabled / balances / stats（原子写）
lib/balance.mjs      余额归一化 + 按 kind 探测（内置 firecrawl、tavily）
lib/api.mjs          管理页四条路由的 HTTP API
lib/http.mjs         共享 HTTP 小工具（同源校验、body 上限、JSON 响应、truncate）
locale/*.json        面板文案字典（中英，namespace websearch-failover）
icon.svg             图标（24×24 viewBox，currentColor 描边）
search.mjs           CLI
providers.example.json  配置示例
test/*.mjs           离线测试（见下）
tools/               DSH app.asar 只读检查小工具 + 余额接口体检脚本（开发期用，不参与运行）
providers.json / runtime.json / websearch-failover-state.json / plugin.log
                     运行时文件，全部在 $DSH_HOME 下，git 忽略
```

0.4.0 起 `plugin/` 子目录、`lib/` → `plugin/lib/` 的构建副本、以及 `scripts/build-plugin.mjs` / `scripts/install.mjs` 都已退役：包根就是被 `link:` 的 bundle，`lib/` 即源码本体。`HANDOVER.md` 与 `doublecheck-report.md` 是更早布局的历史快照，安装部分以本文与根 README 为准。

包内 `package.json` 里仍可用的脚本：

| 脚本 | 命令 |
| --- | --- |
| `npm test` | 跑全部 10 个离线测试文件（29 个测试，见 §10） |
| `npm run test:engine` | `node test/mock-failover.mjs` |
| `npm run test:runtime` | `node test/test-runtime.mjs` |
| `npm run test:balance` | `node test/test-balance.mjs` |
| `npm run test:api` | `node test/test-api.mjs` |
| `npm run test:plugin` | `node test/test-host-plugin.mjs` |
| `npm run test:integration` | `node test/test-integration.mjs` |
| `npm run test:client` | `node test/test-client-static.mjs` |
| `npm run test:render` | `node test/test-client-render.mjs` |
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
node test/test-mutex.mjs           # refresh 并发互斥
node test/test-t4web.mjs           # T4.web 配置/示例/余额探测契约
# test/probe-bundle.mjs 是共享模块（打包探针），被 host / 集成套件 import，不单独跑
```

`npm test` 跑 `test/mock-failover.mjs` 与全部 `test/test-*.mjs`（10 个文件 / 29 个测试）。它们都离线运行，不碰真实 profile，也不写运行者的 HOME（`logPath` 指向测试自己的临时目录）。

## 11. 安全说明

- **API key 只存在于 `~/.dsh/websearch-failover/providers.json`（或你用环境变量 / keyFile 指定的位置），是明文**；本仓库、包根、`runtime.json` 里都没有 key。`.gitignore` 已忽略 `providers.json`、`runtime.json`、`websearch-failover-state.json`、`plugin.log`。
- 工具管理页 API 只返回 `keyPresent` 布尔值，不返回 key 本身，也不返回上游响应原文。
- 写请求做同源校验（`Origin`/`Host` 不一致或 `sec-fetch-site: cross-site` → 403），body 上限 128 KiB，响应 `no-store`。
- 插件只读写上面列出的 `$DSH_HOME` 文件，不监听其它路由、不发遥测。
- DSH 默认只绑本机回环。别把 DSH 端口暴露到不可信网络：面板能改的是你的搜索优先级与余额探测目标，等同本机 profile 管理权限。
- 余额探测会带着你的 key 请求各家的余额接口（内置只有 firecrawl / tavily，且只在你点「刷新余额」时发生）。

## 12. License

MIT，见 `LICENSE`。

---

## English (short)

**dsh-websearch-failover** is a DeepSeek Harness bundle that turns the native `web_search` into an ordered multi-provider failover chain: providers are tried top-to-bottom in the user's priority order, and quota/auth/transport failures put that provider on a quota-aware cooldown instead of failing the search. It registers a single `websearch-failover` provider on `ctx.web`, so the harness never sees an ambiguous provider set, and it serves a small HTTP API behind a provider manager that renders inside dsh-inventory's Tools page.

- **Install:** this package is one of the eight bundles in the DSH-plugins repository; follow the root README. Add `"dsh-websearch-failover": "link:<repo>/packages/dsh-websearch-failover"` to the profile's `dependencies` **and** `"dsh-websearch-failover"` to `dsh.profile.bundles` (a dependency line alone does not load it), then put `searchProvider: websearch-failover` and `fetchProvider: http` on the `web` row in `<profile>/cordis.patch.yml` (a profile patch replaces the row's whole `config`). The profile has HMR enabled, so the host half applies live without restarting DSH; only the browser half needs one page reload. The first wiring needs one cold start — ask the user before restarting.
- **Config:** `~/.dsh/websearch-failover/providers.json` (or `$WEBSEARCH_FAILOVER_CONFIG`) — providers in priority order, key via `apiKey` / `apiKeyEnv` / `keyFile`; adapters `tavily serper brave bocha exa jina searxng parallel firecrawl custom`. Hot-reloaded on the next search. Built-in balance probes (verified against the live APIs on 2026-10-24): firecrawl `GET https://api.firecrawl.dev/v2/team/credit-usage` → `data.remainingCredits` / `data.planCredits` (v1 snake_case also accepted), tavily `GET https://api.tavily.com/usage` → `account.plan_limit - account.plan_usage`.
- **State:** `~/.dsh/websearch-failover/runtime.json` (order, disabled, balances, stats), `~/.dsh/websearch-failover-state.json` (cooldowns), `~/.dsh/websearch-failover/plugin.log`.
- **API:** `/websearch-failover/api/{state,order,refresh,enable}`; POST bodies `{order:[...]}`, `{ids?:[...]}`, `{id,enabled}`. Same-origin checked, 128 KiB body cap, never returns API keys.
- **Tests:** `npm test` runs `test/mock-failover.mjs` plus every `test/test-*.mjs` — 10 offline files, 29 tests. `test/probe-bundle.mjs` is a shared probe module imported by the host and integration suites, not a suite of its own, so it is deliberately outside the glob.
- **Security:** API keys live only in `~/.dsh` as plaintext, never in this repository; `.gitignore` covers the config/state/log files.
