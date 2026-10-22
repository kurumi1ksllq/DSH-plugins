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
