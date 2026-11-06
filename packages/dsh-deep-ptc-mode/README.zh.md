# 深度 PTC 模式

[English](README.md) · MIT · 当前版本：**1.7.3**

[1.7.3 实测汇总 / Test summary](TEST_REPORT.md)
**让插件协作，让当前官方 PTC 工具兜底，让任务始终可沟通。**

深度 PTC 是面向插件生态的 DeepSeek Harness Agent 模式（preset）：优先在当前可用的外部插件中寻找同功能工具，没有合适能力或插件工具故障时，再用当前官方 PTC 的工具继续完成任务。多个插件可以分工完成同一个任务，各自保留原有参数、发现方式和结果契约；深度 PTC 本身不提供新的任务工具。

原有的工作特点完整保留：把模型能力用满，长命令交给后台 job，运行中随时回应你的插话，按任务大小规划，意图不清先问，并在你选择的 WSL / PowerShell / Zsh / Bash 环境执行。

## 为「一切皆插件」的协作方式而设计

兼容性有两个方向：向官方，跟随当前安装版本的 PTC 组成演进；向外部，允许工具插件参与任务，不把工具清单固定下来。这更贴合 DSH「一切皆插件」的组合理念：模式负责工作规则和故障恢复指引，工具能力由各自的插件负责。

| 分工 | 如何协作 |
| --- | --- |
| 外部能力优先 | 先按功能寻找可用的插件工具，需要时使用该插件自己的发现/SDK 加载接口 |
| 多插件相互配合 | 同一任务的不同步骤可以交给不同插件，不要求只绑定某一个增强插件 |
| 当前官方工具兜底 | 增强能力缺失或故障时，回到当前安装 Harness 的官方 PTC 能力 |
| 工作方式保持一致 | 保留后台运行、随时插话、澄清、任务规划和所选执行环境 |

外部插件需支持当前宿主，并在 `deep-ptc` 的作用域中发布工具；支持保留官方工具的插件，应在自身配置中保留兜底能力。这是任务级的合作选择机制，不代表所有插件或整个替换执行器都能直接互换。OPS 可以作为其中一个提供者，不是内置依赖，也不表示已经完成 OPS 的实际联调。

官方兜底沿用 1.6.1 的动态派生机制：自动读取实际运行宿主的官方 PTC 声明；每 5 秒检测声明变化，仅在声明或本插件配置变化时重建预设，工具模块和配置跟随该声明；仅在声明无法读取、解析或派生时使用随包快照并记录日志。官方升级后需重载并创建使用新版预设的会话，既有会话不被强制切换。最低支持 DSH `>=0.2.2-rc.1`，不设上限；更高版本仍需验证宿主接口。

## 1.7.2：轻量、按需、可恢复的工具调用层

本版增加一个工具与 Skill 的目录入口 `deep_ptc_tools`，具体任务继续交给外部插件和当前官方 PTC 工具完成。

- **先搜摘要，再加载定义。** 本地元数据检索优先返回外部工具，未找到匹配项时返回官方候选。默认每页 6 项，最多 8 项；完整 schema 每次最多加载 6 个、总预算 16 KB。普通官方工具继续可用，额外工具按需进入宿主生成的 PTC SDK，最多保留 12 个近期选择。
- **确认损坏才禁用。** 工具明确不可用（如模块缺失、接口不存在、声明不可用）时立即禁用；临时错误和原因不明的失败连续 3 次才禁用，中间成功一次就清零。参数错误、路径错误、权限拒绝、取消，以及工具正常返回的业务结果（如“构建失败”）都不算工具故障。官方工具不参与禁用，包括配置根层的官方工具（如 `lsp`、`terminal_*`）。禁用后由程序拦截后续调用，故障记录随对话保存；切换 agent、恢复对话或重载插件不会自动解除。调用开始时捕获来源和状态代次，用户重载前的迟到结果不会污染新状态。普通空结果、分页续读和命令非零退出同样不算故障。
- **任务优先，不查坏工具。** 输入有误就改正，临时错误最多重试两次；工具一旦被禁用，就尽快改用其他可用同类工具或官方工具，不再探测、重试或查根因。仅在写入或命令可能已部分完成时核查必要的任务状态，避免重复操作。
- **完成时简报。** 模型结束任务时简短列出失败工具与已声明的插件来源；程序同时在回合结束后生成可展开的“工具适配提醒”。来源不明就列工具名，不猜插件身份或故障原因。
- **输入框下方一键重载。** “重载所有工具状态”仅清除当前对话的故障标记与按需加载选择；不调用模型，也不停止正在运行的任务。另有用户命令 `/deep-ptc-reset-tools`。
- **Skill 两阶段调用。** 目录只查询宿主已解析的技能元数据和调用权限；选中后使用官方 `skill` 工具加载正文并遵守完整指令，复用上下文中已有指令。检索不读取 Skill 正文。

```js
// 在官方 run_code 中使用；这些操作本身不会执行搜索到的任务工具。
const matches = await tools.deep_ptc_tools({ action: 'search', query: 'search files' });
const loaded = await tools.deep_ptc_tools({ action: 'load', names: ['实际工具名'] });
const skills = await tools.deep_ptc_tools({ action: 'skills', query: 'build test' });
// 之后按返回的真实 schema 调用工具，或通过官方 skill 加载选定技能。
```

可在 `deep-ptc-settings` 设置 `compactToolCatalog: false` 保留完整宿主 SDK，故障禁用与重载机制仍工作。`toolCompatibility: false` 则停用整套新增调用层。`toolPreferences` 继续支持对已有工具的可选优先关系。

精简只作用于当前官方渲染器生成且未被其他插件改写的 SDK 段；插件自建 SDK 继续由其自身加载器管理。外部插件仍须支持当前宿主并在 `deep-ptc` 作用域发布工具；本层不会绕过工具隐藏、授权或接管被卸载的整个执行器。未进行实际 OPS/在线模型端到端评测。

## 简介

日常 Agent 工作中常见六个问题，深度 PTC 模式逐一针对：

| 你遇到的问题 | 深度PTC模式的做法 |
| --- | --- |
| 增强工具与自定义模式难以自然配合 | 外部插件能力优先，多提供者按功能协作，故障时使用动态继承的官方 PTC 基线恢复任务 |
| 模型总想帮你省 token，少查、少测，结果质量打折 | 人设写明「在深度求索工作，本模式 token 预算无限，把预算花在工作上」：不为省 token 跳过读取、搜索、命令或验证；同时禁止注水、啰嗦和撑爆上下文 |
| 任务跑起来后模型在 sleep 或干等，你发消息它不理 | 由代码强制：前台命令超过 30 秒自动转后台，你一发消息正在等的命令立即转后台、模型马上看到消息，长 sleep 直接拒绝；job 完成会自动唤醒模型（详见下方「代码层强制」） |
| 不管大小任务都同一种开工方式 | 按预计耗时分三档：5 分钟内自己计划直接做；5–20 分钟先告诉你计划、不等审批就执行；超过 20 分钟先给计划、等你批准 |
| 意思没弄懂就开干，最后返工 | 意思归用户，事实归工具：不认识的名称、多个可能目标、技术路线、范围和验收标准不确定时先问你（1–3 个带选项的问题），不靠搜索去猜你的意图；文件位置、当前行为这类事实自己查 |
| 命令环境固定，Windows 上想用 WSL、Mac 上想用 Zsh 都不方便 | 设置里可选 WSL Bash、PowerShell、Zsh（macOS/Linux）或原生 Bash，只对本模式生效，不改全局 shell |

使用三步：安装插件 → 在 **设置 → 插件 → 深度 PTC** 里选执行环境 → 新建任务时在模式选择器里选「深度PTC模式」。

## 代码层强制：不休眠、随时可插话

「不 sleep、不干等」不只写在提示词里，1.5.0 起由插件代码强制执行，由运行时执行以下已覆盖的规则：

| 场景 | 代码行为 |
| --- | --- |
| 前台命令跑得久 | 超过 **30 秒**（可配置 5–600）自动转为后台 job，命令不会被杀掉；模型请求更长的 `timeoutMs` 也会被压到这个上限 |
| 命令运行中你发了消息 | 约 2 秒内结束前台等待，命令转入后台继续跑，模型立刻看到你的消息；job 完成后仍会自动唤醒模型 |
| `job_output` 等待 job | 等待上限同为 30 秒；你一发消息就提前返回；你的消息未读时再次等待会被拒绝 |
| 模型写 `sleep 60`、`Start-Sleep 30`、`timeout /t 20` | 前台超过 5 秒的暂停直接拒绝（`run_in_background` 的命令不受限）；`sleep 1` 这类就绪循环照常 |
| `run_code` 程序里 `setTimeout`/`setInterval`/`time.sleep` | 仅拒绝能静态确认超过 5 秒的实际等待；未知时长放行；同一程序里轮询同一个运行中 job 超过 3 次也会被拒绝 |
| `ask_user_question` | 改为限时模式：默认等 120 秒，最多 300 秒，`-1`（无限等）被拒绝；超时后问题变为「待回答」，你之后的回答会作为消息送达；你不点卡片、直接打字回复，也会立刻结束等待 |

这些规则只作用于「深度PTC模式」会话，不影响其他模式。前提是桌面端设置里「忙碌时回车」为**插入当前任务（steer）**；若为排队（queue），消息会等整轮结束才送达。

```yaml
- id: deep-ptc-settings
  config:
    foregroundSeconds: 30   # 前台等待上限（秒），5–600
```

## 选择 WSL、PowerShell 或 macOS 工具

安装并加载后，打开 **设置 → 插件 → 深度 PTC**，选择执行环境并保存，再新建一个「深度PTC模式」会话。

| 选项 | 宿主 | 实际执行方式 / 模型工具 |
| --- | --- | --- |
| 自动 | Windows / macOS / Linux | Windows 选 PowerShell，macOS 选 Zsh，Linux 选 Bash |
| WSL Bash | Windows | `wsl.exe ... --exec bash -lc`，工具名 `bash` |
| PowerShell | Windows | Harness 官方原生 PowerShell 执行器，工具名 `pwsh` |
| Zsh | macOS / Linux | macOS 用 `/bin/zsh -lc`；Linux 用已安装的 `zsh`；工具名 `zsh` |
| 原生 Bash | macOS / Linux | Harness 官方 Bash 执行器，工具名 `bash` |

不适用于宿主的选项会禁用，运行时配置也会拒绝这些选择。WSL 发行版留空时使用 Windows 默认发行版，也可填写 `Ubuntu` 等已安装名称。Linux 上选择 Zsh 前需要安装 Zsh。

**选择会改变实际执行器和模型看到的命令语法，不只改工具名称。** 执行器隔离在本 preset 中，不修改全局 shell，也不影响其他 preset。保存设置后，新会话使用新版本；已有会话和后台任务继续使用创建时的环境。切换环境时请新建会话，避免同一任务中途换方言。

WSL 命令使用 Linux/POSIX 语法；文件工具和 `workdir` 仍用 Windows 宿主路径。执行器用 `--cd` 进入目录，发行版、目录和命令分别作为 argv 传递，不额外拼接 shell 字符串。WSL 内的 PATH、代理等由所选发行版的登录 shell 配置决定，Windows 环境变量不会全部自动变成 Linux 环境变量。

### 沙箱边界

原生 PowerShell、Bash 和 Zsh 继续使用 Harness 的沙箱、审批和进程管理。WSL 跨越 Windows/Linux 边界，目前仅支持宿主已经授权的 `danger-full-access` 执行；`read-only` 或 `workspace-write` 调用在启动命令前失败。插件不会自行升权、改变默认权限或悄悄换 shell。

## 工作规则

- **不为 token 省力：** 人设写明在深度求索工作、本模式 token 预算无限，按问题需要而不是成本决定读取、搜索、命令和验证的深度；同时禁止注水和啰嗦，单次上下文仍有限，靠压缩、裁剪和子代理控制。
- **任务运行中随时可插话：** 由代码强制（见上文），提示词同时要求：不 sleep、不轮询、不挂长时间前台调用。构建、测试、安装、服务器等耗时命令放后台 job，期间继续做短步骤，用不阻塞的方式查看进度；没事可做就一句话说明在跑什么并结束回合，job 完成会自动唤醒模型，你的消息会被立即处理。
- **按任务长短计划：** ≤5 分钟内部计划直接做，不单独告知；5–20 分钟展示计划后立即执行，不等审批；>20 分钟展示计划并等你批准再改动。估计升档时重新说明计划；显式 plan mode 的规则优先。
- **意图不清先问：** 意思归用户，事实归工具。不认识的名称、多个可能目标、技术路线、权威来源、做事方式、验收标准和范围不确定时先问，不用搜索去猜你的术语；文件位置、当前行为、版本等可检查的事实自己查。每次 1–3 个带选项的问题，推荐项在前；你的回答优先于模型推断。
- **进度可见：** 每次 `run_code` 前一句话说明要做什么，里程碑稍长汇报，连续两三个工具调用必须出声。
- **充分验证并停止，按需委派：** 验证改动触及的行为和边界，满足验收标准后交付；只在任务确实可拆分或需要独立复核时委派，按实际工具渠道收集结果。

提示词能改变模型的工作倾向，但不改变实际的 token 上限或计费，也不保证模型每次完全遵守。真正影响思考深度的设置是模型的 `reasoningEffort`。

## 安装和升级

要求 Node `>=24`、DSH `>=0.2.2-rc.1`。1.3.0 已用 Windows 桌面端 rc.5 做 WSL/PowerShell 命令验证。macOS/Zsh 分支做了配置、工具挂载与参数测试，尚未在 macOS 真机执行。

本地目录或构建产物可通过插件管理器安装：

```js
plugin_manager({ action: "install_bundle", target: "dsh-deep-ptc-mode@1.7.3" })
// 也可从本地目录或安装包安装：
plugin_manager({ action: "install_bundle", target: "C:\\path\\to\\dsh-deep-ptc-mode" })
// 或 target: "C:\\path\\to\\dsh-deep-ptc-mode-1.7.3.tgz"
```

GitHub 地址：`github:lishize20040802-rgb/dsh-deep-ptc-mode`。该地址安装远端实际内容；本地升级不会自动发布到 GitHub/npm。

已有旧版时，安装同一个 bundle 即更新。从只有 persona 的旧版切到 1.3.0，需要宿主重新加载插件；桌面端若未出现设置卡片，可重新打开应用。安装不会将其他新任务的默认模式改为深度 PTC。

设置持久化到当前 profile 的 Cordis patch：

```yaml
- id: deep-ptc-settings
  config:
    environment: wsl        # auto | wsl | powershell | zsh | bash
    wslDistribution: Ubuntu # 留空为 Windows 默认发行版
```

优先使用界面保存，宿主会处理版本冲突和原子配置写入。

## 兼容性与维护

Deep PTC 在加载时依据已安装 Harness 声明的 PTC 预设（`@deepseek-ai/dsh-web-app/presets/ptc.patch.yml`）现场组合：官方行原样继承，仅替换 persona 文本、把两个互斥 shell 工具换成一个带 `shell` 隔离的执行组、加入可达性守卫，并包装官方 job 与提问工具。包装层和执行组自身不写死任何官方模块名：加载的都是官方行里写的模块（shell 执行器取自基础部署声明 `@deepseek-ai/dsh-base/cordis.patch.yml`），并沿用官方配置。官方怎么改 PTC，本模式无需发版即可继承；官方改名或删除的模块也不会留下失效行。所选执行环境无法对应到官方行时，保留官方 shell 行并在日志中说明。只有在该声明无法解析、读取或解析失败时，才退回内置的 `lib/preset.json` 快照，并在日志中说明。

官方声明通过宿主运行时解析，因此插件静态引用的宿主包都必须声明在 `peerDependencies` 中（包括 `@deepseek-ai/dsh-web-app`）：对 `link:` 本地安装，宿主只有看到 peer 声明才会把这些包名路由到已安装运行时。漏声明时 `npm run check` 会失败——这正是避免本地安装静默退回快照的关键。`compatibility.json` 记录 fixture 所取自的上游版本及其哈希；`npm run check` 会验证内置回退快照与 fixture 仍组合出同一预设，并检查继承不变量。`engines` 是安装下限，不能证明之后所有宿主都经过测试，遇到新版本先用 `npm run check:upstream -- <path>` 复核。

```sh
npm ci
npm run check
npm test
npm run check:upstream -- /path/to/ptc.patch.yml
npm run sync:snapshot                      # 从已安装声明刷新 lib/preset.json 与 lib/base-snapshot.json 回退快照
PTC_RUNTIME_MODULES=/path/to/dsh/node_modules node scripts/check-preset.cjs  # 用真实运行时检查每行模块可解析
PTC_RUNTIME_MODULES=/path/to/dsh/node_modules node scripts/check-reachability.mjs  # 用真实运行时验证可打断等待
npm pack
```

检查器把 `!!js` 当数据解析，并断言派生不变量：除 persona、shell 行与两个包装行外，官方行必须原样保留（官方把它们嵌进 group 时也同样处理）；行 id 唯一；九种平台/环境组合下派生结果确定。测试同时覆盖未来可能出现的组合变化（新增未知行、调整行顺序、删除 shell 行或包装行），以及平台选择、命令边界、受限 WSL 拒绝、设置表单原子保存及并发版本约束。真实任务评测仍应记录成功率、无必要提问、范围控制、后台收尾和耗时。

## 文件和卸载

- `cordis.patch.yml`：宿主设置入口。
- `lib/index.mjs`：配置 schema、preset 注册和版本切换。
- `lib/model.mjs`：平台选择、参数、隔离配置和环境说明，以及从官方声明派生 preset。
- `lib/executor.mjs`：继承基础部署声明里的官方 bash 执行器，实现 WSL/Zsh。
- `lib/terminal.mjs`：运行官方声明指定的 shell 工具，等待可被用户消息打断，并提供 Zsh 方言与工具名。
- `lib/jobs-tool.mjs`、`lib/ask-user.mjs`：运行官方声明指定的 job 工具与提问工具，等待可被用户消息打断。
- `lib/host.mjs`：通过已安装运行时解析这些官方模块。
- `lib/guard.mjs`、`lib/rules.mjs`、`lib/sleep-lint.mjs`、`lib/reachable.mjs`：拒绝长暂停与轮询的工具守卫，以及可打断等待的实现。
- `lib/client.js`：中英文设置卡片。
- `lib/upstream.mjs`：定位并解析已安装的 PTC 声明。
- `lib/preset.json`：persona，以及仅在声明不可用时的回退快照。
- `test/`、`scripts/check.mjs`、`compatibility.json`：回归与上游差异检查。

卸载使用插件管理器的 `remove_bundle`，目标为 `dsh-deep-ptc-mode`。本地 link 安装直接依赖源目录，应先卸载再删除目录。

## 作者

深度PTC模式由 [lishize20040802-rgb](https://github.com/lishize20040802-rgb) 编写与维护。

- 问题与需求：[GitHub Issues](https://github.com/lishize20040802-rgb/dsh-deep-ptc-mode/issues)
- 邮箱：lishize20040802@gmail.com

上游 DeepSeek Harness 本身的问题请提到 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。


实际边界：暂停检测识别命令位置和真实等待，字符串、注释、普通定时器回调不当作暂停；可解析常量和乘积，未知时长放行。`wsl -- sleep 20` 会真实暂停，仍拒绝。静态检测不是完整语言解释器。任意 `run_code` 程序、同步子进程或长 workflow 内部的等待，目前不能保证被插话提前结束；这类长工作应使用宿主受管理的后台任务。官方工具无论失败多少次都不隔离，旧错误记录也不应阻断它们；来源不明的工具保持可用，只对来源明确的外部工具执行隔离。

1.7.3 优先读取正在运行宿主公开的官方 PTC 注册表；接口不可用时自动寻找实际安装的声明文件，只有这些都不可用才使用带告警的快照。注册表、声明内容或本插件配置变化会自动更新新预设；来源缓存也会随模块文件变化失效，不按预先固定的 DSH 版本选择工具清单。旧会话持有的执行环境和任务不会被强切换。
