# DSH-plugins Code Review 修复文档

- 仓库：`E:\Project-hub\DSH-plugins`
- 日期：2026-10-31
- 依据：codegraph 索引 + 全仓 review（298 测试全过基线，`node --test packages/*/test/*.mjs`）
- 范围：只列需要改动的发现；每条给出文件:行、根因、修法、验收。行号以当前 HEAD 为准，动手前先复核。

---

## P0

### 1. dsh-inventory 写路由缺 CSRF/origin 防护

- **位置**：`packages/dsh-inventory/index.js:1199-1275` 起的全部非 GET 路由（SNAPSHOT 之外的 ASSIGN / GLOBAL / VAULT / SYNC_APPLY / SYNC_CONFIG 等 handler，各 handler 内 `method.toUpperCase() !== 'GET'` 之后的分支，见 827 / 919 / 985 / 1091 行附近）。
- **根因**：这些路由通过 `ctx.webServer.register` 以明文路径暴露，绕过了 `/api` 授权层。同仓库 `dsh-prompt-inject/index.js:116` 与 `dsh-websearch-failover/lib/http.mjs:25` 都实现了 `isForbiddenOrigin` 并在写路由前调用，dsh-inventory 一次都没调用。任意网页可跨站 POST：覆写 sync token、写工作区 `.dsh/mcp.json`、触发真实 `pnpm install`（`sync-apply.js:221`）。
- **修法**：把 `isForbiddenOrigin` 提为共享模块（建议放 `packages/dsh-inventory/lib/http-guard.js`，prompt-inject 后续也切过来），或在 dsh-inventory 内复制同实现；在每个非 GET handler 入口加：

  ```js
  if (isForbiddenOrigin(req)) {
    sendJson(res, 403, { error: 'forbidden-origin' })
    return
  }
  ```

  判定逻辑沿用 prompt-inject 现行实现：`sec-fetch-site: cross-site` 拒绝；有 `Origin` 头但为空/非法拒绝；`Origin` 与 `Host` 不同源拒绝。
- **验收**：新增 `test/http-guard.test.mjs`：cross-site fetch-site 头、恶意 Origin、无 Origin 的 curl（放行）三例；并手动 `curl -X POST` 现有路由确认 403/放行行为符合预期。

## P1

### 2. 远程 manifest 的 name 未校验 → vault 路径穿越

- **位置**：`packages/dsh-inventory/lib/sync-apply.js:255`（`join(vault, entry.name)`，另有 `:253` `join(repoRoot, 'skills', entry.name)` 同样受影响）。
- **根因**：entry 来自远程 manifest，`parseManifest` 只校验 name 是 string；name 含 `..\..\` 或绝对路径时 `cpSync` 可写出 vault / 仓库目录。对照 `assign.js:33` 有 `SKILL_NAME` 白名单，此处漏。
- **修法**：复用 `scan-skills.js` 的 `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`（导出它，别抄第二份），在 `applyItems` 处理 skill entry 前校验，不匹配则记 `results.push({ key, ok: false, error: '非法技能名' })` 并 continue。
- **验收**：`sync-apply.test.mjs` 增加用例：name 为 `../../evil`、`C:\evil`、`a/b` 时跳过且无文件写出。

### 3. probeCapabilities 默认 `gpu: true` 与文档矛盾

- **位置**：`packages/dsh-inventory/lib/sync-diff.js:41`（`const gpu = options.gpu ?? true`）。
- **根因**：调用方漏传 capabilities 时（`sync-service.js:162` 正是默认路径），GPU 依赖技能被报"missing 可安装"而非 blocked，误导用户。
- **修法**：默认改为 `false`（保守：能力未知按不具备处理），并同步修正该函数 docblock 一句。
- **验收**：`sync-diff.test.mjs` 断言 `probeCapabilities()` 返回 `gpu: false`，且对应技能 diff 行为 blocked。

### 4. 超时 MCP mount fiber 永不 dispose

- **位置**：`packages/dsh-inventory/gate.js:200-216`。
- **根因**：`withTimeout` 超时后 resolve `undefined`，返回的 fiber 不进 `mounted` 表；底层 `agent.ctx.plugin(mod, serverConfig)` 若稍后成功，插件存活且 agent 销毁时无人 dispose，每会话慢服务器泄漏一个已挂载 fiber。
- **修法**：`withTimeout` 竞争后仍消费原 promise（`.then(fiber => { if (fiber) mounted.get(agentId)?.push(fiber) })`，注意 agentId 可能已被清理 dispose——push 前判 `mounted.has(agentId)`，否则立即 `fiber?.dispose?.()`）。
- **验收**：`gate.test.mjs` 增加：mount 慢于 mountTimeoutMs 时，dispose 后底层 fiber 的 dispose 被调用。

### 5. writeState 读-改-写无并发保护

- **位置**：`packages/dsh-inventory/lib/sync-state.js:84-91`。
- **根因**：`readState → merge → writeFileSync` 无锁；sync/config POST 与 publish 后的 `writeState({lastPushAt})`（`sync-service.js:125`）并发可互相覆盖，注释声称的"save repo 不丢 token"在并发 handler 下不成立。
- **修法**：最小改动——在 `sync-state.js` 内加模块级 promise 队列（`writeState` 串行化），Node 单进程内即够；不动文件锁。若未来跨进程再换 `proper-lockfile`。
- **验收**：`sync-state.test.mjs` 并发 50 次 `Promise.all(writeState(...))` 写不同字段，断言终态字段齐全。

## P2

### 6. `$DSH_HOME` / home 解析三种写法

- **位置**：`vault.js:24`（`DSH_HOME ?? homedir()`）、`sync-state.js:41-45`（`DSH_HOME ?? HOME ?? USERPROFILE`）、`workspaces.js:60`；`index.js:167` 重复实现 globalSkillRoots。
- **修法**：新建 `lib/dsh-home.js` 导出唯一 `dshHome()`，统一语义 `process.env.DSH_HOME ?? homedir()`；其余三处改 import；`index.js:167` 删除重复实现改调 `workspaces.js` 的版本。
- **验收**：现测试全过 + 新增一例：设 `DSH_HOME` 后三模块解析到同一路径。

### 7. 会话证据目录硬编码 homedir()

- **位置**：`packages/dsh-inventory/index.js:307`。
- **修法**：改用 `dshHome()`（依赖第 6 条的新模块）。

### 8. redactPaths 整串分支吞 URL

- **位置**：`packages/dsh-inventory/lib/redact.js:159-163`。`WHOLE_WIN_PATH`(:133) 允许空格，`C:\x https://y` 整串变 `%LOCAL_ONLY%`。
- **修法**：把 `shieldUrls` 提到 whole 分支判定之前（函数内已有该机制，仅调序）；或 whole 分支正则收紧为不含空白。
- **验收**：`redact.test.mjs` 增例：`C:\x https://example.com/sk-abc123` → 路径脱敏且 URL 内密钥被 REDACTED、URL 本体保留。

### 9. inventory.js 私有 redact 缺口

- **位置**：`packages/dsh-inventory/lib/inventory.js:14`（header 正则要求冒号后空格，`Authorization:Bearer x` 漏）、`:33`（长 token 掩码要求同时含字母数字）。
- **修法**：header 正则冒号后空格改 `:? ?`；掩码条件放宽为"长度 ≥ 阈值即可"。

### 10. match-tools.js MCP 前缀正则排除 `_`

- **位置**：`packages/dsh-inventory/lib/match-tools.js:36`。
- **修法**：前缀字符类加 `_`（与 workspace-gate `SERVER_NAME = [A-Za-z0-9_-]{1,32}` 对齐）。

### 11. git-bash-tool argv 按值匹配 "bash"

- **位置**：`packages/dsh-git-bash-tool/index.js:38-41`。
- **修法**：只重写 `argv[0]`；或保留全量匹配但补注释说明约定（host 的 bash argv 固定 `['bash','-c',cmd]`，命令文本是单元素不会被拆）。

### 12. getSnapshot 并发 refresh 无去重 / readBody 超限悬挂

- **位置**：`packages/dsh-inventory/index.js:556-561`、`:580-593`。
- **修法**：refresh=1 时缓存 in-flight promise，并发请求共享同一重建；readBody 超限 reject 后 `res.destroy()`。readBody 顺手对齐 prompt-inject 的 for-await 写法。

### 13. QUOTA_RE 误伤普通错误文案

- **位置**：`packages/dsh-websearch-failover/.../core.mjs:186`。
- **修法**：从 QUOTA_RE 移除 `次|上限` 两个宽泛词，或要求同时出现 quota/额度类词。

### 14. 死代码清理

- `profile-packages.js:121` `export { existsSync as _exists }` — 删。
- `sync-diff.js:230` `selectableRows` — 删。
- `sync-service.js:214` `readLocalManifest` — 删（其 `:215` 的 `read.error` 判断本身是错的：`readManifestFile` 失败返回 null 而非 `{error}`；删除即消歧）。
- `index.js:1052-1056` `homedir()===null` 死分支 — 删。
- **验收**：删除后全测试套通过，`codegraph callers` 确认无调用方。

---

## 建议执行顺序

1. P0-1（CSRF，一个新模块 + 各 handler 三行）→ P1-2（穿越，白名单复用）
2. P1-4、P1-5（gate 泄漏、writeState 串行化）
3. P2-6 → 7（home 统一，连锁改动一次做完）
4. 其余 P2 与死代码随手清

每完成一批跑 `node --test packages/*/test/*.mjs` 回归；全部完成后 `codegraph sync` 刷新索引。
