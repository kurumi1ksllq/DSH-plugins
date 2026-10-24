# 交接书：DSH 多搜索提供方 failover 插件

> 交接时间：2026-10-24
> 交接人：DSH 会话 `session-5de8f2a8`（Lead）
> 目的：让接手方在新工作区独立开发这个插件，不依赖本会话或旧工作区的上下文。
> 原工作区路径：`D:\Documents\deepseek-harness\default-workspace\tools\websearch-failover`

---

## 0. 一页摘要

**已确认的事实**：DSH（0.2.1-rc.2）的 `web_search` **只会选中一个搜索提供方**，不重试、无额度概念，多家可用时直接抛 `WEB_PROVIDER_AMBIGUOUS`。所以「一家没额度自动换下一家」必须自带实现。

**已完成**（全部通过离线测试，未动运行时）：

| 产物 | 作用 | 状态 |
|---|---|---|
| `lib/core.mjs`（561 行） | 有序失败转移引擎：HTTP 适配器、错误分类、配额冷却、状态持久化 | 6 项不变量测试通过 |
| `search.mjs`（113 行） | CLI：搜索 / `--probe` 体检 / `--list` / `--json` / `--force` | 4 家真 key 实测通过 |
| `plugin/index.js`（92 行） | cordis 插件：把 failover 注册成 `ctx.web` 的 `failover` provider | 6 项契约测试通过 |
| `plugin/install.mjs`（142 行） | 装/卸：同步包进 profile + 给 `cordis.patch.yml` 打带标记的 patch 块（含备份） | `--dry-run` 通过 |
| `test/mock-failover.mjs`（132 行） | 引擎离线不变量测试 | 全绿 |
| `test/test-plugin.mjs`（92 行） | 插件契约测试（stub ctx + mock HTTP） | 全绿 |

**唯一没做的一步**：在真实 profile 上执行 `node plugin/install.mjs`。原因见 §10 风险 1（会改写用户运行中的 `cordis.patch.yml`，需一次重启或热重载才生效）。

**接手方第一件事**：读 §10、跑 §9 的两条测试命令、按 §11 决定是否装。

---

## 1. 背景：为什么必须在 DSH 之外实现

来自本机 `E:\DeepSeekHarness\resources\app.asar` 中 `@deepseek-ai/dsh-web@0.2.1-rc.2`（`lib/index.js`）的实证：

```js
// WebRuntime.search()
async search(request, signal) {
  const configuredId = this.config.searchProvider.get() ?? this.searchProviderEnv;
  return capSources(await resolveProvider({
    providers: this.searchProviders,
    ...(configuredId !== void 0 ? { configuredId } : {})
  }).search(request, signal), request.maxResults);
}
```

选择语义（源码注释原文，逐条可验证）：

| 情形 | 结果 |
|---|---|
| 配了 id，已注册且 `available()` | 用它 |
| 配了 id，未注册 | `WEB_PROVIDER_CONFIGURED_MISSING` |
| 配了 id，已注册但不可用 | `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 未配 id，恰好一家可用 | 用它 |
| 未配 id，多家可用 | **`WEB_PROVIDER_AMBIGUOUS`**（"configure one explicitly"） |
| 未配 id，无可用 | `WEB_PROVIDER_UNAVAILABLE` |

三个关键结论：

1. `resolveProvider()` 拿到一个就 `return`，**没有候选队列**；
2. 提供方抛错直接冒泡成 `WebError`，`dsh-tool-web` 里 grep 不到 retry / fallback / attempt 任何逻辑；
3. `$DSH_WEB_SEARCH_PROVIDER` 等价于 `searchProvider`，源码注释明确：**"NOT a hidden priority chain"**。

再加一条与本项目相关的设计约束：搜索与抓取共用一个 seam，但**注册表是分开的**（`searchProviders` / `fetchProviders`）。本插件只覆盖 search；`web_fetch` 的失败转移是另一件事（见 §10 风险 4）。

内置的 provider 只有两家：

- `deepseek-official` —— `@deepseek-ai/dsh-web-search-deepseek`，走 Anthropic 兼容 Messages + 原生 `web_search_20250305` 工具（一次搜索=一个模型轮次）；
- `deepseek-search-api` / `deepseek-fetch-api` —— `@deepseek-ai/dsh-web-deepseek-api`，专用检索 API。

两者都依赖 DeepSeek 凭据，没有任何第三方搜索 provider，也没有配额感知。

---

## 2. 目标与非目标

**目标**

1. 一个 provider 注册进 `ctx.web`，id 为 `failover`，原生 `web_search` 直接受益；
2. 严格按配置顺序尝试，**命中即止**（用户 2026-10-24 明确选定，不做轮询均衡）；
3. 额度类失败（429/402/含 quota 字样）触发**冷却**，冷却期内不发请求，避免持续烧已耗尽的额度；
4. 配置改动无需重启即可生效；
5. 全进程共享：主 agent、子智能体、队友都走同一条路。

**非目标**

- 不 fork / 不改 DSH 本体（只通过 patch 层插入自己的 plugin 行）；
- 不做 MCP 形态（与原生 `web_search` 争选择，且要多背工具 schema）；
- 不做轮询/负载均衡式分摊；
- 不做跨 provider 结果去重融合（命中即止，后续可选）；
- 不覆盖 `web_fetch`。

---

## 3. 目录与职责（新仓库 `E:\Project-hub\websearch-dsh-plugin`）

```
websearch-dsh-plugin/
├─ lib/
│  └─ core.mjs           引擎（唯一逻辑真源）—— 561 行
├─ search.mjs            CLI 包装
├─ plugin/
│  ├─ index.js           cordis 插件 + provider 对象
│  ├─ install.mjs        安装/卸载 + patch 管理
│  ├─ package.json       name: @local/dsh-web-search-failover
│  └─ core.mjs           ← 生成物：test/install 会从 ../lib/core.mjs 复制，已 gitignore
├─ test/
│  ├─ mock-failover.mjs  引擎不变量（HTTP mock，无网络）
│  └─ test-plugin.mjs    插件契约（stub ctx + HTTP mock）
├─ tools/
│  └─ asar-get.cjs       不解包读 app.asar 内文件（查 DSH 源码用）
├─ providers.example.json 配置模板（无 key，可提交）
├─ package.json          仓库脚本：test / probe / plugin:install / asar:get
├─ .gitignore
├─ README.md             面向使用者的说明
└─ HANDOVER.md           本文件
```

**不随仓库走的文件**（故意的）：

| 文件 | 原因 |
|---|---|
| `providers.json`（真实 key） | 在 `~/.dsh/websearch-failover/providers.json`，含明文 key，绝不进仓库 |
| `websearch-failover-state.json` / `plugin.log` | 运行期状态，在 `~/.dsh` 下 |
| `plugin/core.mjs` | 生成物，`node test/test-plugin.mjs` 或 `node plugin/install.mjs` 时会自动生成 |

**真源规则**：`lib/core.mjs` 是唯一实现，`plugin/core.mjs` 是拷贝产物。新项目里请改为构建步骤（esbuild/tsc）或 monorepo 包依赖，别保留两份手写副本。

---

## 4. 契约：`ctx.web` 的 provider 接口

从 `@deepseek-ai/dsh-web` 源码归纳（本机实测可用的最小实现）：

```js
{
  id: 'failover',                    // 注册键，必须唯一
  available(): boolean,              // 同步；插件加载时会被调用
  async search(request, signal): {
    sources: [{ url, title?, snippet?, publishedAt? }],
    truncated: boolean
  }
}
```

要点：

- `available()` **必须同步**且不能抛：seam 在解析时直接调用它判断可用性。
- `request` 至少含 `query`，可能含 `maxResults`（seam 会在返回后再按它截断）。
- `truncated` 语义是「提供方超额返回、被服务截断」。本实现自己就截到 limit，所以恒为 `false`。
- 失败请抛 `WebError`（可自定义 code）；seam 会透传给模型侧工具包装层。我们的实现直接复用 `core.mjs` 的 `SearchError`，其 `code` 会以 message 形式呈现。
- 注册是幂等的反面：**同 id 二次注册会抛 `WEB_DUPLICATE_PROVIDER`**。所以 id 用 `failover`，不要用 `deepseek-official`。

插件侧（cordis 4.0.5）最小形态，参考 `@deepseek-ai/dsh-web-search-deepseek` 的导出：

```js
export const name = 'web-search-failover';
export const inject = ['web'];
export function apply(ctx) { ctx.web.registerSearchProvider(provider); }
```

不需要 `Config` 导出——本插件自己读 JSON 配置文件，避免依赖 schemastery 解析链。

---

## 5. 配置：`providers.json`

位置解析顺序（`core.mjs` 的 `defaultConfigPath()`）：

1. `$WEBSEARCH_FAILOVER_CONFIG`
2. `$DSH_HOME/websearch-failover/providers.json`（本机实际用这个）
3. `<脚本目录>/providers.json`

结构：

```json
{
  "defaults": {
    "limit": 8,
    "timeoutMs": 15000,
    "cooldown": { "quota": 1800, "auth": 86400, "error": 60 }
  },
  "providers": [
    { "id": "tavily", "kind": "tavily", "apiKeyEnv": "TAVILY_API_KEY", "timeoutMs": 12000 },
    { "id": "exa", "kind": "exa", "apiKeyEnv": "EXA_API_KEY", "timeoutMs": 15000 }
  ]
}
```

- **数组顺序即优先级**（也支持显式 `priority`）。
- `enabled: false` 的 provider 被过滤掉，`--probe` 也不会碰它。

内置适配器（`kind`）：

| kind | 端点 | 鉴权方式 |
|---|---|---|
| `tavily` | `POST https://api.tavily.com/search` | body `api_key` |
| `serper` | `POST https://google.serper.dev/search` | 头 `X-API-KEY` |
| `brave` | `GET https://api.brave.com/res/v1/web/search`（实为 `api.search.brave.com`） | 头 `X-Subscription-Token` |
| `bocha` | `POST https://api.bochaai.com/v1/web-search` | `Authorization: Bearer` |
| `exa` | `POST https://api.exa.ai/search` | 头 `x-api-key` |
| `jina` | `GET https://s.jina.ai/<urlencoded query>` | 可选 `Bearer` |
| `searxng` | `GET <endpoint>/search?format=json` | 可选 |
| `parallel` | `POST https://api.parallel.ai/v1/search` | 头 `x-api-key` |
| `firecrawl` | `POST https://api.firecrawl.dev/v1/search` | `Authorization: Bearer` |
| `custom` | 任意 HTTP | `request` 模板 + `response` 点号路径映射 |

key 解析顺序（`resolveKey()`）：`apiKey` 字面值 → `apiKeyEnv` / `apiKeyEnvFallbacks` 环境变量 → `keyFile` 首行 → 都没有则抛 `KEY_MISSING`。

`custom` 示例（新 provider 接入路径，占位符 `${query}` `${key}` `${limit}`）：

```json
{
  "id": "my-search",
  "kind": "custom",
  "apiKeyEnv": "MY_SEARCH_KEY",
  "request": {
    "method": "POST",
    "url": "https://api.example.com/v1/search",
    "headers": { "authorization": "Bearer ${key}" },
    "body": { "q": "${query}", "size": "${limit}" }
  },
  "response": {
    "sourcesPath": "data.items",
    "map": { "title": "name", "url": "link", "snippet": "summary" }
  }
}
```

---

## 6. 失败分类与冷却状态机

分类入口 `classifyFailure({status, bodyText, error})`：

| 分类 | 触发条件 | 冷却 |
|---|---|---|
| `quota` | 429 / 402；或响应体匹配 `/quota\|credit\|insufficient\|balance\|exceeded\|rate.?limit\|额度\|余额\|配额\|用尽\|上限/i` | `defaults.cooldown.quota`（1800s），若响应含 `retry_after` 优先用它 |
| `auth` | 401；403 且不含额度关键词；或 `KEY_MISSING` | 86400s |
| `error` | 5xx、网络错误、响应不可解析 | 60s |
| `bad_request` | 400 / 422 | **不冷却**（请求本身的问题） |

行为规则：

1. 冷却中的 provider：记 `skipped`，**不发请求**；
2. 返回空结果：记 `empty`，换下一家，但**不冷却**；
3. 成功：清掉该 provider 的冷却记录，立即返回，不再尝试后面的家；
4. 全部失败/跳过：抛 `SearchError('ALL_FAILED')`，`attempts` 带逐家原因。

状态文件：`$DSH_HOME/websearch-failover-state.json`（`$WEBSEARCH_FAILOVER_STATE` 可覆盖），结构：

```json
{ "providers": { "parallel": { "until": 1792842964168, "reason": "quota", "code": "HTTP_ERROR", "message": "…", "at": "2026-10-24T11:26:04.168Z" } } }
```

写入用「临时文件 + rename」，失败静默忽略（状态是尽力而为，绝不能因此让搜索失败）。

---

## 7. 插件实现要点（容易踩的细节）

1. **配置热读**：按 `fs.statSync(configPath).mtimeMs` 缓存，变了才重新 `loadConfig()`。改 `providers.json` 不用重启。
2. **`available()` 不能抛**：配置缺失/解析失败时返回 `false`（loader 会问它，抛出去会污染装配）。
3. **`truncated` 恒 false**：自己已经截断了，再报 truncated 语义错。
4. **日志**：`$DSH_HOME/websearch-failover/plugin.log`，注册时一行、每次搜索一行（provider + attempts）。排查「到底走了哪家」只看这个文件。
5. **install 的 patch 块**（追加到 `cordis.patch.yml` 末尾，带标记，可幂等重入 / `--uninstall` 干净移除）：

```yaml
# >>> web-search-failover (managed by plugin/install.mjs)
- id: web
  config:
    searchProvider: failover
- insert:
    - id: web-search-failover
      name: '@local/dsh-web-search-failover'
# <<< web-search-failover
```

   `- id: web` 这一行是覆盖 base bundle（`@deepseek-ai/dsh-base/cordis.patch.yml` 里 `- id: web / name: '@deepseek-ai/dsh-web' / config.searchProvider: deepseek-official`）。
6. install 每次写 patch 前落一份 `cordis.patch.yml.bak-websearch-failover-<时间戳>`；`--dry-run` 只打印计划。
7. 包名用 `@local/…` 且 `private: true`，直接拷进 `<profile>/node_modules/@local/dsh-web-search-failover`（参考本机已有的 `@local/dsh-prompt-inject` 的做法；走 `link:` 依赖需要 `pnpm install`，拷贝更省事）。

---

## 8. 当前实测状态（2026-10-24，本机）

| provider | 结果 | 耗时 | 备注 |
|---|---|---|---|
| Tavily | ✅ 可用 | 1.5–3.2s | 优先级 #1，中文结果最好 |
| Exa | ✅ 可用 | 1.9–3.3s | #2 |
| Firecrawl | ✅ 可用 | 1.5–1.7s | #3，最快 |
| Parallel | ❌ HTTP 402 `Insufficient credit in account` | — | key 有效但账户无余额；配置里 `enabled: false` |

真实降级链路验过：把 402 的 parallel 放首位 → 自动落到 tavily，attempts 记 `quota cooldown=1800s`，第二次运行直接跳过它、零请求。

API key 存放：`C:\Users\admin\.dsh\websearch-failover\providers.json`（字面值），并在 `~/.dsh/api-keys.md` 索引里登记。**key 不进工作区、不进 git、不回显。**

---

## 9. 验证与安装

```bash
# 1) 离线测试（不碰网络、不碰运行时）
npm test                        # = 下面三条，全绿才算通过
node test/mock-failover.mjs     # 期望: 6 个 PASS + "all failover invariants hold"
node test/test-plugin.mjs       # 期望: 6 个 PASS + "plugin contract holds"
node test/test-install.mjs      # 期望: 5 个 PASS + "install contract holds"（patch 幂等/卸载/干跑）

# 2) CLI 真连（需要 providers.json 里有可用 key）
node search.mjs --probe
node search.mjs "查询词" --limit 5
node search.mjs --list

# 3) 安装插件（改运行时，先 dry-run）
cd plugin
node install.mjs --dry-run
node install.mjs
cat ~/.dsh/websearch-failover/plugin.log   # 期望: registered search provider "failover"
node install.mjs --uninstall               # 出问题时回滚
```

**验收标准**（装好后）

1. `plugin.log` 出现 `registered search provider "failover"`；
2. 一次原生 `web_search` 之后，`plugin.log` 出现 `search "…" -> tavily (N sources) attempts: …`；
3. 把 `providers.json` 里 tavily 的 `apiKey` 改错 → 下一次搜索自动落到 exa，`plugin.log` 里能看到 `tavily=failed(auth)`；
4. `--uninstall` 后 `web.searchProvider` 回到 `deepseek-official`，DSH 正常。

---

## 10. 已知风险与待决问题

1. **同 id 覆盖是否被加载器接受（未验证，最高风险）**：patch 文件里追加 `- id: web` 与 base bundle 的同 id 行重复。若这一版 loader 拒绝同 id 二次出现，装配会报错。**处置**：先在测试 profile 验证；失败则改用 package.json `dsh.profile.bundles` 方式（把插件做成 bundle 包，参考 `node_modules/@local/dsh-prompt-inject` 的 `dsh.bundle.patch` 字段），或改用配置层 `insert` 一个新 `web` 行并 disable base 的那个。
2. **热重载 vs 重启**：patch 改完是否即时生效未验证。不生效就重启 DSH 一次（会中断当前会话）。
3. **`available()` 与异步凭据**：seam 的可用性检查是同步的，它只能确认「配置存在」，不能确认远程额度；真实额度问题只能在第一次搜索时暴露（退回冷却）。
4. **`web_fetch` 未覆盖**：fetch 是独立注册表（`fetchProviders`），要同样处理需再实现一个 fetch provider；`dsh-web-fetch-http` 是内置的本地抓取实现。
5. **Parallel 402**：需要充值后在 providers.json 里 `enabled` 改回 `true` 并调前优先级；适配器按官方 OpenAPI（`POST /v1/search`，`objective` + `search_queries` + `mode`，响应 `results[].{url,title,publish_date,excerpts[]}`）写的，**成功路径尚未实测**。
6. **Firecrawl 版本**：用的是 `/v1/search`（实测可用）；官方文档已出 v2，迁移时确认响应字段（`data[].{title,description,url}`）。
7. **未做结果融合**：命中即止，不跨家合并/去重排序。若以后要质量优先，可在引擎里加「并行取前两家 + 按 url 去重 + 去重后不足才补第三家」模式。
8. **额度查询**：没有实现「主动查询剩余额度」；目前纯被动（靠 429/402 触发冷却）。若各家有 balance API，可以在 `--list` 里加展示。
9. **错误可见性**：插件路径下，`attempts` 只在 `plugin.log`，模型侧只看到最终错误。若需要模型感知降级，可在 `ALL_FAILED` 的 message 里附带 attempts（现在是带了的），成功路径则刻意保持安静。

---

## 11. 新工作区

**已迁移完成**：`E:\Project-hub\websearch-dsh-plugin`（2026-10-24）。仓库自带 `package.json` 脚本：

```bash
cd /e/Project-hub/websearch-dsh-plugin
npm test              # 引擎 + 插件两套离线测试
npm run probe         # 真 key 体检（读 ~/.dsh/websearch-failover/providers.json）
npm run plugin:dry    # 安装预演
npm run plugin:install
npm run asar:get -- /dsh/package.json
```

若要从旧工作区再同步一次（覆盖式，注意会带上本文件的旧版本）：

```bash
SRC=/d/Documents/deepseek-harness/default-workspace/tools/websearch-failover
DST=/e/Project-hub/websearch-dsh-plugin
cp -r "$SRC"/{lib,plugin,test,search.mjs,providers.example.json,README.md,HANDOVER.md} "$DST"/
cp -r /d/Documents/deepseek-harness/default-workspace/tools/asar-get.cjs "$DST"/tools/
```

建议的后续结构（TypeScript + 构建产物，便于发布和类型声明）：

```
dsh-web-search-failover/
├─ src/
│  ├─ core.ts          引擎（从 lib/core.mjs 迁移，补类型）
│  ├─ adapters/        每家一个文件：tavily.ts / exa.ts / firecrawl.ts / parallel.ts / custom.ts
│  ├─ classify.ts      失败分类 + 冷却策略
│  ├─ config.ts        配置解析与热读
│  ├─ plugin.ts        cordis 插件入口（name / inject / apply）
│  └─ cli.ts           CLI（bin）
├─ test/               node:test 或 vitest；保留现有两个 mock 测试作为回归基线
├─ package.json        name 建议 `dsh-web-search-failover`（去掉 @local，可发布）
└─ README.md
```

`package.json` 关键字段参考本机已有插件（`@local/dsh-prompt-inject`）：

```json
{
  "name": "dsh-web-search-failover",
  "type": "module",
  "main": "lib/index.js",
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.0.5",
    "@deepseek-ai/dsh-web": "0.2.1-rc.2"
  }
}
```

> 说明：运行时并不 `import` 这些包（provider 是纯对象），peer 声明只为类型与版本对齐。**不要把 `@deepseek-ai/*` 打进 bundle**——它们由宿主提供。

迁移时**保留的资产**（不要重写）：错误分类正则与冷却时长、`resolveKey` 的解析顺序、`custom` 适配器的模板/点号路径机制、两个 mock 测试的全部断言。

**建议优先补的**：类型化（`SearchProvider` 接口、`WebSource` 结构）、`attempts` 的结构化返回（现在只有 CLI 用）、单测覆盖 `custom` 的 `${query}/${key}/${limit}` 替换与数组下标路径。

---

## 12. 环境事实（新工作区仍需知道）

| 项 | 值 |
|---|---|
| OS / shell | Windows 11；**命令一律经 Git Bash**：`& 'C:\Program Files\Git\bin\bash.exe' -c '…'; exit $LASTEXITCODE`（裸 `bash` 会命中 WSL 桩，静默失败） |
| Node | v24.15.0（`C:\Program Files\nodejs\node.exe`） |
| DSH 版本 | 0.2.1-rc.2；cordis 4.0.5；`@deepseek-ai/dsh-web` 0.2.1-rc.2 |
| DSH 安装 | `E:\DeepSeekHarness\resources\app.asar`（单文件，非目录）；`DSH_HOME=C:\Users\admin\.dsh`；当前 profile `desktop` |
| 工作区 | 新仓库 `E:\Project-hub\websearch-dsh-plugin`；旧位置 `D:\Documents\deepseek-harness\default-workspace\tools\websearch-failover`（保留不删） |

bash 纪律（踩过的坑）：命令体用单引号包、**bash 命令里不要出现单引号**（PowerShell 单引号不能嵌套，会被截断）；多行脚本先落盘再执行；`/tmp` 在 bash 里映射到 `%TEMP%`，但 node 里 `"/tmp"` 会被解析成 `D:\tmp`，跨工具传路径请用 `cygpath -w`。

---

## 13. 从 `app.asar` 读 DSH 源码（新工作区同样会用到）

asar 是单文件，无法直接 `cd` 进去。本仓库自带工具：`tools/asar-get.cjs`。

```bash
# 列目录
MSYS2_ARG_CONV_EXCL='*' node tools/asar-get.cjs --list /dsh/node_modules/@deepseek-ai/dsh-web/
# 取单个文件
MSYS2_ARG_CONV_EXCL='*' node tools/asar-get.cjs /dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js
# 换别的安装位置
ASAR=E:/other/app.asar node tools/asar-get.cjs /dsh/package.json
```

⚠️ **必须加 `MSYS2_ARG_CONV_EXCL='*'`**：Git Bash 会把 `/dsh/...` 改写成 `C:/Program Files/Git/dsh/...`，不加就报 `not found in asar`。这是实测踩到的坑（2026-10-24）。

脚本原理（要自己重写就照这个）：文件头 16 字节 —— 偏移 12 处是 header 长度，header 是 JSON 树，每个文件节点有 `size` 与 `offset`（相对数据区起点 `16 + headerSize`），按此 `fs.readSync` 取原始字节。

关键包与用途：

- `@deepseek-ai/dsh-web` —— seam 与选择规则（`resolveProvider`，本文件 §1 的引用出处）
- `@deepseek-ai/dsh-tool-web` —— 面向模型的 `web_search` / `web_fetch`（无重试、无降级）
- `@deepseek-ai/dsh-web-search-deepseek`、`@deepseek-ai/dsh-web-deepseek-api` —— 内置两家 provider（`deepseek-official` / `deepseek-search-api`）
- `@deepseek-ai/dsh-base/cordis.patch.yml` —— base bundle，含 `- id: web` 默认 `searchProvider: deepseek-official`
- `@deepseek-ai/cordis-plugin-loader` —— patch/insert 语义（§10 风险 1 的判据来源）

---

## 14. 命令速查

```bash
# 引擎/插件/安装测试
npm test                        # 三条一起跑
node test/mock-failover.mjs
node test/test-plugin.mjs
node test/test-install.mjs

# 真实搜索 / 体检 / 状态
node search.mjs "查询词" --limit 8 [--json] [--force]
node search.mjs --probe [--query "…"]
node search.mjs --list

# 安装 / 回滚
cd plugin && node install.mjs --dry-run
node install.mjs && node install.mjs --uninstall

# 看插件轨迹
type C:\Users\admin\.dsh\websearch-failover\plugin.log
```

---

## 15. 术语

- **seam**：DSH 的可替换能力接口，`ctx.web` 是 web 访问的 seam，内部按 search/fetch 分两个注册表。
- **provider**：seam 的具体实现，插件通过 `registerSearchProvider()` 注册，`id` 即唯一键。
- **bundle / patch 层**：profile 配置由多个 bundle 的 `cordis.patch.yml` 叠加而成，用户层是 `<profile>/cordis.patch.yml`，最后应用，可覆盖前面的行、也可 `insert` 新行。
- **cooldown**：某家失败后的一段时间内不再向它发请求，状态持久化在 `websearch-failover-state.json`。
