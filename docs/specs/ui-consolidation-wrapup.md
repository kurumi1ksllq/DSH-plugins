# spec: UI 整合收尾 + 修 #28 恢复全量 CI

> 停点2 产物。用户 2026-11-03 确认：修到 C 档（P0/P1/P2 全修）、#28 用方案 A（可选导入）、拆两个 PR。

## 背景

工作区里有 17 个**未提交**的文件，是一次已基本完成的 UI 整合：把 `dsh-credential-vault`、
`dsh-websearch-failover`、`dsh-prompt-inject` 三个侧栏面板，并入 `dsh-inventory` 的「工具管理」页。

用户不知道做到哪了，因此先做了两轴审查。结论：**功能主体已完成、可跑、650 个测试全绿**，
但有 3 个必须先修的缺陷与一批遗留清理。本 spec 把这些收尾工作与 #28 的修复一起做完。

## PR 划分

| PR | 内容 | 依据 |
| --- | --- | --- |
| **PR-1** | UI 整合收尾（P0/P1/P2 全修）+ 4 个 tag | 本 spec 第 3、5 节 |
| **PR-2** | 修 #28：`dsh-credential-vault` 对 `dsh-tools` 改成可选导入，CI 恢复全量 | 本 spec 第 4 节 |

PR-2 独立的原因：#28 是既有缺陷，与本批 UI 改动无关；分开后各 PR 的 CI 结果都能被单独解释。

---

## 1. 目标（PR-1）

让本批 UI 整合达到「可提交」：修掉审查发现的真缺陷，清掉迁移后残留的死代码与死引用，
补齐被删掉的测试覆盖，打完 4 个 tag。

## 2. 边界（不做）

- 不改宿主侧业务逻辑（vault 存储、provider 排序、prompt 注入）——只改前端与文档
- 不重新设计 UI，只修正与清理
- 不动 `dsh-git-status`、`dev-flow-skill`
- PR-1 不改 CI workflow（留给 PR-2）

## 3. P0 修复（必须先做）

### 3.1 「留空即保留原值」必须真的成立

**现状**：`CredentialEditor` 更新时 `secret` 初始为 `''` 且允许提交（`client.js:2322/2324`），
但宿主 `lib/api.mjs:57-58` 硬性拒绝空 secret（`secret is required`），
`lib/vault-store.js:82` 也要求非空。→ 编辑已有凭据只点「保存」就 400，
而 CHANGELOG:22 与 README 都宣称支持。

**修法（宿主 + 前端，保守做法）**：
- 宿主 `POST /credential-vault/api/set`：`secret` 缺省或空串时，**仅当该 name 已存在**则保留原秘钥，
  不存在则仍报 400 `invalid-secret`。实现放在 `lib/api.mjs` 的 run 内：先 `store.list()` 判断存在性，
  存在则走新增的 `store.update(name, {kind, username, url, note})`（不碰 secret），否则走 `store.set`。
- `lib/vault-store.js` 新增 `update(name, patch)`：校验 name 存在，只改元数据与 `updatedAt`，
  重封 secret 时用已有值（不重新 seal，除非要求）。
- 前端 `CredentialEditor`：新增模式要求非空；编辑模式允许空，且 hint 文案明说「留空则保留原值」。
- `lib/api.mjs:65` 的 `truncate(error?.message, 200)` 改为按 error code 映射固定文案（见 3.3）。

**验收**：
- 更新且 secret 为空 → 200，秘钥不变，元数据更新
- 新建且 secret 为空 → 400 `invalid-secret`
- 更新不存在的 name 且 secret 为空 → 404 / 400（不能默默新建空秘钥）

### 3.2 取消确认不能触发刷新与清错

**现状**：`remove`/`rotate` 把 `confirm()` 放进了 `run()` 内部（`client.js:2499-2516`），
而 `run()` 先 `setPhase('busy')` + `setFailure('')`，返回后总是 `reload()`。
→ 用户点「取消」也会刷新并抹掉已有错误提示（旧实现不会）。

**修法**：`if (!confirm(...)) return` 提到 `run()` **之前**。

**验收**：点「取消」不产生任何网络请求，`failure` 与 `phase` 保持不变。

### 3.3 错误信息不透传 message

**现状**：`api.mjs:65` 把 `error.message` 透传给前端；`vault-store.js:82` 把用户输入的 name
原样拼进错误（`invalid credential name: ${JSON.stringify(name)}`）。当前不泄露 secret，
但「任何路由不返回明文」的保证靠的是「错误恰好不含 secret」——设计脆弱点。

**修法**：`lib/api.mjs` 的 catch 改为按 error code / 已知错误类型映射**固定文案**，
不再透传 `error.message`；未知错误统一 `internal-error`。

**验收**：构造一个故意含 secret 的 store 抛错，路由响应体不含该串。

## 4. P1 清理（PR-1）

### 4.1 删除迁移后残留的死 UI

| 包 | 残留 | 约行数 |
| --- | --- | --- |
| credential-vault/client.js | `SIDEBAR_SLOT/MAIN_SLOT/SIDEBAR_ORDER`、`Icon`、`Page`（含 `KINDS/PK_*`/`STYLE`） | ~250 |
| prompt-inject/client.js | `Icon`、`Page` | ~140 |
| websearch-failover/plugin/client.js | `SIDEBAR_SLOT/MAIN_SLOT/SIDEBAR_ORDER`、`Icon`、`Page` | ~470 |

同时 `credential-vault/client.js:527` 的 `inject` 收缩为 `['locale']`（与另外两个对齐）。

> 注意：websearch 的 `Page` 被 `__providersPage` 导出给测试用，删除时同步改测试或一并删该导出。

### 4.2 补齐被删掉的测试覆盖

- websearch：「返回对话」冒烟断言（`back` → `selectedPanel === null`）被删，而 `Page` 仍在用 `back`。
  若按 4.1 删掉 `Page`，则连同该断言与 `ledger.selectedPanel` 一起删；若不删 `Page`，则恢复该断言。
- prompt-inject：恢复「回车只换行不提交」「空文本本地拦截」「保存中按钮禁用」三条编辑器行为断言——
  在 inventory 的 `PromptInjector` 上补，而不是留在旧组件。

### 4.3 文档与 locale 死引用

- `packages/dsh-prompt-inject/VERIFICATION.md`：删「注册 `sidebar.panellist` / `main`」的描述
- `packages/dsh-prompt-inject/docs/reports/review-prompt-editor.md`：相关 PASS 结论加「已过时」标注
- `packages/dsh-prompt-inject/locale/{zh,en}.json`：描述改为「在工具管理页编辑」
- `packages/dsh-websearch-failover/plugin/package.json` 的 `description` 去掉 sidebar 说法
- `packages/dsh-credential-vault/README.md` 与 `locale/*.json` 同步

### 4.4 声明 inventory → 三个 bundle 的隐式依赖

`dsh-inventory` 的凭据/搜索/提示词分区硬编码了另外三个 bundle 的路由前缀。
在 `dsh-inventory/README.md` 明确声明「本面板需要 profile 同时启用这三个 bundle」，
并在 `scripts/check-profile.mjs` 加一条**告警**（不是错误）当 inventory 在而它们不在。

## 5. 其它（PR-1）

### 5.1 dead 字典键

删掉本次新增但无引用的键：`closePreview`、`openStandalone`、`promptConfirm`、
`credentialCount`、`providerCount`、`syncDismiss`、`syncPreviewClean`、`providerUnit*`（zh/en 各一份）。

### 5.2 CHANGELOG 与版本

inventory 0.3.0 → 0.4.1 是 patch，但本次是功能性变更：改为 **0.5.0**，CHANGELOG 段落同步。
（其余三个包已是 minor bump，保持不动。）

### 5.3 打 tag

现存 tag 规范：`<pkg>@<version>`。PR-1 合并后需有：
`dsh-credential-vault@0.2.0`、`dsh-inventory@0.5.0`、`@local/dsh-prompt-inject@0.2.0`、
`dsh-websearch-failover@0.3.0`。

> tag 打在**合并后的 main** 上；若打 tag 导致 `check-bundle-versions` 需要重新验证，在 PR-1 合并后单独执行。

## 6. PR-2：修 #28

**现状**：`dsh-credential-vault/index.js:15` 硬 import `@deepseek-ai/dsh-tools`，
而 `package.json` 无任何声明；本机靠 `node_modules/@deepseek-ai/dsh-tools` 这个手工软链接
指向 DSH 运行时才能跑，CI 的干净 runner 没有它。

**为何不用 dependencies**：npm 上 `@deepseek-ai/dsh-tools` 公开版本是 `0.0.1-rc.1`，
本地运行时是 `0.2.1-rc.5`，版本不匹配，`pnpm install` 会拉到旧版甚至失败。

**修法（方案 A：可选导入）**：
- `index.js` 不再顶层硬 import；改为在 `apply()` 里惰性解析，解析失败时用一个本地最小实现
  （只保留本包用到的 `defineTool` 行为：返回 `{ name, description, parameters, output, execute }`）。
- 抽取成 `lib/define-tool.js`：`resolveDefineTool()` → 优先真实包，否则本地兼容实现。
- CI workflow 恢复为 `pnpm verify` + `pnpm test` 全量。

**验收**：
- 在没有 `@deepseek-ai/dsh-tools` 的环境下，`node --test packages/dsh-credential-vault/test/*.test.mjs` 全绿
  （用 `NODE_PATH` 清空或临时重命名软链接验证）
- CI 跑全量后为绿
- `credential` 工具在真实运行时仍用真实 `defineTool`（惰性路径不改变运行时行为）

## 7. 验收标准汇总

1. 编辑已有凭据留空 secret → 成功且秘钥不变；新建留空 → 400
2. 取消删除/轮换 → 零网络请求，不变状态
3. 错误响应体不含任何明文 secret
4. 三个包的死 UI 代码已删，`inject` 均为 `['locale']`
5. 被删的测试行为在有新家后仍被覆盖
6. 文档与 locale 无「侧栏面板」死引用
7. 全量测试通过；`pnpm verify` 全绿
8. PR-2 后 CI 全量绿

## 8. 风险

| 风险 | 缓解 |
| --- | --- |
| 删 `Page` 可能连带删掉仍被引用的东西 | 删前全仓 grep 每个符号；测试兜底 |
| 改 `/set` 语义可能破坏现有调用方 | 仅前端在用；空 secret 新建仍 400 |
| 可选导入两套实现可能分叉 | 本地实现只在无包时生效，并有测试断言工具形状一致 |
| inventory 改 0.5.0 影响 tag 纪律 | CHANGELOG 同段落同步，verify 验证 |
