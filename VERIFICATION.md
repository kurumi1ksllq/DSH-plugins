# 验证报告 — @local/dsh-prompt-inject

- 任务：task-1（构建并安装提示词注入插件）
- 工作区：`E:\Project-hub\dsh-reverse-plugin`
- 插件包：`E:\Project-hub\dsh-reverse-plugin\prompt-inject`
- Profile：`desktop`（`C:\Users\admin\.dsh\profiles\desktop`，由 `plugin_manager` 写入，未手工修改）
- 时间：2026-10-23（Asia/Shanghai）

## 1. 文件清单

| 文件 | 用途 |
| --- | --- |
| `prompt-inject/package.json` | 包声明：name `@local/dsh-prompt-inject`、version 0.1.0、private、type module、`exports`（`.` / `./locale/*.json` / `./icon`）、`dsh.bundle.patch: ./cordis.patch.yml`、files 覆盖运行文件与资源 |
| `prompt-inject/cordis.patch.yml` | bundle patch 层：单条 `insert`，`id: prompt-inject`、`name: "@local/dsh-prompt-inject"`，无 config 覆盖 |
| `prompt-inject/index.js` | Cordis 插件入口：`export const inject = ['systemPrompt']`；`apply(ctx, config)` 调 `ctx.systemPrompt.section({ name, order, text, interpolate: false })`；默认 name `demo:prompt-inject`、order 3500、文案含令牌 |
| `prompt-inject/locale/en.json` | 英文 `meta.title` / `meta.description`（真实插件描述） |
| `prompt-inject/locale/zh.json` | 中文 `meta.title` / `meta.description`（真实插件描述） |
| `prompt-inject/icon.svg` | 64×64 原创几何图标（命名空间外无任何外部 URL） |
| `prompt-inject/README.md` | 注入内容、section 名称/order、config 可覆盖字段、安装/关闭方式、安全说明 |
| `prompt-inject/test/plugin.test.mjs` | 包契约测试（清单、locale、patch 结构、图标、注入行为、config 覆盖与回退），开发期用，不属运行时资源 |
| `prompt-inject/VERIFICATION.md` | 本报告 |

## 2. 静态检查证据

### 2.1 JS 语法

```text
> node --check .\prompt-inject\index.js
node --check index.js: OK
```

### 2.2 JSON 解析（3 个文件）

```text
> node -e "...JSON.parse... "
JSON OK: package.json -> name,version,private,description,type,icon,main,exports,files,dsh,engines,keywords,license
JSON OK: locale/en.json -> meta
JSON OK: locale/zh.json -> meta
```

### 2.3 patch YAML 结构解析

`node` 脚本剥离注释/空行后校验缩进（0/4/6，无 tab）并重建结构：

```text
YAML parse OK -> [{"insert":[{"id":"prompt-inject","name":"@local/dsh-prompt-inject"}]}]
```

### 2.4 契约测试（红 → 绿）

红（首次运行，6 通过 / 2 失败）：

```text
✔ package manifest is a valid DSH bundle
✔ locale files carry real plugin metadata
✔ bundle patch is a single insert row for the plugin
✖ icon is a self-contained 64x64 SVG          # 测试正则误报 xmlns 命名空间
✔ exports the systemPrompt dependency and registers one literal section
✖ defaults apply when config is omitted, empty or null
    Actual message: "Cannot read properties of null (reading 'name')"   # 真实缺口
✔ config overrides name, order and text; invalid values fall back
✔ injected text keeps literal placeholders untouched
tests 8 / pass 6 / fail 2
```

修复：`apply()` 内规范化 `config`（非对象按 `{}` 处理）；图标测试排除 `xmlns` 命名空间后校验外部 URL。

绿（最终）：

```text
✔ package manifest is a valid DSH bundle
✔ locale files carry real plugin metadata
✔ bundle patch is a single insert row for the plugin
✔ icon is a self-contained 64x64 SVG
✔ exports the systemPrompt dependency and registers one literal section
✔ defaults apply when config is omitted, empty or null
✔ config overrides name, order and text; invalid values fall back
✔ injected text keeps literal placeholders untouched
tests 8 / pass 8 / fail 0
```

## 3. 安装证据

`plugin_manager` → `install_bundle`，target = `E:\Project-hub\dsh-reverse-plugin\prompt-inject`，返回原文关键字段：

```json
{
  "stage": "enable",
  "target": "@local/dsh-prompt-inject",
  "enabled": true,
  "changed": true,
  "application": "applied",
  "registries": [null],
  "packageResult": { "exitCode": 0, "truncated": false },
  "bundle": "@local/dsh-prompt-inject",
  "version": "0.1.0",
  "warnings": []
}
```

pnpm 输出（节选）：

```text
✓ Lockfile passes supply-chain policies (verified 1h ago)
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.
dependencies:
+ @local/dsh-prompt-inject 0.1.0 <- E:\Project-hub\dsh-reverse-plugin\prompt-inject
Done in 2.3s using pnpm v11.28.5
```

说明：`[WARN] Issues with peer dependencies` 来自 pnpm 全局 peer 检查，不是本包装备问题；`warnings: []`，无 restart-required / failed。

## 4. 运行时行状态证据

`plugin_manager` → `list_plugins`（offset 200，total 213）关键行原文：

```json
{
  "entryId": "include:prompt-inject",
  "moduleName": "@local/dsh-prompt-inject",
  "enabled": true,
  "fiberPhase": "active",
  "patchId": "prompt-inject"
}
```

### 附带：已安装产物可解析并正确注册

在 profile 目录下 `import('@local/dsh-prompt-inject')`：

```text
resolved exports: DEFAULT_ORDER,DEFAULT_SECTION_NAME,DEFAULT_TEXT,DEFAULT_TOKEN,apply,inject
inject: ["systemPrompt"]
registered: {"name":"demo:prompt-inject","order":3500,"interpolate":false,"hasToken":true}
```

## 5. 子代理运行时验证（验收核心）

安装成功后，启动全新 `subagent`（无工作区文件读取、无工具调用），提示词要求仅依据自身系统提示词回答"注入令牌是什么"，找不到回 MISSING，找到则逐字输出令牌。

- 子代理 id：`cfb5896c-a754-400d-9e43-b882754c7810`
- 关闭消息原文：

```text
DSH-INJECT-7F3A-2026
```

结果与注入文案中的令牌完全一致，证明宿主侧系统提示词注入端到端生效。

## 6. 警告与失败

- 成功：安装 `application: applied`，`warnings: []`，运行时行 `enabled: true` / `fiberPhase: active`。
- 开发期红测暴露并修复一处真实缺口：`config` 为 `null` 时 `apply()` 抛 `TypeError`，已改为按默认值处理并有测试覆盖。
- 一次测试误报：图标测试把 SVG 的 `xmlns` 命名空间当作外部资源，已修正断言。
- pnpm 的 peer dependency 提示为环境级提示，未影响安装与加载；未做任何 profile 手工修改，未卸载/禁用其他插件。

---

# 追加验证 — task-3：侧边栏按钮与提示词编辑面板

时间：2026-10-23（Asia/Shanghai）。本轮把 Host-only 注入插件扩展为「Host 动态段落 + HTTP 状态路由 + Client 侧边栏编辑面板」。

## 7. 本轮改动文件

| 文件 | 改动 |
| --- | --- |
| `index.js` | `inject` 改为 `['systemPrompt','webServer']`；section `text` 改为 getter `() => currentText`；新增 `GET/POST /prompt-inject/state`（Origin/Host 与 `sec-fetch-site` 校验、256 KiB 体积上限、空文本/超长拒绝、原子写盘、写盘失败不改内存、`emit('system-prompt/change')`）；状态文件按 `DSH_PROFILE_DIR` → `DSH_HOME` → `~/.dsh` 顺序定位 |
| `client.js`（新增） | `window.__ModuleLoader__.load({ id:'@local/dsh-prompt-inject' })`；`slots` 注册 `sidebar.panellist`（id `prompt-inject`）与 `main`（key `prompt-inject`）；`locale` 注册 zh/en 字典；面板含回填、受控 textarea、确定/保存中/成功/错误提示、返回对话；只 require `react`，只用主题 token |
| `package.json` | 新增 `exports['./client']`、`files` 加入 `client.js`、`dsh.client = { platform:'web', immediately:true, inject:[layout, sidebar, locale] }`；保留 bundle patch |
| `locale/en.json`、`locale/zh.json` | 描述更新为“可编辑 + 侧边栏面板” |
| `README.md` | 新增编辑器、HTTP 契约、持久化、安全与生效说明 |
| `test/plugin.test.mjs` | 24 项纯 Node 契约测试（fake ctx + fake req/res + `node:vm` 执行 client.js） |
| `VERIFICATION.md` | 本节 |

## 8. 静态检查与测试

```text
> node --check .\prompt-inject\index.js
index.js syntax OK
> node --check .\prompt-inject\client.js
client.js syntax OK

> node --test .\prompt-inject\test\plugin.test.mjs
✔ package manifest is a valid DSH bundle and client package
✔ locale files carry real plugin metadata
✔ bundle patch is a single insert row for the plugin
✔ icon is a self-contained 64x64 SVG
✔ exports the host services and registers one dynamic section
✔ registers the exact HTTP state route through ctx.effect
✔ defaults apply when config is omitted, empty or null
✔ config overrides name, order and text; invalid values fall back
✔ injected text keeps literal placeholders untouched
✔ GET returns the default state when nothing is stored
✔ POST persists the text, updates the live section and emits the change event
✔ POST rejects empty, non-string and oversized text with 400
✔ POST rejects cross-origin requests with 403
✔ POST accepts a same-origin request
✔ POST rejects malformed JSON with 400
✔ unsupported methods return 405
✔ oversized request bodies are rejected without touching memory
✔ corrupt or invalid state files fall back to the default text
✔ a state file with a valid text is loaded at startup
✔ write failures return 500 and leave memory unchanged
✔ falls back to DSH_HOME when DSH_PROFILE_DIR is absent
✔ client.js is a ModuleLoader module that only requires react
✔ client registers sidebar button and main panel with matching ids
✔ client registers zh/en dictionaries and back button clears the panel

tests 24 / pass 24 / fail 0
```

红/绿记录：本轮先写 24 项测试，对旧实现运行得到红色（`client.js` 不存在、`inject` 缺 `webServer`、无路由），实现后经两处测试自身修正（`bootHost` 暴露 `route`、跨 vm realm 数组比较）达到 24/24 绿。

## 9. 安装返回（重新安装）

`install_bundle` 对已安装包直接返回 `{"application":"failed","error":{"code":"already-installed"}}`。为取得真实安装结果，先用 `plugin_manager remove_bundle` 移除本插件（**仅本插件**，`application: applied`、`warnings: []`、`exitCode: 0`），再重新 `install_bundle`：

```json
{
  "stage": "enable",
  "target": "@local/dsh-prompt-inject",
  "enabled": true,
  "changed": true,
  "application": "applied",
  "registries": [null],
  "packageResult": { "exitCode": 0, "truncated": false },
  "bundle": "@local/dsh-prompt-inject",
  "version": "0.1.0",
  "warnings": []
}
```

- 无 `restart-required` 字段，无 error。
- pnpm 输出仍有一条环境级 `[WARN] Issues with peer dependencies found`，与本包无关。
- 未手工修改 profile 的 `package.json` / `cordis.patch.yml` / `node_modules`。

## 10. 运行时行状态

安装后 `list_plugins`（offset 200，total 213）：

```json
{
  "entryId": "include:prompt-inject",
  "moduleName": "@local/dsh-prompt-inject",
  "enabled": true,
  "fiberPhase": "active",
  "patchId": "prompt-inject"
}
```

## 11. 真实 HTTP 路由验证（Host 已热加载，无需重启）

重新安装后探测 `GET http://127.0.0.1:22327/prompt-inject/state`：安装前为 **404**（旧 Host 模块），重新安装后为 **200**，说明新 Host 半区已被运行时加载，**HOST 无需重启**。

```text
BEFORE: updatedAt=0 length=925
POST new: length=62 updatedAt=1792697297844 textMatch=True
GET after POST: textMatch=True updatedAt=1792697297844
CROSS-ORIGIN: status=403 body={"error":"forbidden-origin"}
EMPTY TEXT: status=400 body={"error":"invalid-text"}
DELETE: status=405 body={"error":"method-not-allowed"}
RESTORE: textMatch=True updatedAt=1792697297870
FINAL: textMatch=True updatedAt=1792697297870
```

- POST 使用同源 `Origin: http://127.0.0.1:22327`，写入临时探测文本后 GET 能读回；随后已用原文本恢复，最终 GET 与原文本逐字一致。
- `Origin: https://evil.example` 被 403 拒绝；空文本 400；DELETE 405。
- 持久化文件实际落在 `$DSH_HOME` 回退路径：`C:\Users\admin\.dsh\prompt-inject\state.json`（1122 bytes，`updatedAt=1792697297870`，`textLength=925`，即恢复后的原文）。运行进程未设置 `DSH_PROFILE_DIR`，因此走了第 2 条规则，符合契约。

## 12. 限制与未验证项

- **页面视觉/点击未验证**：本会话没有浏览器控制工具，无法点击侧边栏按钮或观察面板渲染。Client 半区需要用户**刷新页面**（或重启 DSH Web）后才会加载；届时左侧边栏应出现「提示词注入」按钮，点击进入编辑面板。
- 面板的加载/保存状态、主题 token 表现、返回按钮行为仅由 `node:vm` 契约测试覆盖，未做真实浏览器验收。
- 未验证 Client 包在 Web 端的实际模块解析；`dsh.client.inject` 三项按任务卡给定值填写。

