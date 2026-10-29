# 交接书：dsh-websearch-failover（DSH 有序多提供方搜索 + 侧栏余额管理器）

> 最后更新：2026-10-24 20:20（Asia/Shanghai）
> 仓库：`E:\Project-hub\websearch-dsh-plugin` · GitHub `kurumi1ksllq/websearch-dsh-plugin`
> 本机 DSH：0.2.1-rc.2（cordis 4.0.5），profile `desktop`，`DSH_HOME=C:\Users\admin\.dsh`

---

## 0. 一页摘要

**做了什么**：把 DSH 原生 `web_search` 变成「按用户排序的提供方队列 + 配额冷却」，并在**左侧边栏**加一个提供方管理器面板：每个提供方的余额（credits / 美元 / 百分比 / 次数 / tokens 混排）都按比例画条，列表顺序 = 调用优先级（最上方先被调用），可拖动/箭头排序、单独启停、手动刷新余额。

**本机已验证（2026-10-24，活体运行时，不是 mock）**：

| 证据 | 结果 |
|---|---|
| 安装后 HMR 热生效（profile 开了 hmr） | `plugin.log` 出现 `registered search provider "websearch-failover"`，无需重启 |
| `GET /websearch-failover/api/state` | HTTP 200，返回真实 4 家：tavily / exa / firecrawl / parallel |
| `POST /api/refresh`（真 key 打真上游） | Tavily `1000/1000 credits`、Firecrawl `1017/1000 credits`（比例条自动 clamp 到 100%）、Exa/Parallel `no-balance-api` |
| 原生 `web_search` 实际走插件 | 日志 `search "…" -> tavily (8 sources) attempts: tavily=ok`，`stats.tavily.calls=1` |
| 改顺序 → 下一个被消耗的是新榜首 | `order: firecrawl > tavily > exa > parallel` → 下一次搜索 `-> firecrawl (8 sources)`，随后已把顺序还原为 tavily 优先 |
| 浏览器 bundle 真进了 boot graph | `/plugins/events` 的 graph 含 `dsh-websearch-failover`（`inject` 三项、`immediately: true`），组合 bundle URL 取回 `HTTP 200 / 41712 bytes`，内含 `websearch-failover/api/state` |
| 离线测试 | 8 个套件全绿（见 §8），含真实 `node:http` 回环集成测试 |

**唯一需要人手动做的一步**：如果页面还没出现侧栏按钮，**刷新页面**（Host 侧已经热生效；浏览器端 boot graph 由页面消费）。

---

## 1. 为什么必须是插件（而不是配置）

来自 `E:\DeepSeekHarness\resources\app.asar` 内 `@deepseek-ai/dsh-web` 的实现：`WebRuntime.search()` 用 `resolveProvider()` 选**一个**提供方，拿到就 `return`，没有候选队列；提供方抛错直接冒泡；`$DSH_WEB_SEARCH_PROVIDER` 的源码注释原文是 **“NOT a hidden priority chain”**。

| 情形 | 原生结果 |
|---|---|
| 配了 id，已注册且可用 | 用它，不重试 |
| 没配 id，恰好一家可用 | 用它 |
| 没配 id，多家可用 | `WEB_PROVIDER_AMBIGUOUS` |
| 无可用 | `WEB_PROVIDER_UNAVAILABLE` |

所以本插件自己注册**一个** provider（id `websearch-failover`），内部走有序队列 + 冷却状态机。原生 `web_search`、子智能体、队友全部自动继承能力。

**边界**：只覆盖 search（`searchProviders` 注册表）。`web_fetch` 是独立注册表（`fetchProviders`），本插件不碰；profile patch 里会保留 `fetchProvider: http` 正是为此。

---

## 2. 目录与职责

```
websearch-dsh-plugin/
├─ lib/                         ← 唯一逻辑真源（.mjs，无依赖）
│  ├─ core.mjs                  引擎：10 家 HTTP 适配器、错误分类、配额冷却、状态持久化（旧资产，保留）
│  ├─ runtime.mjs               顺序 / 启停 / 余额 / 统计 的持久化与排序（applyRuntime 是顺序语义的唯一实现）
│  ├─ balance.mjs               余额探测与归一化（credits|usd|percent|requests|tokens|unknown → 统一记录 + ratio）
│  ├─ api.mjs                   侧栏 HTTP API（prefix 路由，四个动作，同源校验）
│  └─ http.mjs                  sendJson / isForbiddenOrigin / readJsonBody / truncate
├─ plugin/                      ← 可安装的 DSH bundle（name: dsh-websearch-failover）
│  ├─ package.json              dsh.bundle.patch + dsh.client{platform:web, immediately, inject[layout,sidebar,locale]}
│  ├─ cordis.patch.yml          bundle 层：只 insert 自己的 host 行
│  ├─ index.js                  Host 半区：注册 ctx.web 提供方 + 挂 API 路由 + 写 plugin.log
│  ├─ client.js                 Client 半区：window.__ModuleLoader__ bundle，左侧栏入口 + 双栏面板
│  ├─ locale/{zh,en}.json       扁平 key→string，与 client.js 内注册的字符串逐字节一致
│  ├─ icon.svg                  放大镜+列表，currentColor
│  └─ lib/*.mjs                 **生成物**（scripts/build-plugin.mjs 从 lib/ 复制，gitignore）
├─ scripts/
│  ├─ build-plugin.mjs          lib/ → plugin/lib/，幂等，--check 检陈旧
│  └─ install.mjs               装/卸：复制 bundle、追加 bundles、写带标记的 patch 块，带时间戳备份
├─ test/                        8 个套件（§8）
├─ tools/
│  ├─ asar-get.cjs              不解包读 app.asar 文件
│  ├─ asar-files.mjs            带 size 的 asar 文件清单
│  └─ probe-balance-endpoints.mjs  用真 key 探测各家余额端点（不打印 key）
├─ search.mjs                   引擎 CLI（搜索 / --probe / --list）
├─ providers.example.json       配置模板（无 key）
├─ package.json                 仓库脚本（test / build / plugin:install / probe…）
├─ HANDOVER.md                  本文件
└─ README.md                    面向使用者的说明
```

**不随仓库走**：真实 `providers.json`（含明文 key，在 `~/.dsh/websearch-failover/`）、`runtime.json`（顺序/余额/统计）、`plugin.log`、`plugin/lib/`（生成物）。

---

## 3. 安装 / 回滚

```bash
node scripts/build-plugin.mjs --check    # 生成物是否最新
node scripts/install.mjs --dry-run       # 只看计划，零写入
node scripts/install.mjs                 # 装进 profile（内容没变会打印 unchanged，不写文件）
node scripts/install.mjs --uninstall     # 逐字节还原 profile 两个文件
```

安装器只做五件事：跑 build（失败即中止）→ 把 `plugin/` 同步到 `<profile>/node_modules/dsh-websearch-failover/`（自包含，已含 `plugin/lib/`）→ 在 `<profile>/package.json` 的 `dsh.profile.bundles` 追加 `"dsh-websearch-failover"` → 在同一份 `package.json` 的 `dependencies` 里写 `"dsh-websearch-failover": "link:<仓库>/plugin"`（**必须声明**，见下面「为什么必须写 dependencies」）→ 在 `<profile>/cordis.patch.yml` 末尾写一个带标记的块：

```yaml
# >>> websearch-failover (managed by scripts/install.mjs — re-run to update, --uninstall to remove)
- id: web
  config:
    searchProvider: websearch-failover
    fetchProvider: http
- insert:
    - id: websearch-failover
      name: 'dsh-websearch-failover'
# <<< websearch-failover
```

要点：
- **为什么必须写 dependencies（2026-10-25 事故复盘）**：只复制目录、不声明依赖时，DSH 插件管理器每次装/卸插件都会在 profile 里跑一次 `pnpm install`，pnpm 会把这个「不在依赖树里」的目录判为 extraneous，移到 `node_modules/.ignored/`，插件静默失效：侧栏面板消失，`web_search` 回落原生单提供方，`plugin.log` 停在最后一次 `registered search provider`。识别特征：`dsh.profile.bundles` 和 patch 块都还在，只有 `node_modules/dsh-websearch-failover` 不见了（`ls node_modules/.ignored` 能找到它）。声明成 `link:` 后 pnpm 把它当正式依赖（symlink 到 `<仓库>/plugin`），`pnpm install` 只打印 `Already up to date`，不再 prune。代价：仓库目录不能移动；移动后重跑 `node scripts/install.mjs`。
- profile patch 会**整块替换**目标行的 `config`，所以必须同时写回 `fetchProvider: http`，否则原生 http 抓取器会被冲掉。
- 真正修改前写 `*.bak-websearch-failover-<时间戳>`；`--uninstall` 按文本精确摘除（含 dependencies 条目），`test/test-install.mjs` 逐字节比对还原结果。
- 本机 profile 开了 hmr（`dsh-base` 的 `hmr` 行在 `profileContext` 存在时启用），所以 **Host 侧改动热生效**；浏览器端需要刷新页面才会消费新的 boot graph。注意：bundle 目录本身缺失时 HMR 不会自愈，必须补回目录并重启 DSH（`GET /websearch-failover/api/state` 返回 404 就是没加载）。

---

## 4. 配置：`providers.json`

位置：`$WEBSEARCH_FAILOVER_CONFIG` → `$DSH_HOME/websearch-failover/providers.json` → `<脚本目录>/providers.json`。

```json
{
  "defaults": { "limit": 8, "timeoutMs": 15000, "cooldown": { "quota": 1800, "auth": 86400, "error": 60 } },
  "providers": [
    { "id": "tavily",   "kind": "tavily",   "apiKey": "…" },
    { "id": "exa",      "kind": "exa",      "apiKey": "…" },
    { "id": "firecrawl","kind": "firecrawl","apiKey": "…" },
    { "id": "parallel", "kind": "parallel", "apiKey": "…", "enabled": false }
  ]
}
```

- **数组顺序 = 出厂优先级**；侧栏拖动后的顺序写在 `runtime.json` 的 `order`，覆盖数组顺序。
- `enabled: false` 的 provider 引擎不会调用，但**侧栏仍然列出**（灰显），可一键启用——不会去改你的 key 文件。
- key 解析顺序：`apiKey` 字面值 → `apiKeyEnv`/`apiKeyEnvFallbacks` 环境变量 → `keyFile` 首行 → `keyOptional` 允许空。
- 内置 `kind`：`tavily / serper / brave / bocha / exa / jina / searxng / parallel / firecrawl / custom`（`custom` 支持 `${query}/${key}/${limit}` 模板 + 点号路径映射）。

### 余额接口（`balance` 段，可选）

内置两家已对**真实 API** 核实（2026-10-24）：

| kind | 端点 | 取值 | 单位 |
|---|---|---|---|
| `tavily` | `GET https://api.tavily.com/usage`（`Authorization: Bearer`） | `account.plan_limit - account.plan_usage` | credits |
| `firecrawl` | `GET https://api.firecrawl.dev/v2/team/credit-usage`（`Authorization: Bearer`） | `data.remainingCredits` / `data.planCredits`（兼容 v1 蛇形） | credits |

其余（exa / parallel / brave / serper / bocha / jina / searxng）目前**没有公开余额接口**，面板显示「未提供余额接口」而不是报错。想接自己的计费口，用 `custom`：

```json
{
  "id": "my-search", "kind": "custom", "apiKey": "…",
  "request": { "method": "GET", "url": "https://api.example.com/quota", "headers": { "x-api-key": "${key}" } },
  "balance": {
    "kind": "custom",
    "request": { "method": "GET", "url": "https://api.example.com/quota", "headers": { "x-api-key": "${key}" } },
    "response": { "remainingPath": "data.left", "totalPath": "data.all", "usedPath": "data.used" },
    "unit": "usd"
  }
}
```

`response` 的路径可以是字符串或**候选数组**（取第一个能解析到的）；`remainingPath` 缺失时用 `total - used` 推算。`unit` ∈ `credits | usd | percent | requests | tokens | unknown`；`percent` 且无 `total` 时 ratio = `remaining/100`。比例的最终计算只发生在 `lib/balance.mjs` 的 `normalizeBalance()`，恒 clamp 到 `0..1`。

### 额度重置（`resetKind` / `resetsAt`）

每条 balance 记录还带两个字段：`resetKind` ∈ `period-end | monthly-first | monthly-allowance | none`，`resetsAt` 是 epoch ms（未知为 `null`）。面板右列「重置」一行就是这两字段：

| 来源 | resetKind | 计算方式 | 实测（2026-10-24） |
|---|---|---|---|
| firecrawl | `period-end` | 取响应 `data.billingPeriodEnd`（兼容蛇形） | `2026-11-17T03:43:17.842Z` → 每月 17 日 11:43（北京时间） |
| tavily | `monthly-first` | `nextMonthFirst()`：下月 1 日 00:00 UTC | 官方 FAQ：每月 1 日重置，与账单日无关 |
| parallel | `monthly-allowance` | `nextMonthFirst()` | 官方 pricing：每月 5,000 请求 + $5 免费额度；预付费 credits 不重置 |
| exa / 其余 | `none` | 不计算 | 预付/按量计费，不按月回血 |

规则解析顺序：`provider.balance.reset`（自定义规格，`{ kind, path }` 可选点号路径/候选数组）→ 内置 `RESET_POLICY` → 默认 `none`。上游没给时间时 `resetsAt = null`，`resetKind` 仍保留真实语义（例如 period-end 尚未探测时，面板显示「未知，先刷新余额」）。`nextMonthFirst()` 是纯函数，测试里用固定 `now` 断言月份跳变，不依赖本机时钟。

---

## 5. HTTP API（侧栏面板的唯一数据面）

Base：`/websearch-failover/api`（`prefix` 路由，`kind: 'prefix'`）。

| 方法 | 路径 | body | 语义 |
|---|---|---|---|
| GET | `/state` | — | 顺序 + 每家余额/冷却/统计 |
| POST | `/order` | `{"order":["id1","id2"]}` | 写 `runtime.json.order`，返回新快照 |
| POST | `/refresh` | `{"ids":["id1"]}` 或 `{}` | 打真上游取余额（省略 ids = 全部），写 `runtime.json.balances` |
| POST | `/enable` | `{"id":"x","enabled":false}` | 写 `runtime.json.disabled` |

- 所有 POST 都做同源校验（`sec-fetch-site: cross-site` → 403；`Origin.host !== Host` → 403），因为路由绕过 `/api` 授权层。
- body 上限 128 KiB（413）；坏 JSON 400；非数组 order 400；未知路径 404；方法不符 405 带 `Allow`；服务内部异常 500 带 message。
- 快照字段：`{ok, generatedAt, order:[id], providers:[{id, kind, label, enabled, rank, keyPresent, balance|null, cooldown:{active,until,reason,message}, stats:{calls,successes,failures,lastUsedAt,lastOutcome,lastError}}]}`；`balance` 内的 `resetKind` / `resetsAt` 见 §4。

排序语义唯一实现：`lib/runtime.mjs` 的 `applyRuntime(providers, runtime)` —— 先按 `disabled` 过滤，再按 `order` 里的下标稳定排序，`order` 里不存在的 id 保持配置顺序；过期/未知 id 自动忽略。

---

## 6. 冷却与失败分类（`lib/core.mjs`，旧资产，未改语义）

| 分类 | 触发 | 默认冷却 |
|---|---|---|
| `quota` | 429 / 402；或响应含 quota/credit/insufficient/balance/exceeded/额度/余额/配额… | 1800s（响应带 `retry_after` 优先） |
| `auth` | 401；403 且不含额度词；或 `KEY_MISSING` | 86400s |
| `error` | 5xx / 网络 / 不可解析 | 60s |
| `bad_request` | 400 / 422 | 不冷却 |

行为：冷却中记 `skipped` 且**不发请求**；空结果记 `empty` 换下一家但不冷却；成功立刻清冷却并返回；全失败抛 `ALL_FAILED`（message 带逐家 attempts）。冷却状态在 `$DSH_HOME/websearch-failover-state.json`，统计在 `runtime.json`。

---

## 7. 已知限制 / 待决

1. **Exa / Parallel 无余额接口**：面板只能显示「未提供余额接口」+ 冷却状态；Parallel 402 时靠冷却体现（本机已实测）。
2. **Firecrawl 网络抖动**：本机 2026-10-24 用 node fetch 打 `api.firecrawl.dev` 出现过 `ECONNRESET`，同一时刻 curl 正常。余额探测失败只会显示错误状态，不影响搜索。
3. **浏览器端要刷新页面**：Host 热生效，但 boot graph 由页面消费；HMR 一般会在下一次图更新时加载，不保证无刷新。
4. **余额是快照**：只有点「刷新余额」才更新（刻意不自动轮询，避免打上游计费接口）。`fetchedAt` 在面板上可见。
5. **`tavily` 的额度口径**：用 `account.plan_limit - account.plan_usage`（月度计划）；`key.limit` 可能为 `null`，不作为依据。paya-as-you-go 用量暂不纳入。
6. **`web_fetch` 不覆盖**：fetch 是独立注册表；需要的话再写一个 fetch provider。
7. **不做结果融合**：命中即止，不跨家合并/去重排序。
8. **同一 provider id 只能注册一次**：本插件固定 `websearch-failover`，profile 里 `web.searchProvider` 必须指向它。
9. **`plugin/lib/` 是生成物**：改逻辑只能改 `lib/`，然后 `node scripts/build-plugin.mjs` + 重装；`--check` 会在陈旧时报错。

---

## 8. 测试矩阵（全绿才算通过）

```bash
npm test     # 依次跑下面 8 个套件
```

| 套件 | 覆盖 |
|---|---|
| `test/mock-failover.mjs` | 引擎不变量：顺序、命中即止、冷却跳过、空结果转移、全失败 |
| `test/test-runtime.mjs` | 顺序/启停/统计/余额持久化，坏文件容错，原子写，env 路径优先级 |
| `test/test-balance.mjs` | 单位归一化（credits/usd/percent/requests/tokens/unknown）、ratio clamp、字符串数字、Firecrawl v2/v1、Tavily 真实形状、custom 路径映射、错误与无接口 |
| `test/test-api.mjs` | 四路由、405/404/403/400/413/500、同源校验、body 上限 |
| `test/test-host-plugin.mjs` | 真实 `plugin/index.js` + stub ctx：注册、available() 不抛、搜索统计、API 改序/停用、冷却透出、余额刷新、日志 |
| `test/test-integration.mjs` | 真 `node:http` 回环：GET/POST 走真 fetch、真 header、真持久化 |
| `test/test-client-static.mjs` | 浏览器 bundle 契约：可解析、module id、两槽位、四条路由、只 require('react')、locale 键集一致、ratio clamp |
| `test/test-client-render.mjs` | 迷你 hook runtime 执行真实 `client.js`：渲染文本、条宽百分比、拖放/箭头 POST body、失败回滚、启停、返回 |
| `test/test-install.mjs` | 假 profile：dry-run 零写入、幂等、逐字节还原、bundles 不重复、build 失败拒装 |

CLI 真连（需要真 key）：`node search.mjs --probe` / `node search.mjs "查询词" --limit 5`；余额端点体检：`npm run probe:balance`。

---

## 9. 环境事实（踩过的坑）

| 项 | 值 |
|---|---|
| OS / shell | Windows 11；命令一律经 Git Bash：`& 'C:\Program Files\Git\bin\bash.exe' -c '…'; exit $LASTEXITCODE`（裸 `bash` 命中的是 WSL 桩，静默失败） |
| Node | v24.15.0 |
| DSH | 0.2.1-rc.2，cordis 4.0.5，`E:\DeepSeekHarness\resources\app.asar`（单文件，用 `tools/asar-get.cjs` 读） |
| profile | `C:\Users\admin\.dsh\profiles\desktop`（`dsh.profile.bundles` + `cordis.patch.yml` 两层） |
| Git push | 本机 `schannel` 会握手失败，仓库已设 `git config http.sslBackend openssl`；push 用 `git -c http.version=HTTP/1.1 push` |
| asar 路径 | 必须 `MSYS2_ARG_CONV_EXCL='*'`，否则 `/dsh/...` 被改写成 `C:/Program Files/Git/dsh/...` |
| node 里的 `/tmp` | 会解析成 `D:\tmp`；跨工具传路径先用 `cygpath -w` |
| `node --test test/` | Node 24 下目录形式会 `MODULE_NOT_FOUND`，用 `"test/*.mjs"` 或直接 `npm test` |

---

## 10. 后续可做

1. 给 Exa / Parallel 之类补「按调用次数估算」的本地余额（`source: 'estimate'`），面板已预留 `source/detail` 字段。
2. `custom` 余额支持 `scale`（把上游毫单位换成美元）与多候选 URL 重试。
3. 面板加「按冷却自动下沉」开关（把 `quota` 冷却中的 provider 临时排到最后）。
4. 结果融合模式：前两家并行 + URL 去重 + 不足再补。
5. 打包发 npm（去掉 `private`，`files` 已就绪），并给 `dsh-plugin-market` 写 index。
