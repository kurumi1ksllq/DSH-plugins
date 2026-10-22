# Review: prompt-inject

- 任务卡：`task-2`（独立复核，只读）
- 复核者：`reviewer`（独立于 builder；不采信 builder 自述）
- 工作区：`E:\Project-hub\dsh-reverse-plugin`
- 复核对象：`prompt-inject/` 包 + desktop profile 中的实际加载与运行时效果
- 复核时间：2026-10-23（Asia/Shanghai）
- 运行时：Node.js v24.15.0（满足 `engines: ^22.19.0 || >=24.0.0`）
- 本次复核新增写入：仅本文件 `reports/review-prompt-inject.md`（复核开始前工作区内不存在 `reports/` 目录）

## 最终判定：**ACCEPT**

核心验收项（全新子代理仅凭系统提示词逐字复述令牌）独立复现成功；静态清单、解析、测试、安装状态与 builder 的 `VERIFICATION.md` 记录一致，未发现事实不符。剩余风险见文末。

## 逐项检查

| # | 检查项 | 结果 | 证据（工具/命令返回原文） |
|---|---|---|---|
| 1 | `package.json` manifest 自洽：`dsh.bundle.patch` 指向存在文件 | PASS | `"dsh": { "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" } }`（package.json L21-26）；`Test-Path` 与 `node --check` 均确认 `prompt-inject/cordis.patch.yml` 存在（404 bytes） |
| 2 | `exports` 覆盖 locale/*.json 与 icon | PASS | `"exports": { ".": "./index.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" }`（L9-13）；对应 `locale/en.json`、`locale/zh.json`、`icon.svg` 均实际存在 |
| 3 | `files` 覆盖全部运行文件 | PASS | `"files": ["index.js","cordis.patch.yml","locale/*.json","icon.svg","README.md"]`（L14-20）；运行时资源（入口、patch、locale、icon）全覆盖；`test/`、`VERIFICATION.md` 为开发期文件，未列入属合理（通过 `link:` 安装时仍会随目录可见） |
| 4 | `cordis.patch.yml` 只有 insert、id/name 正确、无 tab | PASS | 非注释行原文：`["- insert:","    - id: prompt-inject","      name: \"@local/dsh-prompt-inject\""]`；`has tab: false`；自写解析器输出 `parsed: {"insert":[{"id":"prompt-inject","name":"@local/dsh-prompt-inject"}]}`，仅 3 行，无 config 覆盖 |
| 5 | locale 是真实中英文文案（非占位符） | PASS | `en.json`：`"title": "Prompt Inject (dsh-prompt-inject)"`、`"description": "Host-only demo bundle ... verification token DSH-INJECT-7F3A-2026 ..."`；`zh.json`：`"title": "提示词注入 (dsh-prompt-inject)"`、`"description": "仅宿主端的演示插件：向所有 Agent 的系统提示词追加一段中英双语说明与验证令牌 ..."`。测试 `locale files carry real plugin metadata` 通过 |
| 6 | icon 是合法 SVG | PASS | `[xml]` 解析：`XML_WELL_FORMED=True root=svg width=64 height=64 viewBox=0 0 64 64`；排除 xmlns 命名空间后 `NO_EXTERNAL_REF`；`icon.svg` 611 bytes，无 BOM |
| 7 | `index.js` 含 `inject = ['systemPrompt']` | PASS | L77：`export const inject = ['systemPrompt']`；从 profile 实际 import 输出 `inject: ["systemPrompt"]` |
| 8 | `index.js` 调用 `ctx.systemPrompt.section(...)` | PASS | L68：`ctx.systemPrompt.section({ name: sectionName, order, text, interpolate: false, })` |
| 9 | `interpolate: false` | PASS | L72：`interpolate: false`；运行时注册结果 `"interpolate":false` |
| 10 | 默认令牌 `DSH-INJECT-7F3A-2026` | PASS | L22：`export const DEFAULT_TOKEN = 'DSH-INJECT-7F3A-2026'`；L34 文案内 `` `DSH-INJECT-7F3A-2026` ``；实际 import 输出 `token const: DSH-INJECT-7F3A-2026` |
| 11 | `node --check prompt-inject/index.js` | PASS | `node --version` → `v24.15.0`；`node --check .\prompt-inject\index.js` 无输出，随后 `SYNTAX_OK` |
| 12 | 三个 JSON 可 `JSON.parse` | PASS | `JSON OK: prompt-inject/package.json -> keys=name,version,private,description,type,icon,main,exports,files,dsh,engines,keywords,license` / `JSON OK: prompt-inject/locale/en.json -> keys=meta` / `JSON OK: prompt-inject/locale/zh.json -> keys=meta` |
| 13 | patch YAML 结构可解析且无 tab | PASS | 见 #4 原文；缩进 0/4/6，`has tab: false`，无第三方 yaml 库依赖 |
| 14 | 契约测试全绿 | PASS | `node --test .\prompt-inject\test\plugin.test.mjs`：`tests 8 / pass 8 / fail 0`，`EXIT=0`；8 条测试名与 `VERIFICATION.md` 绿色清单逐条一致 |
| 15 | 安装状态：`@local/dsh-prompt-inject` / `include:prompt-inject` 存在、enabled、active | PASS | `plugin_manager list_plugins`（offset 200 页）原文：`{"entryId":"include:prompt-inject","moduleName":"@local/dsh-prompt-inject","enabled":true,"fiberPhase":"active","patchId":"prompt-inject"}`；`total: 213` |
| 16 | 已安装产物可解析并正确注册（复现 builder 第 4 节） | PASS | 在 `C:\Users\admin\.dsh\profiles\desktop` 下 import：`resolved exports: DEFAULT_ORDER,DEFAULT_SECTION_NAME,DEFAULT_TEXT,DEFAULT_TOKEN,apply,inject`；`inject: ["systemPrompt"]`；`registered: {"name":"demo:prompt-inject","order":3500,"interpolate":false,"hasToken":true}` |
| 17 | 运行时注入验证（核心）：全新子代理逐字复述令牌 | PASS | 见下节“核心运行时验证”，子代理关闭消息原文仅为 `DSH-INJECT-7F3A-2026` |
| 18 | 越界检查：`prompt-inject/` 之外是否有新增/修改文件 | PASS | 工作区根 `Get-ChildItem -Force` 仅 `prompt-inject` 一个目录；排除 `prompt-inject`、`node_modules`、`.git` 的全量文件枚举结果为空（复核开始前无任何其他文件）；复核期间唯一新增为本报告 |
| 19 | 越界检查：`prompt-inject/` 内是否有无关文件 | PASS | 递归文件清单恰为 9 个：`package.json`、`cordis.patch.yml`、`index.js`、`locale/en.json`、`locale/zh.json`、`icon.svg`、`README.md`、`test/plugin.test.mjs`、`VERIFICATION.md`，全部有明确用途，无临时/杂项文件 |
| 20 | 未执行安装/卸载/启停 | PASS | 本次会话 `plugin_manager` 仅调用 `action: "list_plugins"`（offset 0/100/200）；未调用 `install_bundle`/`set_plugin`/`remove_bundle`；未写入任何 profile 文件 |

## 核心运行时验证（独立复现，不采信 builder 结论）

方法：用 `subagent` 启动**全新、非 fork** 子代理（不共享本复核者上下文），提示词明确要求：不读取任何文件、不调用任何工具、只依据自身当前系统提示词回答“注入令牌是什么”，找不到就回答 `MISSING`，找到则逐字输出令牌。

- 子代理 id：`15ad1475-851b-4865-9b85-da4dae3eb26a`
- 系统通知原文：`Agent 15ad1475-851b-4865-9b85-da4dae3eb26a sent a message: DSH-INJECT-7F3A-2026`；`Its closing message: DSH-INJECT-7F3A-2026`
- 回答原文（逐字）：

```text
DSH-INJECT-7F3A-2026
```

- 判定：与 `index.js` 的 `DEFAULT_TOKEN` / 注入文案中的令牌**精确一致**，无多余字符 → 运行时注入 **PASS**。
- 说明：本复核者自身的系统提示词中也出现了该注入段落（符合预期），但按任务要求**未将其作为证据**；上述证据完全来自我独立创建的子代理。

## 与 builder `VERIFICATION.md` 的交叉核对

未发现与事实不符之处。可复现项全部一致；不可复现项如实标注：

| VERIFICATION.md 声明 | 复核结论 |
|---|---|
| `node --check` OK、3 个 JSON 可解析、YAML 解析为 `[{"insert":[{"id":"prompt-inject","name":"@local/dsh-prompt-inject"}]}]` | 一致（原文逐字复现） |
| 最终测试 8/8 全绿，测试名逐条列出 | 一致（8 条名称、数量、结果完全一致） |
| `list_plugins` offset 200 / total 213，行 `enabled: true`、`fiberPhase: active` | 一致（offset 200 页确实包含该行，total=213） |
| profile 路径 `C:\Users\admin\.dsh\profiles\desktop` | 一致（该目录下 `package.json` 的 dependencies 为 `"@local/dsh-prompt-inject": "link:E:/Project-hub/dsh-reverse-plugin/prompt-inject"`，`dsh.profile.bundles` 含 `@local/dsh-prompt-inject`，`pnpm-lock.yaml` 对应 `specifier: link:...`） |
| 已安装产物 import 后 `resolved exports` / `inject` / `registered` | 一致（输出字段与值逐字对应） |
| 历史“红测 6 通过 / 2 失败 → 修复后转绿” | **无法独立复现**（历史运行不可回放）；但当前状态与“已修复”一致：`config` 为 `null` 的用例通过，图标测试通过 |
| 安装返回原文（`application: applied`、`warnings: []`、pnpm 输出） | **无法独立复现**（任务禁止重新安装）；由 profile 依赖/lockfile/list_plugins 间接印证安装已完成且生效 |
| 第 5 节 builder 子代理 id `cfb5896c-...` 及回答 | **无法独立核实该历史子代理**（不共享其会话）；但我自己的独立子代理复现了同一令牌，结论不依赖 builder 自述 |
| “未做任何 profile 手工修改” | **无法证明**；可观察到 profile 内存在 `cordis.patch.yml.bak-20261023` 备份文件与由 `plugin_manager` 写入的依赖/bundles 变更（符合受管安装行为，未见异常），但无法区分是否有人工编辑 |

## 剩余风险

1. **全局生效**：该 section 注册到 profile 级 `systemPrompt`，desktop profile 下**所有** session/agent/subagent（含其他项目的工作区会话）都会收到这段约 600 字符的文本与令牌规则，不只是本演示任务。
2. **持久化**：`package.json` 中依赖为 `link:E:/Project-hub/dsh-reverse-plugin/prompt-inject`，即运行时直接使用工作区目录、无构建复制隔离——**修改/删除/移动该目录会立即影响下次 profile 启动**。当前工作区与安装产物哈希一致（6 个运行文件 SHA256 全部 `match=True`）。
3. **关闭方式清楚**：README L40-44 明确写了 `plugin_manager` → `set_plugin`（enabled: false）或移除 bundle；段落注册绑定在插件 Cordis 上下文，停用/卸载即清理。但操作需要 `management-required` 级权限，README 未提这一点。
4. **行为层面确有提示词干预**：注入文本包含“用户问注入令牌时只回答令牌、其余情况不提及本段”的行为指令。它显式声明不覆盖安全/权限规则，且范围极小，但“其余情况不提及”类要求无法被静态验证其遵守程度。
5. **配置无 schema**：`apply(ctx, config)` 对非法 `name/order/text` 静默回退默认值（README 已说明），拼写错误不会报错，排障时可能误以为覆盖生效。
6. **验收覆盖面**：本轮验证只证明“一个新的默认子代理能看到令牌”，未逐一覆盖所有 agent preset / 客户端 UI / 非默认模型路径；如需“全场景注入”承诺，需另测。
7. 注入文本中包含令牌触发规则，未来若其他插件的系统提示词存在冲突指令，行为优先级取决于段落顺序（`order: 3500`，位于内置段落之后）；未观察到冲突。

## 复核结论

- 静态交付质量：满足任务卡全部硬性要求（manifest/exports/files/patch/locale/icon/index 注入点/默认令牌）。
- 解析与测试：`node --check`、3×JSON、YAML 结构、8/8 契约测试全部通过。
- 安装状态：`include:prompt-inject` 已加载且 `enabled: true` / `fiberPhase: active`。
- 运行时效果：独立全新子代理仅凭系统提示词逐字复述 `DSH-INJECT-7F3A-2026`，核心验收成立。
- 越界：`prompt-inject/` 外无新增/修改文件，包内无无关文件。
- builder `VERIFICATION.md`：未发现与事实不符；历史性声明已标注为不可独立复现。

**最终判定：ACCEPT**（附带上述剩余风险）。
