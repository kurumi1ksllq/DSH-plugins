# @local/dsh-prompt-inject

仅宿主端（Host-only）的 DSH bundle 演示插件：向该 profile 中**每个 Agent 的系统提示词**追加一小段中英双语说明，并带有唯一验证令牌 `DSH-INJECT-7F3A-2026`。它用于端到端确认"宿主侧系统提示词注入"链路可用，除此之外不改变任何行为，也不提供 UI。

## 注入内容

通过 `@deepseek-ai/dsh-system-prompt` 的 `ctx.systemPrompt.section()` 注册一个全局段落：

| 字段 | 默认值 |
| --- | --- |
| section `name` | `demo:prompt-inject` |
| `order` | `3500`（在内置段落之后） |
| `interpolate` | `false`（固定值，文案按字面量处理） |
| 文案 | 见 `index.js` 中的 `DEFAULT_TEXT` |

文案要点：

- 明确标注由本地插件 `@local/dsh-prompt-inject` 注入、仅作演示，不覆盖安全策略与权限规则；
- 声明验证令牌 `DSH-INJECT-7F3A-2026`；
- 行为约定：用户问"注入令牌是什么 / what is the injection token"时，只逐字回答该令牌、不加解释；其余情况下不主动提及本段，也不改变其他行为。

一个全新子代理若能仅凭系统提示词复述出该令牌，即说明注入已生效。

## 配置覆盖

`apply(ctx, config)` 接受三个可选字段（不定义 Config schema，不引入第三方依赖）：

```js
// profile 的 patch 层示例（非本包自带）
- id: prompt-inject
  name: "@local/dsh-prompt-inject"
  config:
    name: "demo:prompt-inject"   // 覆盖 section 名称
    order: 3500                  // 覆盖排序位置
    text: "自定义注入文本"        // 覆盖整段文案（空字符串仍用默认文案）
```

字段类型不合法（`order` 非有限数字、`text`/`name` 非字符串或为空）时静默回退到默认值。

## 安装与卸载

- 安装：`plugin_manager` → `install_bundle`，target 传本目录绝对路径，由 plugin_manager 负责写 profile 的依赖与 patch。
- 生效：插件行加载到 harness 的 Host 侧，下一次模型请求即带上该段落；已建立的会话若仍使用旧的提示词缓存，新建会话即可看到。
- 关闭：在 `plugin_manager` 中禁用该插件行（`set_plugin`，enabled: false），或从 profile 中移除该 bundle。段落注册绑定在插件 Context 上，卸载时自动清理，无需手工改 profile 文件。

## 文件

- `index.js` — Cordis 插件入口，注册 section
- `cordis.patch.yml` — bundle patch 层，插入 `prompt-inject` 行
- `locale/en.json`、`locale/zh.json` — 插件标题与描述
- `icon.svg` — 64×64 原创几何图标
- `package.json` — 包声明（`dsh.bundle.patch` 指向本包 patch）

## 验证

- [VERIFICATION.md](VERIFICATION.md) — 构建、安装与运行时子代理验证证据
- [docs/review.md](docs/review.md) — 独立复核报告（判定 ACCEPT）

## 安全说明

本插件不读取文件、不联网、不注册工具、不监听事件，唯一动作是注册一段静态系统提示词。文案显式声明"不覆盖任何安全/权限规则"，且不要求模型泄露系统提示词全文。
