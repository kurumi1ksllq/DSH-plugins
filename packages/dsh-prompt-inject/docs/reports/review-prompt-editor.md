# 独立复核报告 — 侧边栏提示词编辑器（task-4）

- 复核者：`reviewer2`（独立复核，不采信 builder 自述）
- 任务卡：`task-4`（原 owner `reviewer` 未完成，Lead 转交 `reviewer2`）
- 工作区：`E:\Project-hub\dsh-reverse-plugin`
- 复核对象：`prompt-inject/`（commit `ee1aa58`）
- 时间：2026-10-23（Asia/Shanghai）
- 权限边界：本复核**只写**本文件；未修改 `prompt-inject/`、未改 profile、未安装/卸载/启停插件、未重启 DSH、未做 POST 写入。

## 0. 结论

**ACCEPT**（有条件：Client 半区 UI 需重启 DSH 后才会注册，见 §6 已知限制）。

- 24/24 契约测试独立复跑通过，退出码 0。
- Host 路由 `GET /prompt-inject/state` 实测 **200**，返回文本 925 字符，持久化文件与响应逐项一致。
- 运行时行 `include:prompt-inject` 为 `enabled: true` / `fiberPhase: "active"`；profile 依赖为 `link:` 指向本仓库。
- 最新 commit `ee1aa58` 已推送，远端 `refs/heads/main` 与本地 HEAD 完全一致。
- 未发现阻断性缺陷；发现 2 项**非阻断**观察（§7）。

## 1. 复核方法与执行环境

所有结论均来自本会话自行执行的命令/文件原文，未引用 builder 的输出作为证据。

| 步骤 | 命令/动作 | 退出码 |
| --- | --- | --- |
| 语法检查 | `node --check prompt-inject/index.js` | 0 |
| 语法检查 | `node --check prompt-inject/client.js` | 0 |
| 契约测试 | `node --test prompt-inject/test/plugin.test.mjs` | 0 |
| 路由探测 | `Invoke-WebRequest http://127.0.0.1:22327/prompt-inject/state`（仅 GET） | — |
| 安装状态 | `plugin_manager` → `list_plugins`（offset 195, limit 25, total 213） | — |
| 仓库状态 | `git -C prompt-inject log/status/ls-remote/rev-parse` | 0 |
| 端口暴露面 | `Get-NetTCPConnection -LocalPort 22327 -State Listen` | — |

## 2. 逐项 PASS/FAIL 表

| # | 检查项 | 结果 | 证据（原文/位置） |
| --- | --- | --- | --- |
| 1 | `node --check index.js` | **PASS** | `exit=0` |
| 2 | `node --check client.js` | **PASS** | `exit=0` |
| 3 | 契约测试 24/24 | **PASS** | `ℹ tests 24 / ℹ pass 24 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0`，`exit=0` |
| 4 | `exports['./client']` 存在 | **PASS** | `"./client": "./client.js"`（package.json L11） |
| 5 | `files` 含 `client.js` | **PASS** | `"files": ["index.js","client.js","cordis.patch.yml","locale/*.json","icon.svg","README.md"]`（L15-22） |
| 6 | `dsh.client.platform = "web"` / `immediately: true` / inject 三项 | **PASS** | package.json L28-36：`platform: "web"`、`immediately: true`、`inject: [ui-layout, ui-sidebar, locale]` |
| 7 | Host `inject` 含 `systemPrompt` + `webServer` | **PASS** | index.js L265：`export const inject = ['systemPrompt', 'webServer']` |
| 8 | section `text` 是函数（getter） | **PASS** | index.js L197：`text: () => currentText` |
| 9 | section `interpolate: false` | **PASS** | index.js L198：`interpolate: false` |
| 10 | 路由契约（`exact` + `/prompt-inject/state` + effect 作用域） | **PASS** | index.js L203-206：`ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: STATE_ROUTE, handler: async (req, res) => {` |
| 11 | Origin/Host 校验 | **PASS** | index.js L116-137；测试 `POST rejects cross-origin requests with 403` 通过 |
| 12 | `sec-fetch-site: cross-site` 拒绝 | **PASS** | index.js L119-122：`if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') return true` |
| 13 | 256 KiB 请求体上限 | **PASS** | index.js L34：`MAX_BODY_BYTES = 256 * 1024`；L144-152 流式累计并在超限抛 `payload-too-large` → 413 |
| 14 | 空文本/非字符串/超长文本拒绝（400） | **PASS** | index.js L237-241：`typeof text !== 'string' \|\| text.length === 0 \|\| text.length > MAX_TEXT_LENGTH` → `400 invalid-text` |
| 15 | 写失败不改内存（先落盘后提交内存） | **PASS** | index.js L243-255：`persistState` 成功后才 `currentText = text`；测试 `write failures return 500 and leave memory unchanged` 通过 |
| 16 | 损坏/非法状态文件回退默认 | **PASS** | index.js L75-91（JSON 解析失败、非对象、非字符串、空串、超长 → `null`）；测试 `corrupt or invalid state files fall back to the default text` 通过 |
| 17 | 原子写（临时文件 + rename） | **PASS** | index.js L93-99：`tempFile = \`${file}.${process.pid}.${Date.now()}.tmp\`` → `renameSync(tempFile, file)` |
| 18 | 持久化路径优先级 `DSH_PROFILE_DIR → DSH_HOME → ~/.dsh` | **PASS** | index.js L64-72；实测运行进程未设 `DSH_PROFILE_DIR`，落盘于 `C:\Users\admin\.dsh\prompt-inject\state.json`（第 2 条规则） |
| 19 | 未支持方法 405 + `allow` 头 | **PASS** | index.js L210-212；测试 `unsupported methods return 405` 通过 |
| 20 | 客户端 `window.__ModuleLoader__.load` 且 id = 包名 | **PASS** | client.js L12-13：`window.__ModuleLoader__.load({ id: '@local/dsh-prompt-inject', factory(require) {` |
| 21 | 只 `require('react')`，无 Harness import | **PASS** | grep 结果：`import` 语句 0 处；`require('react')` 唯一；`@deepseek-ai/dsh-client` 引用 0 处 |
| 22 | 无 `innerHTML` / `dangerouslySetInnerHTML` / `eval` / `new Function` | **PASS** | grep 命中数 **0** |
| 23 | textarea 只用 `value` 受控渲染（无 XSS 面） | **PASS** | client.js L293-301：`value: text`，`onChange: onChange`，无子节点；所有提示文本走 `t(...)` 文本节点 |
| 24 | sidebar id 与 main key 都是 `prompt-inject` | **PASS** | client.js L334-335 `id: 'prompt-inject'`；L350-351 `key: 'prompt-inject'`；测试 `client registers sidebar button and main panel with matching ids` 通过 |
| 25 | locale 为扁平 `'error.load'` 等 key（zh/en 各一份） | **PASS** | client.js L31-33 / L47-49；测试断言 `dict.error === undefined` 且 `error.load/save/empty` 存在并通过 |
| 26 | 主题 token（无硬编码色值） | **PASS（部分）** | client.js 中 `var(--dsw-*)` 18 处、11 个唯一 token，均带回退值；仅 1 个非 `--dsw` 变量 `var(--dsh-font-family-code, ui-monospace, …)`。token 名称真实性见 §7 观察 O2 |
| 27 | 返回对话按钮 | **PASS** | client.js L317 按钮 `onClick: onBack` → L267-269 `ctx.layout.selectPanel(null)`；测试断言 `layoutCalls === [null]` |
| 28 | 页面含「确定」按钮 + 保存中禁用 | **PASS** | client.js L303-315：`disabled: disabled`，文案 `status === 'saving' ? t('saving') : t('confirm')` |
| 29 | 空文本前端拦截（不发请求） | **PASS** | client.js L230-234：`if (value.trim().length === 0) { setStatus('empty'); return }` |
| 30 | **live** `GET /prompt-inject/state` | **PASS** | `status=200`，`content-type: application/json; charset=utf-8`，`cache-control: no-store`，`textLength=925`，`updatedAt=1792697867119`，`hasToken=True` |
| 31 | 持久化文件与 live 响应一致 | **PASS** | 文件 `C:\Users\admin\.dsh\prompt-inject\state.json` bytes=1122 / textLength=925 / updatedAt=1792697867119，与 GET 返回值逐项相同 |
| 32 | profile `package.json` 仍为 link 依赖 | **PASS** | `@local/dsh-prompt-inject = link:E:/Project-hub/dsh-reverse-plugin/prompt-inject`（依赖总数 4） |
| 33 | 运行时行 enabled/active | **PASS** | `{"entryId":"include:prompt-inject","moduleName":"@local/dsh-prompt-inject","enabled":true,"fiberPhase":"active","patchId":"prompt-inject"}` |
| 34 | 最新 commit 已推送 | **PASS** | 本地 `rev-parse HEAD` = `ee1aa5810e3d30cc81fbee4d8d2b5a6fc7936946`；`ls-remote origin refs/heads/main` 同值 |
| 35 | 工作树干净 | **PASS** | `git -C prompt-inject status -sb` → `## main...origin/main`（无改动行） |
| 36 | 路由仅 loopback 暴露 | **PASS** | `Get-NetTCPConnection -LocalPort 22327 -State Listen` → `LocalAddress 127.0.0.1`、`State Listen` |

**FAIL 项：0。**

## 3. 命令证据原文

### 3.1 语法检查与测试

```text
=== node --check index.js ===
exit=0
=== node --check client.js ===
exit=0
=== node --test ===
✔ client.js is a ModuleLoader module that only requires react (1.5672ms)
✔ client registers sidebar button and main panel with matching ids (1.3403ms)
✔ client registers zh/en dictionaries and back button clears the panel (1.2132ms)
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 201.0365
exit=0
```

**复跑确认（green gate，同一文件哈希条件下第二次运行）**

```text
client.js  mtime=2026-10-23T03:40:24 sha256=A49F625DCD9B586D
index.js   mtime=2026-10-23T03:26:32 sha256=46F72E37102A9081
package.json mtime=2026-10-23T03:26:55 sha256=450D845C24E70793
test file  mtime=2026-10-23T03:40:24
git status -sb -> ## main...origin/main   (clean)
git log -1     -> ee1aa58 fix: flatten client locale keys

=== node --check index.js === exit=0
=== node --check client.js  === exit=0
=== node --test ===
ℹ tests 24 / ℹ pass 24 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0
ℹ duration_ms 163.0592
exit=0
```

说明：实现文件 mtime（03:26–03:40）早于首次复核运行时间（03:48），且工作树在 `ee1aa58` 上干净、无未提交改动，因此两次运行之间**没有实现变更**；第二次运行独立确认 24/24 通过，结论不变。

### 3.2 HTTP 探测（仅 GET，未做 POST）

```text
=== GET /prompt-inject/state ===
status=200
content-type=application/json; charset=utf-8
cache-control=no-store
textLength=925
updatedAt=1792697867119
textStart=## Local demo section — dsh-prompt-inject / 本地演示段落

This section is injected by
hasToken=True
```

第二次独立 GET 复现同结果：`status=200 length=974`（响应体字符数），响应头含 `Content-Type: application/json; charset=utf-8`、`Cache-Control: no-store`。

> **未做 POST 的原因**：任务卡原要求「POST 临时文本再恢复」，但本次执行指令明确要求「只做 GET（跳过 POST），避免改动真实提示词」。真实注入文本正在本会话生效，POST 恢复存在把用户提示词改坏的风险，收益（协议已在 24 项测试中覆盖）低于风险。POST 的 200/400/403/405/413/500 行为由契约测试的 fake req/res 覆盖（见 §2 #11-19），属「未在真实 socket 上复验」，已在 §6 标注。

### 3.3 安装状态与 profile 依赖

```json
{"entryId":"include:prompt-inject","moduleName":"@local/dsh-prompt-inject","enabled":true,"fiberPhase":"active","patchId":"prompt-inject"}
```

```text
=== profile package.json deps ===
@local/dsh-prompt-inject = link:E:/Project-hub/dsh-reverse-plugin/prompt-inject
depCount=4
```

### 3.4 持久化文件定位（实测）

```text
=== state.json locations ===
FOUND C:\Users\admin\.dsh\prompt-inject\state.json bytes=1122 textLength=925 updatedAt=1792697867119
ABSENT C:\Users\admin\.dsh\profiles\desktop\prompt-inject.state.json
```

运行进程未设置 `DSH_PROFILE_DIR`，因此按第 2 条规则落到 `$DSH_HOME/prompt-inject/state.json`，与 `resolveStateFilePath()`（index.js L64-72）一致；`VERIFICATION.md` §11 的描述与此吻合。

### 3.5 仓库状态

```text
=== git log -3 ===
ee1aa58 fix: flatten client locale keys
5913886 docs: record post-refactor injection regression check
1894c13 feat: add sidebar prompt editor with live system-prompt updates
=== git status -sb (prompt-inject) ===
## main...origin/main
=== git ls-remote origin main ===
ee1aa5810e3d30cc81fbee4d8d2b5a6fc7936946	refs/heads/main
=== git rev-parse HEAD ===
ee1aa5810e3d30cc81fbee4d8d2b5a6fc7936946
```

`ee1aa58` 的内容：`VERIFICATION.md | client.js | test/plugin.test.mjs`（3 files, +23/-14），即本轮 locale 扁平化修复；`git log -- client.js` 显示 `client.js` 首次出现在 `1894c13`。

### 3.6 客户端静态安全扫描

```text
innerHTML: 0
import statements: 0
require calls: require('react')
theme tokens dsw: 18
non-dsw vars: var(--
textarea value=: 1
harness import refs: 0
```

唯一非 `--dsw` 变量为 `var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)`（client.js L114），与 `VERIFICATION.md` §14 的修复记录一致。

### 3.7 监听地址

```text
LocalAddress LocalPort  State
------------ ---------  -----
127.0.0.1        22327 Listen
```

路由不走 `/api` 鉴权（index.js L10-11 注释、README §HTTP 契约），但宿主仅监听回环地址，且 POST 有同源校验，属于可接受的本机管理面。

## 4. 关键实现点核对（代码原文）

### 4.1 Origin / Host / sec-fetch-site

```js
function isForbiddenOrigin(req) {
  const headers = req.headers || {}

  const fetchSite = headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') {
    return true
  }

  const origin = headers.origin
  if (origin === undefined) return false
  if (typeof origin !== 'string' || origin.length === 0) return true

  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return true
  }

  const host = headers.host
  return typeof host !== 'string' || host.length === 0 || originHost !== host
}
```

- `Origin: null` → `new URL('null')` 抛错 → 403（测试覆盖）。
- 无 `Origin`（curl/本地进程）→ 放行：浏览器 CSRF 防护依赖 Origin/sec-fetch-site，非浏览器本地进程本就能直接改状态文件，不构成新增风险面。
- GET 不做来源校验：只读且返回的正是本 profile 注入的提示词文本，可接受。

### 4.2 体积与长度上限

```js
export const MAX_TEXT_LENGTH = 200000
export const MAX_BODY_BYTES = 256 * 1024
```

```js
for await (const chunk of req) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  size += buffer.length
  if (size > limit) {
    const error = new Error('payload-too-large')
    error.code = 'payload-too-large'
    throw error
  }
  chunks.push(buffer)
}
```

### 4.3 写失败不改内存

```js
const nextUpdatedAt = Date.now()
try {
  persistState(stateFile, { text, updatedAt: nextUpdatedAt })
} catch (error) {
  const message = error && error.message ? error.message : String(error)
  sendJson(res, 500, { error: 'persist-failed', message })
  return
}

// Only commit to memory after the file is safely on disk, so a failed
// write can never leave the live prompt out of sync with persistence.
currentText = text
updatedAt = nextUpdatedAt
ctx.emit('system-prompt/change')
```

### 4.4 原子写 + 损坏回退

```js
function persistState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempFile, JSON.stringify(state), 'utf8')
  renameSync(tempFile, file)
}
```

```js
try {
  parsed = JSON.parse(readFileSync(file, 'utf8'))
} catch {
  return null
}
if (!parsed || typeof parsed !== 'object') return null
if (typeof parsed.text !== 'string') return null
if (parsed.text.length === 0 || parsed.text.length > MAX_TEXT_LENGTH) return null
```

### 4.5 Client 的 ModuleLoader 形态与注册

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-prompt-inject',
  factory(require) {
    const React = require('react')
    ...
    return {
      name: '@local/dsh-prompt-inject',
      inject: ['slots', 'locale', 'layout'],
      apply: apply,
    }
  },
})
```

sidebar / main 注册（client.js L331-364）：

```js
ctx.slots.inject('sidebar.panellist', function () {
  return ctx.slots.register({ name: 'sidebar.panellist', id: 'prompt-inject', order: 20, label: () => t('panel'), locale: NS }, Icon)
})
ctx.slots.inject('main', function () {
  return ctx.slots.register({ name: 'main', key: 'prompt-inject', locale: NS, inject: () => ({ t, back: () => ctx.layout.selectPanel(null) }) }, Page)
})
```

## 5. 与 `VERIFICATION.md` 的一致性核对

| VERIFICATION 声明 | 复核结果 |
| --- | --- |
| `inject = ['systemPrompt','webServer']`（§7） | 一致（index.js L265） |
| 24/24 测试（§8） | 独立复跑 24/24，退出码 0，一致 |
| `GET` 由 404 变 200、Host 无需重启（§11） | 一致：本次 GET 仍为 200 |
| 持久化落 `C:\Users\admin\.dsh\prompt-inject\state.json`（§11） | 一致：文件存在，1122 bytes |
| §11 记录 `updatedAt=1792697297870` | **时间戳已过期**：现为 `1792697867119`（文本长度仍 925、内容一致）。属后续一次保存，非矛盾 |
| §11 记录 `textLength=925` | 一致（GET 与文件均 925） |
| 「已恢复原文本」(§11) | **无法完全自证**：只能确认当前文本含令牌且长度 925、与文件一致；但本次未获知原始文本哈希，故「与 POST 前逐字相同」仅能信任记录。风险为低（令牌与默认文案结构完整） |
| §1 文件清单仍写 `exports`（`.`/`./locale/*.json`/`./icon`），未含 `./client` | **陈旧章节**：package.json 实际已含 `"./client": "./client.js"`；§7 表格已补记，属文档遗漏而非事实错误 |
| §14 「combo 404、需重启」 | 与已知限制一致；本次未独立探测 combo 路由（见 §6） |

未发现 `VERIFICATION.md` 与事实相矛盾的陈述；仅有 1 处时间戳过期 + 1 处章节陈旧。

## 6. 已知限制与未验证项

1. **Client UI 未做真实浏览器验收（未点击）**：本会话无浏览器控制，无法确认侧边栏「提示词注入」按钮是否渲染、点击后主面板是否出现、textarea 回填与保存提示是否正确。UI 正确性目前仅由 `node:vm` 契约测试 + 静态代码审查支撑。
2. **Client 半区需重启 DSH 才注册**：builder 记录 clientModules 缓存了「无 `dsh.client`」的负结果，combo bundle 当前 404；本次按硬约束未重启、未刷新页面，也未独立探测 combo 路由，故「重启后 UI 出现」未经验证，仅与已知限制说明一致（此项按任务约定不单独判 FAIL）。
3. **POST 未在真实 socket 上复验**：按本次指令只做 GET；POST 的 200/400/403/405/413/500 全部由 fake req/res 契约测试覆盖。
4. **主题 token 真实性未独立验证**：`cordis_inspect_query`（client `Theme.listTokens`）10 秒超时（`Client inspect query Theme.listTokens timed out after 10000ms`）；客户端 UI 包打包在 `app.asar` 内，无法直接检索。已确认代码只用 CSS 变量、无硬编码色值。
5. **未验证多浏览器/多语言切换的实际表现**：`ctx.locale.bind(NS)` 的语言选择行为只按契约测试断言（回显 `namespace:key`）。

## 7. 非阻断观察（建议后续处理，不影响本次 ACCEPT）

**O1（低）文档与实现的长度上限不一致**：README/契约声明 `text` 最长 200000 **字符**，但请求体上限 256 KiB（262144 字节）。对 CJK 文本，200000 字符的 JSON body 约 600011 字节，会在长度校验前被 413 拒绝。实测计算：

```text
ascii200k_body_bytes=200011 <=legal=true
cjk200k_body_bytes=600011 <=legal=false over_by=337867
cjk_chars_that_fit=87377
```

即：ASCII 200000 字符可通过，中文实际上限约 87k 字符。方向是**安全失败**（拒绝而非截断写入），不破坏数据，但文档承诺与实现能力有落差，建议把文档改成「≤200000 字符且 ≤256 KiB（中文约 87k 字符）」。

**O2（低）`--dsw-alias-brand-primary` 无回退值**：client.js L60 `background: 'var(--dsw-alias-brand-primary)'`，若该 token 在宿主主题中不存在，按钮背景会变为透明（其余 token 均带 `, fallback`）。因 token 名与其它 10 个同族 token 命名一致，风险低；建议补 `, #4d6bfe` 之类回退。

## 8. 复核结论

| 维度 | 判定 |
| --- | --- |
| 功能契约（Host 路由/持久化/动态段落） | PASS |
| 安全（Origin/Host、体积、XSS、回环绑定） | PASS（2 项低风险观察） |
| Client 代码形态（ModuleLoader/id/slot/locale/主题） | PASS |
| 测试（独立复跑） | PASS（24/24，exit 0） |
| 安装状态（enabled/active + link） | PASS |
| 仓库（已提交、已推送、工作树干净） | PASS |
| 真实浏览器 UI | 未验证（已知限制） |

**最终判定：ACCEPT**——交付可接受；Client 面板需重启 DSH 并刷新页面后生效，属已披露的已知限制。
