# issue-170 — dsh-inventory 页面视觉细节打磨（不改布局）

**分级：standard**（多文件：client/20-styles.js + 若干 class 钩子 + 新增测试 + 版本号）

## 目标

按用户确认的口径「延续现有 Apple grouped-list 风格、只把细节补齐；允许更明显一点的质感（阴影/层次/动效）」，
打磨「工具管理」页的 **UI 细节**。布局（栏位结构、rail 宽度、卡片分组、行顺序）与功能一律不动。

判据来自三个设计 skill：`make-interfaces-feel-better`（同心圆角 / 分层阴影 / text-wrap / tabular-nums / 按压反馈 / 命中区）、
`accessibility`（WCAG 2.2：焦点外观 2.4.13、焦点不被遮挡 2.4.11、目标 24×24 最小且意图 ≥40、对比度、缩放不丢功能）、
`design-system`（token 一致性 / 深浅色完整度 / 动效克制 / 交互态与空态覆盖）。

## 边界（做什么 / 不做什么）

做：

1. **交互态覆盖**：给目前只有内联样式、没有任何 `:hover`/`:active` 的元素补 class 钩子与状态 —— 分段控件与 chip（`S.chip`）、
   实心主按钮（`S.primary`）、行内文字按钮（`S.linkBtn`）、优先级控制按钮（`S.rowCtrlBtn`）。按压用 `scale(0.96~0.97)`，按 skill 要求可被 reduced-motion 关掉。
2. **焦点环修正**：现有 `:focus-visible` 规则统一写 `border-radius: 10px`，会把 51×31 的胶囊开关、8px 的 rail 项、
   卡片内 row 的焦点框画成错误形状；改为按元素给形状/偏移，并保证焦点环在卡片背景上对比度 ≥3:1。
3. **排版节奏**：标题 `text-wrap: balance`、说明与行副标题 `text-wrap: pretty`；所有会变的数字（统计、计数、时间戳、进度）
   统一 `tabular-nums`；面板根补字体平滑（宿主未保证时）；行标题行高/字距微调。
4. **控件质感**：iOS 开关加轨道内描边与更干净的 knob 阴影；卡骨架屏改 shimmer（reduced-motion 下退化为静态）；
   spinner 对比度与线宽；搜索框 placeholder / caret / 取消按钮；滚动条细化；`::selection`。
5. **层次**：卡片用两层阴影（近距接触阴影 + 远距环境阴影），深浅色都成立；warn / error / toast 加同色系淡描边。
6. **兜底**：`prefers-reduced-motion` 覆盖所有新加 transition/animation；`prefers-contrast` 与 `prefers-reduced-transparency` 补全。

不做（明确出界）：

- 任何布局/栅格/栏宽/行顺序/文案改动；任何数据或 host API 改动；不引入外部依赖或全局样式表；
- 不改宿主的 `html` 根（只作用于本面板根节点），不引入紫色渐变 / 玻璃拟态等 AI-slop 装饰；
- 不动 `inv-*` 既有 class 名（被测试与宿主样式引用）、不动插件 id / 行 id。

## 验收

1. 新增 `test/ui-detail.test.mjs`（只测公开输出，可反向验证）：
   - 渲染出的每个 `inv-*` 可交互元素，注入样式表里都有针对它的 `:focus-visible` 规则且设置 `outline`（删规则即红）；
   - 样式表里声明了 `transition`/`animation` 的每个 `inv-*` class，都在 `prefers-reduced-motion: reduce` 块内被覆盖（删覆盖即红）；
   - 样式表中不存在 `transition: all` / `will-change: all`（skill 硬规则）；
   - 面板输出里主标题 `text-wrap: balance`、次级说明 `text-wrap: pretty`、统计数字 `font-variant-numeric: tabular-nums`。
2. 在**仓库根**执行 `node scripts/build-inventory-client.mjs --check` 通过（client.js 与 client/ 部件一致）。
3. `pnpm test` / `pnpm verify` 全绿；`packages/dsh-inventory` 版本号按纪律上抬。

## tickets

| id | title | 说明 |
| --- | --- | --- |
| 1 | 交互态与焦点环 | class 钩子 + hover/active/focus-visible 重写，修焦点框形状 |
| 2 | 排版节奏 | text-wrap / tabular-nums / 字体平滑 / 行高字距 |
| 3 | 控件质感 | 开关、骨架屏、spinner、搜索框、滚动条、::selection |
| 4 | 层次与主题兜底 | 分层阴影、提示条描边、reduced-motion 覆盖、版本号 |

## 裁剪

不裁剪：standard 档全流程（TDD 红绿 + 双轴 review + CI）。

## 变更（实施中追加）

**1. 交互反馈的实现方式改了：状态属性必须离开内联样式。**

原计划只是"在 `STYLES` 里补 hover/active 规则"，实施时发现这条路整体失效：
浏览器内联 `style` 的优先级高于样式表，而本页几乎所有控件的 `background` / `color` / `opacity` / `transform`
都写在内联 token 里。结果 `STYLES` 里原有的三条反馈规则（`.inv-switch:active > span`、
`.inv-hide:hover`、`.inv-rail-item:hover`）从来没有生效过——这正是页面"点下去没反应"的根因。

因此改为：交互控件的外观属性（背景/文字色/位移）搬进 CSS 的类基态规则，内联只保留尺寸与排版；
开关滑块位移改用自定义属性 `--inv-x`，`transform` 交给 CSS，按压缩放才能叠上去。
新增测试里有一条专门守这件事：内联样式里再出现 `background` / `color` / `transform` 就红。

代价：`S.chip` / `S.primary` / `S.back` / `S.iconBtn` / `S.railItem` / `S.rowIconBtn` /
`S.rowCtrlBtn` / `S.linkBtn` / `S.searchWrap` / `S.skeleton` 这十个 token 不再自带底色，
底色由同名 class 提供——**渲染这些 token 时必须带 class**，否则控件会透明。
焦点覆盖测试会强制每个新 class 都有焦点态，减少漏挂。

**2. 测试基建小改：** 把 `test/client.test.mjs` 里的 React 渲染桩抽到
`test/support/react-runtime.mjs` 并导出，新测试复用同一套桩（避免两份会漂移的实现）。
`client.test.mjs` 的 45 条用例一条未改、全部通过。

**3. 未做（明确出界，留作后续）：** 审计发现行内徽标过多时（MCP 行最多可同时出现 6 个徽标），
`S.card` 的 `overflow: hidden` 会把行尾开关挤出可视区。这属于**布局/断行**问题，
在"不动布局"的边界内不处理；建议单开 issue 用 `flexWrap` 或徽标截断方案解决。

## 双轴 review 裁决（两条轴各自独立提交，均已逐条处理）

两个审查代理在 `f7ddc7a`→`930f8d6` 之间的持续推送中审阅，结论以最后一次提交为准。
每条发现都经我复核并落地或写明不改的理由。

| 发现 | 裁决 |
| --- | --- |
| **焦点覆盖测试空转**：`classGroups()` 用整文件引号配对扫 class 名，被注释里的撇号（vault 那行）打乱配对，只认出 15 组里的 7 个 token；删 `:focus-visible` 仍绿（审查方做了变异验证） | **采纳**。改为按 `className:` 表达式逐行抽取（含三元两分支），并把"样式表里的 `inv-*` 必须都能在产物里找到"做成独立用例（死类名即红）。修后重新变异验证：删规则会红。 |
| **`.inv-scroll` 是死代码**：细滚动条/`::selection` 从未挂到滚动宿主 | **采纳**。滚动宿主补 `className: 'inv-scroll'`；新用例可防再犯。 |
| **高对比兜底被内联压掉**：`.inv-row` / `.inv-switch` / `.inv-chip` 三条无 `!important` | **采纳**。三条补 `!important`（与既有 `.inv-card` 一致），并给 chip/primary 加 1px 透明描边，让 `border-color` 有意义。 |
| **搜索框焦点环死规则**：内联 `outline: 'none'` 压过 `.inv-search:focus-visible` | **采纳**。移除内联 `outline`（样式表已有 reset）；提示词 textarea 同一问题一并修掉。 |
| **`linkBtn` 丢圆角**：hover 底色与焦点环变直角，违反同心圆角 | **采纳**。token 恢复 `borderRadius: '8px'`。 |
| **spinner 对比度/线宽、行标题行高字距未落实** | **采纳**。spinner 轨道由 20% 灰提到 26%（仍是安静的中性灰）；行标题 `lineHeight 1.35` + `letterSpacing -0.003em`。 |
| **`::-webkit-search-cancel-button` 永不匹配**（input 不是 type=search） | **采纳**。删规则；不改 input 类型（会改变浏览器的回车/清空行为，属功能面）。 |
| **复选框 17→18px 加负外边距属布局补偿 hack** | **采纳**。回退到 17px 原位，只保留 `accentColor`。 |
| **`primary.minHeight: 32px` / `linkBtn` padding 4→8 是否越界** | **部分采纳**：保留（触摸目标与视觉平衡所需），在此留痕；量级为 2–8px，不改变任何布局结构。 |
| **`.flow` stage 与实况不一致** | **采纳**。收尾时推进到 `review` 并按实况写 `ci.status`。 |
| **测试改写全局 `window/document/fetch` 不复原** | **采纳**。加 `after()` 复原（与 `client.test.mjs` 的既有惯例不同，这里显式做对）。 |
| **WCAG 编号引错（2.4.11 vs 2.4.13）** | **采纳**。焦点外观→2.4.13；行焦点环不被卡片裁掉→2.4.11（这条恰好就是那个修复）。 |
| **残留空 token `rowHidden: {}`** | **采纳**。删除 token 与两处 spread，只保留 `rowTextHidden`。 |
| **spec 验收命令路径在包目录下不可执行** | **采纳**。标注"在仓库根执行"。 |

未采纳/出界：MCP 行徽标溢出导致行尾开关被裁（断行问题），仍按边界不处理，留后续 issue。
