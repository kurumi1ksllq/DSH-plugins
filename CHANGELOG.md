# CHANGELOG

One repository, eight independently versioned bundles. Every entry names the
bundle it belongs to; the tag on each release is `<package-name>@<version>`
(for example `dsh-inventory@0.2.0`).

Version discipline (enforced by `node scripts/check-bundle-versions.mjs`, wired
into `pnpm verify`): **changing a bundle's code requires bumping its version**.
A bundle whose directory has changes after its version tag fails the gate.

## Unreleased

### dsh-inventory 0.12.1 — 工具管理页 UI 细节打磨(#170)

- **修复「交互反馈从未生效」**:控件底色/文字色/位移原先写在内联样式里,优先级高于样式表,导致 `STYLES` 里三条 `:hover`/`:active` 规则(开关按压、隐藏按钮悬停、导航悬停)一秒都没执行过。现按 `inv-chip` / `inv-chip-on` / `inv-primary` / `inv-link` / `inv-ctrl` / `inv-hide` 类基态承载外观,内联只留尺寸与排版;开关滑块位移改用自定义属性 `--inv-x`,按压缩放 `scale(0.94)` 才能叠加。
- **焦点可见性(WCAG 2.2 SC 2.4.11)**:焦点环不再给所有元素强塞 `border-radius: 10px`(会把胶囊开关、导航项的环画错形状);卡内行改为内嵌 `outline-offset: -3px`,不再被 `overflow: hidden` 裁掉半圈;提示词编辑器补焦点态与 placeholder 颜色。
- **排版**:标题 `text-wrap: balance`、说明与行副标题 `text-wrap: pretty`;徽标数字补 `tabular-nums`;次级文字去掉叠在弱色上的 `opacity: 0.75`(对比度 ≈3.0:1 → ≈4.8:1);面板根补字体平滑。
- **控件质感**:骨架屏改 shimmer(reduced-motion 下静态);开关轨道内描边、滑块阴影收敛;开关与图标按钮用伪元素扩命中区;搜索框聚焦抬升 + caret/placeholder 着色;滚动条细化与 `::selection`;卡片改分层 label 色阴影;警示条同色系描边与着色图标;圆角收敛为 10/8/999 三级;「已隐藏技能」只弱化文字不弱化开关。
- **测试**:新增 `test/ui-detail.test.mjs`(6 条公开行为契约:焦点覆盖、焦点环形状、状态属性归 CSS、reduced-motion 覆盖、禁 `transition: all`、排版契约),删规则即红;渲染桩抽到 `test/support/react-runtime.mjs` 共用。
- **边界**:布局、栏目、文案、宿主 API 均未改;MCP 行徽标溢出裁掉行尾开关属断行问题,留后续 issue。

### dsh-deep-ptc-mode 1.13.1 — 缺依赖时按前置跳过(#167/#168)

- 新增 `test/support/prerequisites.mjs`：ESM 优先、CJS 兜底探测可选前置，skip 时给出可操作理由。
- 新增 `test/prerequisites.test.mjs`：探针双向自检——能解析的必须报「有」，解析不到必须报「缺」。恒返回理由的探针会静默跳过所有套件而门禁仍绿，这两条断言就是防它。
- `settings-ui` / `tool-controls-ui`：缺 `react`、`react-test-renderer` 时以一条 skip 呈现，而不是加载期崩溃。
- `upstream`：17 条里 15 条需要 YAML 解析器，缺 `js-yaml` 时跳过；另外 2 条（peer 声明检查、指向性验证）照常运行。
- `execution`：3 条 composition 用例读仓库内 fixture，前置收窄为 `js-yaml`，不依赖「已安装宿主声明」（那是 peer，CI 不装）。
- 根 `test/verify-clean.test.mjs`：只把 `node_modules` 那一条断言改成条件（附 diagnostic），泄漏检查照常运行。
- 效果：无依赖 worktree 里 deep-ptc 177 测 / 153 过 / 0 红 / 24 跳过；依赖齐备时 177/177 全过、零跳过；仓库契约两种环境都是 87/87。
### dsh-skill-surface 0.1.1 — 不再挂第二个 tool-skill(#160)

- **修复 #159 上线事故**：宿主平面重复挂载官方 `tool-skill` 会让被遮蔽的实例发布"空目录替换消息"，把 standard/ptc 会话的 270 条技能目录清空。本版删除该行，并加回归断言禁止再次出现。
- **只补发现**：保留官方 `dsh-skill-filesystem` 于 global 层，改用独立 `providerName: skill-surface-filesystem` 消除跨层同名歧义。
- **加载通路改为自持**：新增 `skill_get`（不带参数列目录、带名字取正文）与一段 `systemPrompt.context` 提示；两者都硬判 `ctx.tools.get('skill', agent)`，已有官方 loader 的 agent 完全不受影响。
- **保留**：`skills: a, b` 派活握手与既有注入预算/去重行为不变。

### dev-flow 0.6.1 — bundle patch 写成「修改」形态,两行插件从未挂载(#161)

- **根因**:`cordis.patch.yml` 用裸 `- id: dev-flow`(patch 层语义=修改已存在的行),而这两行是新增行;宿主 `applyEntryPatches` 报 `entry "dev-flow" not found` 后 `continue`,于是插件从未运行:#154 的常驻契约与 `git-status` 面板因此静默失效。(技能目录里搜不到 dev-flow 是另一条独立死因——当时的死链;0.6.0 起已无 skill 注册路径,不在本 issue 解释范围。)
- **修复**:改为 `- insert:` 形态(与其余 7 个 bundle 一致)。
- **回归守卫**:`test/patch-form.test.mjs`(形状,任何环境都跑)+ `test/patch-mounts.test.mjs`(宿主真实 `applyEntryPatches`,含裸行负例、insert 不去重用例)。改回裸行 → 本机 3 条红;无宿主树的环境为 2 条(语义用例 skip 并打 diagnostic)。
- 新增跨 bundle 守卫:`scripts/verify-packages.mjs` 对任何 bundle patch 里「裸 `- id:` 且无任何覆盖键」的行报错(patch 层会把它当修改,新行静默消失);带 `allow-bare-row` 豁免。
- 行 id 与包名不变;契约/lint/FLOW.md 内容未改。

### dsh-deep-ptc-mode 1.13.0 — 更名接线:镜像契约测试路径与注释指向 dsh-task-dispatcher(#153)

- 随 dsh-auto-delegation → dsh-task-dispatcher 更名,delegation-whitelist 测试与 model.mjs 注释里的跨包路径同步;无行为变化。

### dsh-skill-surface 0.1.0 — 官方 skill 目录与加载器补挂到宿主平面

- 新 bundle:把官方 skill 目录与加载器补挂到宿主平面(无 skill 能力的 preset 也能用);委派时支持 `skills: a,b` 点名注入。

### dev-flow 0.6.0 — 规则常驻注入:不再当技能,流程只留两次交互(#154)

- **常驻契约**:`index.js` 改为向 `systemPrompt.context` 注册 `dev-flow:flow-contract`(order 21050,紧随执行纪律 20000 与委派纪律 21000,`required: true`),不再调用 `ctx.skills.register`。实测改动前会话技能目录 270 个、dev-flow 不在其中(原因未定;`~/.dsh/skills/dev-flow` 是死链)。无论原因是目录过滤还是行未激活,「先调用 skill」都没有机制保证。
- **面板文案同步**:`need_*` 六处改为不要求用户裁决(CI 红=已停止重推、review=agent 正在逐条裁决),`boardSkillHint` 更名 `boardFlowHint`,并新增 `test/assembly.test.mjs` 用宿主真实 `SystemPrompt` 验证组装里确实有这段契约。
- **两次交互**:停点从 3 个砍到 2 个——意图确认(大白话,`ask_user_question`)与合并确认。分级、裁剪、无 CI(自动补 workflow)、CI 红(自修≤2 轮后不合并)、review 裁决、spec 变更全部改为 agent 自决并留证,不再让用户拍板。
- **单一真源**:`SKILL.md` 改名 `FLOW.md`(语义不再是 skill),契约文本只给绝对路径;详细规程(TDD、双轴 review 模板、状态文件、分支保护)仍在包内按需读。
- **lint 双契约**:`lintFlowDoc`(章节 + 禁用措辞「用户点头 / 必须用户明示 / 双保险」)+ `lintContract`(常驻硬句 + 70 行上限);顺带修掉章节重复检测漏 `g` 标志的潜在漏检。

### ecc-agent-presets 0.1.0 — 收纳 133 个 ECC agent preset,默认不进 UI 名册(#151)

- 新 bundle:`cordis.patch.yml` 单个 `- insert:` 块原样迁入主 profile patch 的 133 个非常用 `preset-*` 行(YAML round-trip);不装/停用即从 4 个 UI 显示面消失,启用即整体回归。白名单 5 件套(planner/architect/code-reviewer/security-reviewer/build-error-resolver)保留在主 profile。

### dsh-deep-ptc-mode 1.12.0 — 委派白名单:derive 确定性给 spawn 侧 tool-subagent 打 allowedAgentPresets(#151)

- `DELEGATION_PRESET_WHITELIST`(lib/model.mjs,单一源):deriveDeepPtc 对 spawn 侧 delegation 行确定性附加 `allowedAgentPresets`(planner/architect/code-reviewer/security-reviewer/build-error-resolver),暴露 `subagent` 工具的 `agent_preset` 参数;check 门与 report 同步识别该扩展,官方快照保持原样。

### dsh-task-dispatcher 0.2.0 — 由 dsh-auto-delegation 更名(#153)

- **更名**:`dsh-auto-delegation` 0.1.0(已于 #152 发布并打 tag)更名为 `dsh-task-dispatcher`——"任务调度器"直指行为(AI 拆解任务、按内容路由);行 id `auto-delegation` → `task-dispatcher`,部署侧 remove→install。注入段名(`dsh:auto-delegation-discipline`)、文本、order、路由表、白名单零变化;历史条目见 `dsh-auto-delegation 0.1.0`(下)。tag 纪律:旧 tag `dsh-auto-delegation@0.1.0` 保留不改写,本包 merge 后打 `dsh-task-dispatcher@0.2.0`。

### dsh-auto-delegation 0.1.0 — 委派纪律 + 子 agent 路由表 runtime-context 注入(#151)

- (历史,已更名 dsh-task-dispatcher)新 bundle:向会话所有成员(主 agent 与每个 teammate,经 composeFrom 继承组合同时生效)注入**一个** `systemPrompt.context`(`dsh:auto-delegation-discipline`),内含两节:①委派纪律(开工三问 + 分档表 + 队友向下委派授权);②声明式路由表(可委派 preset id → 职责),模型按子任务内容选 `agent_preset`。
- 路由表 preset id 与 `dsh-deep-ptc-mode` lib/model.mjs 的 `DELEGATION_PRESET_WHITELIST`(derive 期打点)preset id 双向镜像(契约测试守护);locale 暂为固定 zh(操作者工作语言,en 字典预留)。

### dsh-deep-ptc-mode 1.11.2 — 纪律文案单源化:zh 派生自 COPY 字典 + 谱系落盘(#144,PR #146)

- **纪律文案单源化**:execDisciplineText 的 zh 分支改由 governor-copy.mjs 的 COPY 双语字典拼装,EXEC_DISCIPLINE_TEXT 保留为 zh 基准常量;zh/en 同构(⓪–⑨ 条目一一对应)由 test/discipline-copy.test.mjs 契约守护。
- **谱系落盘**:仓库 AGENTS.md 增「纪律文本谱系」段(真源/注入机制 order=20000/上游 dsh-cot-anchor v0.4.2 仅存调研史/引入与演化提交链);全局 ~/.dsh/AGENTS.md 增检索纪律三条。

### dev-flow 0.5.0 — 停点交互改造:确认一律经 ask_user_question 在 DSH 内发起(#144,PR #146)

- **停点1/2/3 提问通道**:停点确认从「正文写一段等回复」改为 ask_user_question 卡片(可选项、推荐项前置标 Recommended);仅需求歧义等不适合选项化的情形退回正文。
- **merge 闸判定**:提问卡片明确点选「merge 本 PR」等同说出 merge 口令;点选暂缓/返工或跳过均不构成授权(#146 审查修正)。

### dsh-deep-ptc-mode 1.11.1 — #132 review 收尾:en 接线护栏/softStop 中文总结约定(#139)

- **en 接线源码护栏**:copy.test 钉死 governor-apply 15 处 settings.copyLocale 实参(删任一即红)。
- **en.softStopTail** 补「用中文总结」约定(en 与 zh 语义对齐)。

> 本段现有 15 个条目,全部已随各自 tag 发布;待下一次统一归档至 History 段。

### dsh-deep-ptc-mode 1.11.0 — governor locale 化:设置双字典/模型文案抽字典/copyLocale(#132,T4.ptc)

- **设置 schema 文案 {zh,en} 双字典**:SETTINGS_SCHEMA(41 个带 key 条目,含新 copyLocale)与 GOVERNOR_SETTINGS_SCHEMA(14 个带 key 条目)的 label/hint/group/options 全双语;客户端 pick() 按 navigator.language 选侧,默认 zh 与历史逐字一致。
- **注入模型文案抽字典**:新 lib/governor-copy.mjs(COPY,54 个文案位点 zh/en);render*/deny reason/soft-stop 收尾/外部软切引导/命令执行纪律块中文文案全部经 copy(locale) 取用,locale 参数默认 zh(默认行为零变化);检测器词表严禁翻义,未进字典。
- **新设置键 copyLocale**(zh/en,白名单回退):切换注入提示语言;select 枚举键不再被数值 clamp 吞掉(review 发现的真 bug)。
- **客户端 UI 壳文案双字典**:失速治理页签/能力横幅三态/高级折叠/保存与错误文案进 SHELL 字典。
- **zh/en 键集一致契约测试**(copy.test.mjs 7 用例;反向验证:删任一 en 键/schema en 值即红)。

### dsh-deep-ptc-mode 1.10.0 — git-bash 环境/auto 感知/notifyChannels 废弃/locale 基建/事件驱动刷新/设置原子写(#126,T4.ptc)

- **environment 枚举补 git-bash**(win32):ENVIRONMENTS/availableEnvironments/environmentText/UI 白名单与文案三处一致;复用 bash kind + lib-gitbash spawnSpec 改写。
- **auto 感知 tool 行**:pickToolKind 按官方 preset 实际存在的 shell 工具行选择 kind(powershell 环境缺 tool-pwsh 时回退 bash 行并如实记入 replacedShellRows),不再硬编码。
- **execution-environment 段接管 git-bash 说明**:environmentText 增 git-bash 描述(禁止再包一层 bash -c、禁止回退 WSL stub)。
- **notifyChannels 废弃**:设置项保留(label/hint 标注),拦截提醒实际总是经事件流;board/webhook/IM 从未实现。
- **5s 轮询事件驱动化**:loader/volatile-update 为主通道,兜底轮询 5s→30s(DSH_DEEP_PTC_POLL_MS 可调,下限 5s)。
- **governor 设置原子写对齐**:tmp+rename+0600(与 vault/audit 同口径);顺带修复 DSH_STALL_GOVERNOR_SETTINGS_PATH 覆盖时 mkdir 到了默认目录导致写失败的旧 bug;删 governor-core 死导入 writeFileSync。

### dev-flow 0.4.0 — review 裁决上墙/死键清理/触发词收窄/面板 skill 互指(#125,T4.df)

- **review pending-decision 上墙**:双轴 review 已出报告待裁决的 issue 进入"需要你出手"条(NEEDS_USER_KINDS 增 review-pending-decision,zh/en 文案);此前只静默停在 review 列。
- **死 locale 键清理**:删除双字典零消费的 `stashes` 键(面板 stash 计数用数据字段,非文案)。
- **触发词收窄**:SKILL.md 增"触发词收窄"——纯只读查询/状态询问/会话级操作不进流程;口径=不产生仓库文件写入。
- **面板↔skill 互指**:SKILL.md 头部引 Git 面板;任务板尾部增 boardSkillHint(zh/en)指向 dev-flow skill。

### dsh-websearch-failover 0.5.0 — example 补齐/SearXNG 鉴权/ABORTED 计数/冷却清理/resetStats/ALL_FAILED 引导(#124,T4.web)

- **providers.example 补齐**:serper/brave/bocha/jina/searxng 五家可直接复制启用(searxng 含 basic-auth 变体示例);core 新增导出 ADAPTERS(种类清单的公共事实源)。
- **SearXNG 鉴权变体**:`auth.type` = `basic`(usernameEnv/passwordEnv)/`header`(自定义 header 名)/缺省 Bearer,三种并存。
- **ABORTED 计数**:中止归属到在途 provider,core 把 aborted attempt 附到重抛错误上,index 记入 runtime `stats[].aborts`(独立计数,不混入 failures)。
- **冷却过期清理**:search 入口先剪掉过期冷却条目并持久化,面板不再显示僵尸冷却行。
- **resetStats**:`POST /websearch-failover/api/stats/reset`,`{ id }` 清单个/`{}` 清全部;runtime 新增 resetStats 运行时函数,读改写当前 runtime。
- **ALL_FAILED 引导**:全失败错误文本附 agent 可执行动作(检查/启用面板提供方、等待配额冷却)。

### dsh-inventory 0.12.0 — gate 搜索上限/同步失败记忆/远端 TTL/真超时中断/copySkill 冲突检测(#123,T4.inv)

- **searchParentLimit**(gate 配置新增,默认 Infinity=走到根,行为不变):限制 .dsh/mcp.json 向上搜索的父目录步数;0 = 仅当前目录。
- **serverName 唯一性守卫**:planMount 对 suffix 合并后的最终 serverName 做整声明去重(防御性不变量)。
- **sync 失败记忆**:lastFetchError/lastFetchErrorAt 持久化进 plugin-sync.json(成功清除),publicState 面板可见。
- **远端 TTL**:syncStatus 增 options.ttlMs,缓存上次成功 payload(fromCache/cacheAgeMs),默认 0 = 永远重新拉取。
- **真超时中断**:sync-remote 五个 fetch 点全部改为 AbortController——超时不仅放弃等待,还中止在途请求(旧 race 留下挂起连接,每次面板渲染堆积一个)。
- **copySkill 冲突检测**:vault 已有与仓库版本不一致的 skill 时拒绝静默覆盖(overwrite:true 显式放行);完全一致视为重装。
- 顺带修复:syncApply 注入 now 为数字时 lastPullAt 被静默丢弃(JSON.stringify 丢函数值)。

### dsh-credential-vault 0.6.0 — 凭据 TTL/reveal 审计防裁剪/export 归因(#122,T4.vault)

- **凭据级 TTL**(M1):set/update/api 接受可选 `ttlSeconds`(正整数或 null 清除),use 的 grant 以其封顶并在返回值报 `ttlSeconds`;note 附过期后重新 use 指引。存量无 TTL 记录行为不变。
- **reveal 审计防裁剪**(M6):trimAudit 保留全部 reveal 行(审计豁免 hatch 的意义所在),其余行按最近预算回填,时间序保持。
- **export 审计归因**(D5):export 审计行补 `filename`/`bytes`(请求本身仍无认证,已知限制不变)。
- **hint 规则补全**:envVar 以 use 返回值字段为准(ASCII slug/折叠 hash 后缀派生规则)、grant 过期重新 use。

### dsh-inventory 0.11.0 — client 按五挂载缝拆分为源码模块(#117)

- **client/ 源码分片**:4909 行单文件浏览器半按既有五挂载缝拆为 12 个有序源码分片
  (header/styles/shared-ui/workspaces/misc-ui/sync/vault/websearch/prompt/panel/apply/tail),
  以 scripts/build-inventory-client.mjs 拼回单文件 client.js — 宿主 dsh.client 单入口契约不变。
- **防漂移契约测试**:test/client-build.test.mjs 钉住"产物与分片字节级一致",改分片不重建即红。
- 行为零变更:491 项 browser-half 测试全数通过;行 id、路由、locale NS、VAULT_BASE/WEBSEARCH_BASE 原样。

### dsh-deep-ptc-mode 1.9.0 — governor 拆分为模块化结构(#116)

- **lib/governor.js 拆分**:5007 行单文件(约 250 个顶层声明)按声明块等价整块搬移为六个模块:
  governor-peer(惰性 dsh-llm peer 导入)/governor-core(§0 共享设施 + §1 G1/G2 判据)/
  governor-anchor(§2 软切基础层:能力探测、结论分析、锚点事件)/governor-settings(设置 schema 与
  各检测器运行期可调阈值)/governor-softcut(软切检测器群)/governor-apply(§4 装配 + 外部软切服务)。
  声明体逐字未改(生成器断言「文件头 + 声明块拼合 === 原文件」字节级成立);import 语句与每模块
  头注释为唯二新增。依赖图无环:peer/core/settings ← anchor ← softcut ← apply ← governor.js(装配,
  保留原文件头注释与单行 export 导出面,exports["./governor"] 指向不变)。
- 惰性 peer 导入段(顶层 await)落在 governor-peer.mjs,装配经 import 链先求值,不再占用装配文件;
  new Function 型测试装载(test-governor/eval-module.mjs)改为递归展开装配入口的 governor 模块导入,
  拼接产物经 node --check 验证语法有效。
- files 白名单同步列出六个 governor 模块。

### dsh-websearch-failover 0.4.0 — 布局标准化平铺(#118)

- **plugin/ 子目录提升包根**:index.js/client.js/cordis.patch.yml/icon.svg/locale 直接在
  packages/dsh-websearch-failover/(全仓唯一异构布局退役)。构建副本链退役:
  build-plugin.mjs、check-artifacts.mjs、install.mjs 及根 scripts 的
  build:websearch/check:websearch 引用删除——lib/ 即源码本体,无"副本新鲜度"问题。
- 包名不对称显式迁移:根 package.json name websearch-dsh-plugin → dsh-websearch-failover。
- engines.dsh 补声明。/websearch-failover/api 契约与状态文件格式原样。

### dsh-deep-ptc-mode 1.8.0 — 吸收 stall-governor 与 git-bash-tool(#112)

- **包数 7→5**。patch 七行:deep-ptc-settings 主入口 + bash/pwsh 四条覆盖行 + 两行 insert
  (id `dsh-stall-governor`/`git-bash-tool` 原样,name 指 `./governor`/`./git-bash` 子路径)。
- 宿主互操作设施全保留(upstream 继承/base-snapshot/snapshotSha256 链/黄金键 baseline);
  新增 optional peer dsh-llm/dsh-agent-loop;engines.dsh 取严。
- **已知边界**:governor 设置页客户端装载路径待部署实机验证;纪律⑤口径与 notifyChannels 处置在 T4.ptc。

### dsh-inventory 0.10.0 — 吸收 prompt-inject(#111)

- **包数 8→7**:dsh-prompt-inject 并入 dsh-inventory。行 id `prompt-inject` 保留,
  name 指 `dsh-inventory/prompt-inject` 子路径导出;/prompt-inject/state 路由、
  section(name demo:prompt-inject / order 3500 / interpolate:false)、验证令牌、
  持久化三级回退、VERIFICATION.md 全部原样。
- **locale 单一事实源落地(H3)**:prompt-inject 的 `prompt-inject` NS 死字典与其
  client 半区(编辑器早已用 inventory NS)不迁移——零消费死配置随包删除。
- 捆入修复:空白文本服务端校验(trim)、.bak 一代、413 应答后立即排空请求流;
  ifUpdatedAt 乐观并发未做,移后续票(#111 评论区裁决)。

### dev-flow 0.3.0 — 吸收 dsh-git-status,包名改 dev-flow(原子迁移,#110)

- **包名 `dev-flow-skill` → `dev-flow`**(owner 授权的红线例外):三点锁步
  (package.json ⇔ index.js export ⇔ patch 行 name)+ client 模块 id 同步。
- **吸收任务板面板**:git-status host/client/lib/测试全部迁入,行 id `git-status`
  与路由/locale/slot 契约原样;patch 第二行 name 指子路径导出。
- `dsh.client` 声明与 icon 原样保留(面板仍出现在侧栏)。
- 捆入:flow-state 契约测试拆 doc/reader 两文件;SHIPPED/EXPECTED/loads 等仓库引用
  全量改名;CHANGELOG 头计数与各文档计数收口。



## History

> 归档说明(2026-11-09,#149):原第二个 Unreleased 段(#96-#105 及更早的未归档条目,共 19 条,由 7b17dea 引入)整体并入本段顶部;
> 其中 0.1.1/0.3.1 两条与当时第一段逐字相同,删除第一段副本,各保留一份;下文 0.2.1 条目的「(unreleased)」字样系历史遗留状态标签,归档时一并去除。

### dsh-git-bash-tool 0.1.1 — confined 分支改写 + 存在性探测回退 (#105)

- **confined(沙箱)分支的 bash 改写此前静默失效**:沙箱把真实 argv 包在第一个
  `--` 分隔符后,旧实现只看 argv[0]。现在按位处理第一个 `--` 后的裸 bash。
- **Git Bash 缺失降级**:挂载时探测二进制,缺失告警并走 PATH 前置回退;
  `gitBashPath` 可注入(测试跨平台确定性);默认路径形状有断言防转义回归。

### dsh-websearch-failover 0.3.1 — refresh 并发互斥 (#104)

- **refresh 的 read-modify-write 互斥化**:两个并发 POST /api/refresh 在 probeBalance 的
  await 上交错,后写覆盖先写的余额读数。lib/runtime.mjs 导出 createMutex
  (promise 链,失败不毒化队列),refresh RMW 段串行化;reorder/setEnabled 为
  同步 RMW,无需处理。测试接线进 test 脚本(原先 test-mutex.mjs 不在清单里,CI 没跑过)。

### dsh-credential-vault 0.5.4 — 并发守卫/审计原子性/rotate 恢复/授权清除 (#103)

- **rotate 崩溃恢复真实可达**:rotateKey 先把重封好的 vault 落为 vault.json.new 再换 key,
  两个 rename 邻接;加载探针发现解封失败且 .new 可验证时才采纳,其它解封失败一律拒绝
  (杜绝误覆盖)。乐观守卫(vaultFingerprint)覆盖全部六条写路径。
- **审计日志**:trimAudit 改 0600 temp+rename;appendAudit fchmod 失败回退 chmodSync,
  仍失败告警一次(不再静默保持 0644)。
- **会话授权即时清除**:agent/disposed → grants.clear(sessionId)。
- 勘误:六条变更路径全部同步,进程内交错不存在;守卫防共享 $DSH_HOME 的第二宿主进程。

### dsh-inventory 0.9.2 — gate 快速挂载竞态修复 (#102)

- **workspace MCP 挂载在默认配置下整体不可用的根因修复**:late-fiber 兜底的
  mounted.has() 检查先于 mounted.set 入微任务队列,窗口内完成的挂载全部被当场卸载。
  mounted 条目改为 agent/created 预登记,快/慢/迟到 fiber 一律追踪;
  新增 agent/disposed 监听(agent 消失才 dispose 其 fiber);
  重复派发不再重置已追踪 fibers(0.9.2 追加)。
- 测试:4 条新红线(窗口内挂载存活/迟到挂载存活追踪/disposed 即时清除/重复派发不丢)。

### @local/dsh-prompt-inject 0.2.1 — 测试状态路径隔离 (T0.3/#100)

- 三个契约测试(§exports the host services / §defaults apply / §config overrides)此前直接读宿主真实 `~/.dsh/prompt-inject/state.json`,宿主存过自定义文本就红。现在包 `withTempProfile` 隔离。零产品改动;隔离后 23/23 全绿,且与宿主状态无关。


### dsh-credential-vault 0.5.3 — 宿主引用声明化 (T0.1/#98)

- `peerDependencies` 补 `@deepseek-ai/dsh-tools`(lib/define-tool.js 的 lazy require 此前未声明,违反 0 侵入 B 项)。行为零变化。

### dsh-inventory 0.9.1 — 宿主引用声明化 + 删 app.asar 兜底 (T0.1/#98)

- `peerDependencies` 补 `@deepseek-ai/dsh-mcp-client`;**删除** gate.js 的 `process.resourcesPath/app.asar` 私有路径硬拼兜底(只删未加:剩余两条尝试为 `config.mcpClientEntry` 与裸 specifier,均为既有路径)。Desktop 上 MCP 视图依赖宿主 resolver 覆盖该导入;未在 Desktop 实机验证,若视图降级需恢复该兜底或补 config 默认值。
- 仓库级新增 `test/host-deps.test.mjs`:运行时代码里任何 `@deepseek-ai/*` 字面量引用必须已在 package.json 声明。

### dsh-deep-ptc-mode 1.7.4 — 宿主引用声明化 (T0.1/#98)

- 补 13 个**可选** peer(`peerDependenciesMeta.optional`,dsh-session/dsh-skill/dsh-tool-bash/dsh-tool-pwsh/dsh-bash-local/dsh-bash-sandbox/dsh-pwsh-local/dsh-pwsh-sandbox/dsh-tool-jobs/dsh-tool-ask-user/dsh-persona/dsh-tool-executor-ptc/dsh-tool-skill)。全部沿用宿主解析 + fail-open,行为零变化。

### dsh-stall-governor 0.1.1 — 宿主引用声明化 (T0.1/#98)

- 补 2 个**可选** peer(`peerDependenciesMeta.optional`:dsh-llm、dsh-agent-loop,此前仅依赖元包声明)。惰性导入均 try/catch fail-open,行为零变化。


### dsh-stall-governor 0.1.0 — 失速治理单包双引擎(#96)

- 合并上游 dsh-cot-anchor v0.4.2 与 dsh-step-governor v0.2.2 为单一 bundle:共享装配、设置、client、事件设施。
- 保留:软切五判定器 + overLongCoT 兜底(probeKernelHook 三态门控)、INVALID_ARGS/ToolArgsError 恢复指引注入、命令执行纪律段(order 20000)、extractConclusions 提取器;G1-A 三子判据 + G1-B 指纹 + G1-C 硬顶、G2-A/G2-B + 目标键归一化 + 终态豁免、软停优先策略、`agent/soft-cut-suppressed` 高置信升级闭环。
- 砍掉:LLM 提炼 / CoT 采集(harvest)/ 学习模式(~800 行 + 1 路由;注入主路径移除后非现役能力,#96 §6-3)。
- 新 id:包名/行 id/`plugin:dsh-stall-governor`/路由 `/plugins/stall-governor/settings`/存储 `storages/stall-governor.json`/settings.section order 997;`ctx.provide("stallGovernor")` 合并两上游服务。
- G1 默认 shadow:agent/pre-step 与 goal 自动续跑驱动的并存顺序未经验证(#96 §6-2);deviation 自上游代码默认 g1g2,可经设置开启。
- governor 的 PENDING_DEPENDENCIES 摘除(soft-cut-suppressed 载荷契约由本包自持);watchdog 心跳机器移除(无真实 watcher 生态,预留 stallGovernor 两服务为接口)。
- 有界内存修复:governor 侧 fingerprintShingles(shingle 指纹桶)上游跨 turn 从未清理,合并后在 turn 边界与 fingerprintSteps 同口径清零(§3-9;churn/overLong 计数的 turn 清零上游 cot-anchor v0.4.2 已有,原样继承)。

### dsh-inventory 0.7.1 — 更新路由的测试不再改真实仓库

- **测试写生产状态的修复。** 插件页更新路由的 route 测试会真的跑 `git fetch`、写真实的
  `$DSH_HOME/plugin-update/last.json`,在 checkout 干净且落后时甚至真的 `git merge --ff-only`。
  一次测试运行就这样覆盖掉了用户真实的更新结果 —— 界面上那条「上次结果」其实来自测试,而不是
  用户的点击。
- apply 的全流程抽成 `performUpdate({repo, stateDir, respond, reconcile})`:仓库与状态目录
  都是参数,测试在临时仓库上跑;route handler 只负责命名真实仓库、真实状态目录和真实响应。
- 新增覆盖点 `DSH_INVENTORY_UPDATE_REPO`:为不常见布局(复制进来的 bundle、嵌套 clone)指定
  仓库,也让路由路径可被安全地端到端测试。仍会校验 `<root>/packages/dsh-inventory/package.json`
  的 name,不会对陌生仓库动手。
- `needsInstall` 改看**依赖字段**而不是"任何 package.json 变了":版本号 bump 不再触发一次
  `pnpm install`(它曾在没有依赖的 checkout 上失败并触发回滚)。

### dsh-inventory 0.7.0 — 插件页上的「更新」按钮

- **DSH 的插件页现在能直接更新本仓库的插件。** 每个 bundle 的详情页头部多一个
  「更新到 x.y.z」按钮,标题旁多一个「可更新 a → b」标签 —— 两个都是插件页自己的 slot
  (`plugins.detail.actions` / `plugins.detail.badge`),宿主包一行没改。不是本仓库的包
  → 两个 slot 都渲染 `null`,别的插件页零变化。
- **免重启生效**:更新后调 `ctx.get('hmr').runExclusive(() => hmr.reconcileProfile())`
  —— 这是 `dsh-hmr` 的 public API,也是 plugin-manager 自己用的那条路
  (`dsh-plugin-manager/lib/index.js:2366`)。没有 hmr 的 profile(headless/SDK)会如实报
  `restart-required/no-hmr`,不会自动重启。
- **点一个 = 整个 checkout 前进**(7 个 bundle 同处一个仓库),结果里列出所有变了的插件,
  不让用户以为只动了一个。
- **拒绝先于动手**:工作树脏 / HEAD 不在分支上 / 无法 ff-only / 已经是最新 —— 四种情况都在
  动任何文件之前拒绝,因为重组合不是事务,失败不恢复。
- **先说后重组合**:更新的可能就是本插件,它会被重组合停掉,所以响应必须先在 `res.end()`
  里发出去。
- 新增路由 `/inventory/plugin-update`(GET 状态)与 `/inventory/plugin-update/apply`(POST)。

### Workspace / tooling — lockfile 与 CI 守卫

- **`pnpm-lock.yaml` 的 importers 与 `packages/` 重新对齐**:补上 `dsh-credential-vault`、
  `dsh-git-status`,去掉已删除的 `dsh-ctx-guard`。
- **CI 新增一步** `git diff --exit-code -- pnpm-lock.yaml`(在 `pnpm install` 之后):
  `pnpm install --frozen-lockfile` 在 importers 失配时会 **exit 0 却改写** lockfile,
  不比较就等于没装这道闸。契约按 step 顺序断言它(注释掉、挪到 install 之前、或加
  `|| true` 都会红)。

### dsh-git-status 0.2.2 — remotes survive a mirror

- **面板的仓库链接不再被 `insteadOf` 破坏。** `remotesOf` 原来读 `git remote -v`,那条
  命令输出的是 `url.<base>.insteadOf` **改写后**的地址:配了镜像的机器上,面板收到
  `https://mirror/…/https://github.com/me/repo.git`,解析不出 `owner/repo`,GitHub 链接
  因此失效(本机 `~/.gitconfig` 就踩到了,连测试都跟着假红)。现在改读
  `git config --local --get-regexp '^remote\..*\.url$'`,拿仓库里真正写的值。
- 测试:`url.<x>.insteadOf` 存在时仍然返回原始 URL,且 `slugFromRemoteUrl` 能得到
  `me/repo`;把实现退回 `git remote -v` 即红。

### dev-flow-skill 0.2.1 — the dual-axis review prompt now actually ships

- **停点3 的双轴 review 有了可复制的模板。** 原文写「用下面的**固定 prompt 模板**」,
  但下面只有几条要求 bullet、没有可复制正文,于是每次 review 都靠执行者临场重建,两条轴
  随会话漂移。现在模板正文以代码块落在 `SKILL.md` 里(轴1 对 spec、轴2 对规范),含
  「原文照抄、不得即兴改写」「只报告不修改任何文件」「至少 3 个问题,确实找不到就写
  未发现问题」。
- 契约 `test/review-template.test.mjs`:两条轴**各自**切区间校验(不能靠另一条轴的文字
  蒙过),并要求模板声明「不得即兴改写」;删掉任一条轴的要求即红。

### dsh-credential-vault 0.2.1 / dsh-inventory 0.5.0 — vault joins the Tools page

- **"Leave empty to keep the stored secret" now actually works.** The editor always
  sent an empty secret when only metadata changed, and the host rejected it with
  400. `/set` now keeps the sealed value for an existing entry, and still refuses
  to create one without a secret.
- **Cancelling a delete or rotation is a no-op again.** The confirmation ran inside
  the busy wrapper, so cancelling still reloaded the panel and cleared the error
  message the user was reading.
- **Error responses never forward `error.message`.** A future throw that
  interpolated secret material would have gone straight onto the wire.
- The three bundle client halves are now dictionary-only: the migrated sidebar
  panels (Icon/Page/styles, ~860 lines total) are deleted rather than left behind
  as a second, unowned copy of the same UI.

- The credential manager moved into `dsh-inventory`'s 工具管理 panel, right next
  to the `credential` tool it backs: a 「凭据保险库」 segmented tab plus a
  collapsible overview section (masked list, detail card, add/edit form with
  "leave empty to keep the stored secret", delete, master-key rotation, reveal
  audit log). Same routes, same guarantees — no route returns plaintext, and the
  panel only ever renders the masked `preview`.
- `dsh-credential-vault`'s client half now registers **only its locale
  dictionary** (`inject: ['locale']`); the host half (vault store, `credential`
  tool, audit log, API) is untouched. With web-search providers and the prompt
  editor, all three former sidebar panels now live on one page.

### dsh-inventory 0.4.0 / dsh-websearch-failover 0.3.0 / @local/dsh-prompt-inject 0.2.0 — UI consolidation

- **The web-search provider manager moved into the Tools page.** Sidebar entries
  `websearch-failover` and `prompt-inject` are gone; both sections now render
  inside `dsh-inventory`'s 工具管理 panel, each with its own segmented tab
  (「Web 搜索提供方」/「提示词注入」) and, on the overview, a collapsible section at
  the top. "Tools" is the page that answers what the agent can reach, so the
  order and balance of the providers that answer `web_search` — and the text
  injected into every system prompt — are edited next to the tool list they
  control instead of in two more sidebar rows.
- The provider section was rewritten in the panel's own visual language
  (grouped inset rows, iOS switches replaced by the shared chips/row controls,
  hairline detail card). Behaviour is unchanged: priority order by drag or
  arrows with optimistic update + rollback, balance bars per billing unit,
  cooldown countdown, per-provider enable/disable, `/refresh` only on an
  explicit click (balances are billed per call), and the prompt editor keeps its
  local empty-text guard.
- The two bundle client halves now register **only their locale dictionaries**
  (`inject: ['locale']`, no `sidebar.panellist` / `main` registration), so a
  profile can no longer end up with three sidebar rows for one settings area.
  Their host halves are untouched.
- Tests: `dsh-inventory` gained two browser-half tests that drive the provider
  section (balance units, detail reset rule, arrow reorder POST, refresh-all) and
  the prompt section (load, save, empty-body rejection) against the real routes;
  the two bundles' client tests were rewritten for the new
  dictionary-only contract.

### Workspace / tooling

- **Build-freshness gate (D2).** New `scripts/check-artifacts.mjs` verifies the
  `plugin/lib/` of every copy of a bundle that a DSH profile actually loads — not
  just the copy in the current checkout. It resolves `link:` targets out of
  `$DSH_HOME/profiles/*/node_modules`, so a bundle rotting in a *different*
  checkout can no longer pass while the running copy is stale.
- **Tests no longer repair the artifact they test.** `test-host-plugin.mjs` and
  `test-integration.mjs` used to copy `lib/*.mjs` into `plugin/lib/` before
  booting the bundle, which silently healed a stale build and made it
  undetectable. They now assemble a probe bundle in a temp directory
  (`test/probe-bundle.mjs`) and import that; the checkout is never written to.
- **Profile wiring check (P1-5).** New `scripts/check-profile.mjs` — read-only.
  Resolves every linked bundle, records the checkout and commit behind it, and
  reports bundles served from another checkout as warnings (today: 4 of 6 —
  see D1). Dangling links and missing entry points are hard failures.
- **Packaging discipline (P1-7/P1-8/P1-9).** New
  `scripts/check-bundle-versions.mjs` requires `engines.dsh` and a `test` script
  on every bundle, and rejects code changes that did not bump the version.
  Added `engines.dsh: ^0.2.0` to all 8 bundles; `dsh-git-bash-tool` gained its
  first tests (6) and a `test` script, so `pnpm -r --if-present` can no longer
  skip it in silence.
- `pnpm verify` now runs four gates (packages, artifacts, profile, versions);
  `pnpm gate` = `verify` + `test`.
- **Transactional updater (L2).** New `scripts/update.mjs` (+ `scripts/update/`)
  implements the plan → fetch/stage → verify → swap → observe → rollback
  pipeline from `docs/update-scheme.md` §4.2. Deliberately **not** wired into
  `pnpm gate`: it mutates a live profile, so it is an operator tool, not a check.
  Highlights:
  - planning is per **link target**, not per repository — a profile can mix two
    checkouts of one monorepo (the live one does), so "the repo" is not a
    well-defined update unit;
  - verification runs entirely against the **staged** tree (bundle contract,
    generated-artifact freshness, entry importability, dependency additions,
    `dsh --dump-config` with empty stderr); nothing touches live code;
  - the swap is a single `renameat2(RENAME_EXCHANGE)` syscall, so no reader ever
    sees a missing package and the previous generation lands at the staging
    path as a free rollback copy;
  - `swap`/`rollback` are dry runs without `--confirm`, and a `restart required:`
    verdict is reported to the operator — the tool never restarts DSH;
  - `rollback` only exchanges a tree the journal proves holds the previous
    generation, and refuses once that exchange has already been undone.

### dsh-inventory — 0.2.1

- **Fleet manifest (v2).** Several machines can publish into one document;
  each publisher owns its own section (`{ fleetVersion: 2, machines: { id: … } }`)
  and readers flatten the sections back into the v1 view, so the diff/apply
  pipeline is unchanged. A legacy v1 file reads as a one-machine fleet.
- **Stable machine identity.** `machineId` is minted once on first read and
  persisted in the sync state, so a machine keeps its section across restarts.
- **Concurrent publish converges instead of clobbering.** Git writes that lose a
  race return `conflict`; HTTP writes send `If-Match` and report 412/409 as a
  conflict, so the caller re-reads the winner's document, re-merges its own
  section and retries.
- **"Not published yet" is no longer an error.** When every transport answers
  404 the manifest is reported as `notFound`, and the panel shows an empty
  fleet instead of a read failure — the normal first-run state. A transport
  crash is still an error: only an explicit 404 from every transport may claim
  the file is missing.
- **The status path is read-only again.** `syncStatus` no longer mints a
  `machineId` (i.e. writes the state file) just to render the panel.

---


Releases before this file existed were not tagged; the entries after this note
record what was then each bundle's current version, so the running instance is
at least described.

### dsh-inventory 0.2.0

- Gitee and self-hosted HTTP sync transports; `repoUrl` bootstrap.

### dsh-inventory 0.1.0

- Capability inventory, capability manifest, diff/apply, panel.

### dsh-websearch-failover (bundle 0.2.0 / repo root 0.3.0)

- Multi-provider web search with failover, balance-aware routing, and a live
  HTTP integration test. The bundle directory (`plugin/`) and the repo root
  (`websearch-dsh-plugin`) currently carry two different version numbers; the
  bundle version is the one the host loads. Reconciling them is tracked under
  P1-7.

### dsh-ctx-guard 0.1.1

- Context-usage guard rails; follow-up fixes over 0.1.0.

### dsh-credential-vault 0.1.0

- Encrypted credential vault with a single-row bundle patch and no config.

### dsh-git-bash-tool 0.1.0

- Windows-only: routes the bash tool through Git Bash so commands stop landing
  in PowerShell. Untested until the packaging gate added its first tests.

### dsh-git-status 0.1.0

- Repository status panel (issues #18–#22, plus two rounds of review fixes).

### @local/dsh-prompt-inject 0.1.0

- Injects a system prompt section; declares `systemPrompt` in `inject`.

### dev-flow-skill 0.1.0

- Development flow skill bundle.

---

<!-- 以下为 T0.2 依 git log 补写的历史发版条目(补记,原发版时漏记)。按 tag 时间升序。 -->

### @local/dsh-prompt-inject 0.1.0 — 补记(2026-11-02)

- · feat(gate): verify the code that is actually loaded, not the checkout · docs: workspace README, per-package test script, profile probe · feat: five DSH bundles in one workspace

### dev-flow-skill 0.2.0 — 补记(2026-11-03)

- · feat(git-status): 面板改造为 dev-flow 任务板 (#27)

### dsh-git-status 0.2.0 — 补记(2026-11-03)

- · feat(git-status): 面板改造为 dev-flow 任务板 (#27)

### dsh-git-status 0.2.1 — 补记(2026-11-03)

- · test(git-status): 把测私有函数的用例改成黑盒行为测试 (#33)

### @local/dsh-prompt-inject 0.2.0 — 补记(2026-11-03)

- · chore(tools-page): 文档死引用、补回三条编辑器测试、删死字典键、inventory 0.5.0 · refactor(tools-page): 删除迁移后残留的死 UI,并把测试断言搬去新家 · wip(tools-page): 导入已有 UI 整合改动(功能主体完成,收尾待修)

### dev-flow-skill 0.2.2 — 补记(2026-11-04)

- · fix(dev-flow-skill): 让 bundle 真能注册 skill,照 README 装不再崩 (#47) (#59)

### dev-flow-skill 0.2.3 — 补记(2026-11-03,SKILL.md 增补「实现阶段不得改写 spec」条款,#48 教训;该 PR 同时含 credential-vault 收口提交,主题串里出现属同一 PR)(2026-11-04)

- · fix(credential-vault): 收口 #49 审查遗留 8 项(#50 #52-#58) (#63)

### dsh-credential-vault 0.3.0 — 补记(2026-11-04)

- · feat(credential-vault): 规范化存储 + 模糊命中 + 零明文使用路径 (#41)

### dsh-credential-vault 0.4.0 — 补记(2026-11-04)

- · fix(credential-vault): 原型污染 + 元数据无校验（现存线上缺陷） (#49)

### dsh-credential-vault 0.4.1 — 补记(2026-11-04)

- · fix(credential-vault): 收口 #49 审查遗留 8 项(#50 #52-#58) (#63)

### dsh-inventory 0.6.0 — 补记(2026-11-04)

- · feat(credential-vault): 规范化存储 + 模糊命中 + 零明文使用路径 (#41)

### dsh-inventory 0.8.0 — 补记(2026-11-04)

- · feat(credential-vault): 导出/导入(口令加密信封 + 按 id 去重 + 面板与 CLI) (#64)

### dsh-credential-vault 0.5.0 — 补记(2026-11-04)
- · feat(credential-vault): 导出/导入(口令加密信封 + 按 id 去重 + 面板与 CLI) (#64)

### dsh-inventory 0.3.0 — 补记(2026-11-02,首个 tag)
- · feat(inventory): cross-machine sync, replacing dsh-plugin-sync(10-31)
- · fix(inventory+plugins): apply REVIEW-FIXES.md findings (P0-1..P2-14)(11-01)

### dsh-credential-vault 0.5.1 — 补记(2026-11-06)

- · test(credential-vault): define-tool 测试隔离改用 DSH_HOME(#68) (#83)

### dsh-credential-vault 0.5.2 — 补记(2026-11-06)

- · test(credential-vault): 文件 mode 断言加平台闸，Windows 上不再必挂 (#85)

### dsh-inventory 0.8.4 — 补记(2026-11-06)

- · test(inventory): 补强工作区测试四处缺口(#71 #75) (#79) · fix(inventory): 合法空声明在面板显示为正常空态(#74) (#78) · fix(inventory): 默认工作区写路径与视图对称(#72) (#77)

### dsh-inventory 0.8.5 — 补记(2026-11-06)

- · fix(inventory): MCP 全局开关写入定义该 id 的 patch 层 (#86)

### dsh-inventory 0.8.6 — 补记(2026-11-06)

- · fix(inventory): manager 分支前判层,home patch id 绕过 manager(#87) (#88)

### dsh-inventory 0.8.7 — 补记(2026-11-06)

- · fix(inventory): definedIds 识别 insert 嵌套定义，死覆盖条目不再毒化判层 (#90)

### dsh-deep-ptc-mode 1.7.3 — 补记(2026-11-07)

- · 集成上游 dsh-deep-ptc-mode@1.7.3 为第八个 bundle (#95)

### dsh-inventory 0.9.0 — 补记(2026-11-07)

- · dsh-inventory: 工具管理面板改左侧栏导航(master-detail)布局 (#92)
