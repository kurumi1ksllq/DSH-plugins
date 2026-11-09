# governor locale 化:设置双字典 + 模型文案抽字典(#132)

来源:plugin-consolidation.md §4 Phase 4 / T4.ptc 拆分(自 #126 拆出,~200 键)。分级:standard。

## 现状(已实测核实)

**A. 设置 schema 文案(纯中文硬编码,共 65 项 schema)**
- `lib/governor-core.mjs` GOVERNOR_SETTINGS_SCHEMA(14 项,23 label/hint/options/group 文案)
- `lib/governor-settings.mjs` SETTINGS_SCHEMA(40 项,42 label/24 hint)
- 消费方:**唯一**是 governor 客户端半区(`lib/client.js` 第二模块 dsh-stall-governor 壳),经 GET `/plugins/stall-governor/settings` 拿 `schema[]`,直接渲染 `spec.label/hint/group/options[].label`(`spec.label || spec.key`)。客户端无 locale 注入(`exports.inject = ['slots']`),全部文案中文写死。
- 设置路由在 `governor-apply.mjs:757` 起,GET 返回合并 schema。

**B. 注入模型的文案(render* 系列中文写死)**
- `governor-softcut.mjs`:11 个 render 函数(renderRepeatAnchor/renderNumberRunawayAnchor/renderNGramLoopAnchor/renderPseudoToolAnchor/renderToolArgsErrorAnchor/renderChurnAnchor/renderActionChurnAnchor/renderOverLongCoTAnchor/renderOverLongEscalation/renderChurnEscalation 等)
- `governor-anchor.mjs`:renderAnchor(已是英文)+ EXEC_DISCIPLINE_TEXT(命令执行纪律,纯中文)
- `governor-apply.mjs`:EXTERNAL_ANCHOR_PREFIX/FALLBACK、semantic-stall-2 与 G2 deny reason、G1 soft-stop 收尾指令(「已到本回合收尾边界…」)

**C. 检测器词表(严禁进字典)**
- CONCLUSION_OPENERS/WEAK_SENTENCE_PATTERNS/CHURN 词表等:检测逻辑本身,翻义即失效。**不动**。
- issue 中的 NOT_LOCALE 标记在 .tmp/audits/t4ptc-survey(现为空文件),以本 spec C 项为准。

**D. 客户端 UI 硬编码文案(第二模块内)**
- section label「失速治理」、标题「失速治理」、能力横幅、错误/保存状态文案(「读取设置失败」「保存失败」「已保存并即时生效」等)、组名兜底「其他」。

## 方案

### ① 设置 schema 文案双字典
- schema 数组拆两层:`key/type/min/max/step/advanced` 等结构字段保留;文案字段(label/hint/group/options[].label)改为 **{zh, en} 对象**。
- GET 路由返回的 schema 不变形态(仍是数组,文案字段值为 {zh,en});**客户端选 locale 渲染**:governor 客户端半区 inject 增加 `'locale'`,注册 `dsh-stall-governor` NS 双字典(UI 壳文案 D 项),并加 `pick(dict)` 帮助函数——按宿主 locale.bind 不适用于纯数据对象,客户端以 `ctx.locale` 现有机制为准:优先读 slot spec 的 `locale` NS(`label: () => t('title')` 先例,inventory/dev-flow 已用),schema 内联 {zh,en} 由客户端按同一 NS 的语言选择器取值(宿主 locale NS 无公开「当前语言」查询,以 settings.section slot spec 增加 locale 字段 + 客户端字典渲染实现,语言判断用 `navigator.language` 前缀 `zh` 判定,与宿主行为一致的近似)。
- `test-governor/settings.test.mjs`:54 项断言不变;新增「每个 schema 项的文案字段含 zh 与 en 同键集」断言。

### ② 模型文案抽字典(locale 参数化,默认 zh)
- 新文件 `lib/governor-copy.mjs`:导出 `COPY` 双字典(zh/en,键 = 文案位点)与 `copy(locale)` 取用函数。
- render* 系列与 EXEC_DISCIPLINE_TEXT、EXTERNAL_ANCHOR_PREFIX/FALLBACK、deny reason、soft-stop 指令全部改为从 COPY 取值(模板插值保留)。
- **locale 参数默认 zh**:`render*(x, locale = "zh")`;调用链从 settings(`CONFIG` 或 settingsSnapshot)读 `copyLocale`(新设置键,默认 zh,options zh/en)。**默认行为零变化**(现有全部测试在默认 locale 下必须全绿)。
- en 文案按各 render 函数中已有的英文括注句翻译补充(已是英文的 renderAnchor 不动)。
- EXEC_DISCIPLINE_TEXT 属注入模型文案,进 COPY(en 翻译提供);检测器词表(C 项)一律不动。

### ③ client.test 增 zh/en 键集一致断言
- `test-governor/client.test.mjs` 或新建 `test-governor/copy.test.mjs`:COPY 的 zh/en 键集一致;settings schema 文案字段 {zh,en} 键集一致(对 GOVERNOR_SETTINGS_SCHEMA + SETTINGS_SCHEMA 逐项断言)。

### ④ 客户端 UI 文案(D 项)进 client.js 现有双字典机制
- governor 壳注册自己的 locale NS(`dsh-stall-governor`),UI 硬编码文案(失速治理/错误/保存状态/其他)进双字典;`repo 级 locale-contract.test.mjs` 的 BUNDLES 断言按现写法(匹配 `zh: {`)继续覆盖(第二模块已有 zh:/en: 结构,契约测试已兼容)。

## 边界

- 只动 `packages/dsh-deep-ptc-mode`(`lib/governor-{settings,core,anchor,apply}.mjs`、新 `lib/governor-copy.mjs`、`lib/client.js`)+ 其测试;不动其它包、不动检测器词表、不动宿主。
- **默认 locale=zh,所有现有测试不改语义即绿**;en 只是补齐能力。
- 不实现宿主级「当前语言」查询(宿主 locale API 无此公开面);客户端语言判定用 `navigator.language`,server 端 copyLocale 走设置键。
- schema GET 形态不破坏既有消费者:54 项数量、键名、settings/defaults 键集不变(只改文案字段值类型)。
- 版本纪律:改动包升 patch(dsh-deep-ptc-mode 1.10.0 → 1.11.0),合并后打 tag。

## 验收

1. settings GET 返回的 schema 文案字段全部为 {zh,en} 且 zh/en 同键集(测试红→绿);54 项/键名/settings 键集断言保持绿。
2. governor 客户端在 zh 环境渲染文案与现状逐字一致(现测试快照/文本断言全绿);en 环境渲染 en 值(新增断言)。
3. render*/deny/soft-stop/纪律块文案在默认(zh)下与改前逐字一致(全部现有测试零修改语义通过);copyLocale=en 时产出 en 文案(新增断言)。
4. zh/en 键集一致测试(COPY + schema 文案字段)入库,红→绿可反向验证(删任一 en 键即红)。
5. 四件套:pnpm test 全绿(node 24 语义,本机 v18 跑不了该包则以 CI 为准,不伪造本地绿——循 spec §5 环境约束)、pnpm verify(隔离 DSH_HOME)全绿、CI 绿。

## Tickets(有序)

| # | 标题 | 说明 |
|---|---|---|
| 1 | lib/governor-copy.mjs 双字典 + render* locale 参数化 | COPY zh/en;render* 加 locale 参数默认 zh;调用链读 copyLocale 设置键;zh 逐字一致性靠现有测试验证 |
| 2 | 设置 schema 文案 {zh,en} 化 | 65 项 schema 文案字段改双字典对象;客户端 pick 渲染 + UI 文案 D 项进 NS;settings.test 增键集断言 |
| 3 | zh/en 键集一致契约测试 | COPY + schema 文案字段双向断言(红→绿反向验证) |
| 4 | 版本 + 四件套收尾 | 1.11.0;pnpm test(CI 为准)/verify 隔离跑全绿 |
