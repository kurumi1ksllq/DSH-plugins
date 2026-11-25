# issue #245 #246 #247 — websearch 状态透传三修

分支 `issue-245-247-websearch-status`(基于 main),包 `dsh-websearch-failover` 0.6.1 → 0.6.2,`dsh-inventory` 0.14.2 → 0.14.3(仅渲染侧两处)。

## 目标

- **#245 `truncated` 被硬编码**:`lib/core.mjs:544` 算出的 `truncated` 在 `index.js:339` 被写成常量 `false`,`web_search` 的调用方永远看不到「结果被提供方截断」。改为真值透传。
- **#246 余额探测超时**:`lib/balance.mjs:240` 写死 8000ms,`index.js:243` 没传 `timeoutMs`(搜索默认 15000),超时又被归一成 `status: 'error'`,面板只显示「未知」。改为与搜索同源的 `defaults.timeoutMs`,超时独立成 `status: 'timeout'` 并保留 `detail`,渲染侧显示 `detail`、不把 timeout 画成 cooldown。
- **#247 关键词先于状态码**:`lib/core.mjs:148-156` 先看正文关键词再看 400/422,导致 `400 size exceeded` 被判 quota(冷却 1800s)、`400 api key …` 被判 auth(86400s)。改为 429/402/401/403 之外的 4xx 一律 `bad_request`、不写冷却。

## 边界

- 只改 `dsh-websearch-failover`(core/index/balance/README/HANDOVER/package.json)与 `dsh-inventory` 的 `client/80-websearch.js` + 重建产物 `client.js`;`dsh-inventory` 其它行为不动。
- 429/402/401/403 的判定与冷却秒数**不变**;5xx / 传输错误 / `KEY_MISSING` 行为不变。
- 请求上限仍然夹在 50(`core.mjs:495`),摘要仍然裁到 600 字(`core.mjs:normalize`)——本轮不改这两个既有规则。
- 宿主 `WebSearchResult` 协议只有 `sources` / `truncated`(见宿主 `dsh-web/types.ts:50-57`),没有 `notes` 字段,所以「limit 被夹紧」的说明落在 `plugin.log`(`limit clamped 100 -> 50`),不新增一个没人读的字段。
- 不 push、不开 PR、不合并、不动宿主进程、不碰其它包。

## 验收

- `cd packages/dsh-websearch-failover && node --test test/*.mjs` 全绿;`cd packages/dsh-inventory && node --test test/*.test.mjs` 全绿。
- 新增/改写的断言(反向验证:去掉修复即红):
  - requested 100 / 提供方回 62 行 → `sources.length === 50` 且 `truncated === true`;回 3 行 → `truncated === false`;`plugin.log` 含 `limit clamped 100 -> 50`。
  - 上限 60ms + 余额端点不响应 → `balance.status === 'timeout'`、`balance.detail` 含 timeout、耗时 < 2000ms(去掉 `timeoutMs` 实测等满 8003ms)。
  - 400「size exceeded」/ 400「api key …」/ 422「exceeded」→ 该家 `cooldown.active === false`;429 / 401 → 仍冷却且 reason 为 quota / auth。
  - dsh-inventory:`status: 'timeout'` + `detail` 的提供方在面板上显示原因,状态点文案为「未知」而非「冷却」。
- 仓库根 `node --test test/docs-contract.test.mjs` 绿(CHANGELOG 条目数 85、Unreleased 段版本条目齐全)。

## 变更点

| 文件 | 改动 |
| --- | --- |
| `lib/core.mjs` `classifyFailure` | 新增「429/402/401/403 之外的 4xx → `bad_request`」分支,置于关键词判定之前 |
| `lib/core.mjs` `search()` 返回值 | 增加 `limit: want`(夹紧后的实际上限,供日志使用) |
| `index.js` `search()` | `truncated: result.truncated === true`;日志加 `truncated` 与 `limit clamped` 标注 |
| `index.js` `doRefresh` | 探测传 `timeoutMs: probeTimeoutMs()`(读 `defaults.timeoutMs`,配置不可读时交给 balance.mjs 兜底) |
| `lib/balance.mjs` | 计时器置 `timedOut` 标志,超时返回 `status: 'timeout'`(其它异常仍是 `error`) |
| `dsh-inventory/client/80-websearch.js` | `providerBalanceText` 在 `error`/`timeout` 且带 `detail` 时追加原因;重建 `client.js` |
| `test/test-host-plugin.mjs` | 原有 maxResults 用例改断言真值 + 新增 #245/#246/#247 六条用例 |
| `dsh-inventory/test/client.test.mjs` | 新增 timeout 渲染用例;`bootProviders` 每次新模块实例(否则第二次 boot 命中 ESM 缓存) |
| `package.json` ×2、根 `CHANGELOG.md` | 版本 0.6.2 / 0.14.3;两条 Unreleased 条目;条目计数 83 → 85、缺 tag 7 → 9 |
