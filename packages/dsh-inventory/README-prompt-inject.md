# prompt-inject(已并入 dsh-inventory,#111)

DSH bundle：向该 profile 中**每个 Agent 的系统提示词**追加一段可编辑的中英双语演示段落，编辑界面在 **工具管理（dsh-inventory）** 页里（分段标签「提示词注入」，或总览里的同名分区），用于读取、修改并保存注入文本。段落里带有唯一验证令牌 `DSH-INJECT-7F3A-2026`。

- Host 半区（`index.js`）：注册系统提示词段落 + `GET/POST /prompt-inject/state` 路由 + 本地持久化。
- Client 半区（`client.js`）：只注册 `prompt-inject` 命名空间的 zh/en 文案字典（不再占侧边栏槽位）；文本读写由 `dsh-inventory` 的工具管理页调用上面两个 HTTP 方法完成。

## 注入内容

通过 `@deepseek-ai/dsh-system-prompt` 的 `ctx.systemPrompt.section()` 注册一个全局段落：

| 字段 | 默认值 |
| --- | --- |
| section `name` | `demo:prompt-inject` |
| `order` | `3500`（在内置段落之后） |
| `interpolate` | `false`（固定值，文案按字面量处理） |
| `text` | getter `() => currentText`，每次 prompt assembly 重新求值 |
| 初始文案 | `DEFAULT_TEXT`（见 `index.js`；保留原有演示语义与令牌） |

文案要点：

- 明确标注由本地插件 `dsh-inventory` 注入、仅作演示，不覆盖安全策略与权限规则；
- 声明验证令牌 `DSH-INJECT-7F3A-2026`；
- 行为约定：用户问"注入令牌是什么 / what is the injection token"时，只逐字回答该令牌、不加解释；其余情况下不主动提及本段，也不改变其他行为。

## 编辑器位置

1. 打开左侧边栏的**「工具管理」**，点分段控件上的「提示词注入」（或展开总览里的同名分区）。
2. 面板内容：标题、说明、受控 textarea、「保存提示词」按钮，以及读取/保存状态提示。
3. 打开面板时自动 `GET /prompt-inject/state` 回填当前文本；「确定」用 `POST` 保存，成功后提示已保存，并可在下一次模型请求中生效（Host 的 section 是 getter）。
4. 文本为空时本地提示且不发请求；保存中按钮禁用；textarea 内回车只换行，不触发提交。

页面文案来自本 bundle 注册的 zh/en 字典（namespace `prompt-inject`）；`dsh-inventory` 用主题 token 着色，不依赖任何 Harness Client 组件包。

## HTTP 契约

路由为普通 HTTP（不走 `/api` 鉴权），因此 Host 自行校验来源。

| 方法 | 请求 | 成功响应 | 失败 |
| --- | --- | --- | --- |
| `GET /prompt-inject/state` | — | `200 { text, updatedAt }` | — |
| `POST /prompt-inject/state` | JSON `{ text }` | `200 { text, updatedAt }`，并 `emit('system-prompt/change')` | `400 { error:'invalid-text' }`、`400 { error:'invalid-json' }`、`403 { error:'forbidden-origin' }`、`413 { error:'payload-too-large' }`、`500 { error:'persist-failed', message }` |
| 其他方法 | — | — | `405 { error:'method-not-allowed' }` |

- 响应头统一 `content-type: application/json; charset=utf-8`、`cache-control: no-store`。
- `text` 必须是字符串、非空、长度 ≤ 200000；请求体上限约 256 KiB。
- POST 若带 `Origin`，其 host 必须与 `Host` 头一致；`sec-fetch-site: cross-site` 一律拒绝（含 `Origin: null`）。
- 写盘失败时返回 500，且内存中的注入文本保持不变（先落盘、后更新内存）。
- 路由注册包在 `ctx.effect(...)` 内，卸载插件时自动移除。

## 持久化

状态文件（`{ text, updatedAt }`）按以下顺序定位：

1. `$DSH_PROFILE_DIR/prompt-inject.state.json`（Host 运行时通常存在此变量）
2. `$DSH_HOME/prompt-inject/state.json`
3. `~/.dsh/prompt-inject/state.json`

写入采用「临时文件 + rename」原子替换；启动时同步读取，文件缺失/JSON 损坏/字段非法时回退到默认文案（`updatedAt: 0`）。不写 profile 的 `package.json` / `cordis.patch.yml`。

## 配置覆盖

`apply(ctx, config)` 接受三个可选字段（不定义 Config schema，不引入第三方依赖）：

```js
// profile 的 patch 层示例（非本包自带）
- id: prompt-inject
  name: "dsh-inventory/prompt-inject"
  config:
    name: "demo:prompt-inject"   // 覆盖 section 名称
    order: 3500                  // 覆盖排序位置
    text: "自定义注入文本"        // 覆盖初始文案（空字符串仍用默认/持久化文案）
```

优先级：`config.text` > 持久化文本 > `DEFAULT_TEXT`。字段类型不合法（`order` 非有限数字、`text`/`name` 非字符串或为空）时静默回退。

## 安装与生效

- 安装：`plugin_manager` → `install_bundle`，target 传本目录绝对路径，由 plugin_manager 负责写 profile 的依赖与 patch。
- 生效：Host 半区与 Client 半区都需要 Harness 重新加载插件；已运行的进程通常需要重启 DSH 并刷新页面。安装返回若为 `restart-required`，以 `VERIFICATION.md` 记录为准。
- 关闭：在 `plugin_manager` 中禁用该插件行（`set_plugin`，enabled: false），或从 profile 中移除该 bundle。段落与路由都绑定在插件 Context 上，卸载时自动清理。

## 文件

- `index.js` — Host 入口：动态 section、HTTP 路由、原子持久化
- `client.js` — Client 入口：`window.__ModuleLoader__.load`，只注册文案字典（编辑界面在工具管理页）
- `cordis.patch.yml` — bundle patch 层，插入 `prompt-inject` 行
- `locale/en.json`、`locale/zh.json` — 插件标题与描述（面板文案在 `client.js` 内）
- `icon.svg` — 64×64 原创几何图标
- `package.json` — 包声明（bundle patch + `dsh.client`）
- `test/prompt-inject.test.mjs` — 纯 Node 契约测试（fake ctx + `node:vm`）

## 验证

- [VERIFICATION.md](VERIFICATION.md) — 构建、安装、路由契约、测试与运行时验证证据
- [../reports/review-prompt-inject.md](../reports/review-prompt-inject.md) — 首版独立复核报告（判定 ACCEPT，针对无 UI 版本；项目级归档在仓库根 `reports/`）
- [../reports/review-prompt-editor.md](../reports/review-prompt-editor.md) — 侧边栏编辑器复核报告（判定 ACCEPT）

## 安全说明

- Host 只读写上述状态文件，不联网、不注册其他路由、不监听其他事件；Client 只向同源 `/prompt-inject/state` 发请求。
- 修改注入文本等同于修改系统提示词，属于本机 profile 管理者的操作；路由仅绑定本机 Host 并做同源校验，不要将 DSH 端口暴露到不受信任的网络。
- 默认文案显式声明"不覆盖任何安全/权限规则"，且不要求模型泄露系统提示词全文。
