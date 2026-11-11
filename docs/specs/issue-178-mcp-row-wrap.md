# #178 MCP 行徽标过多时行尾开关被卡片 overflow 裁掉

- 分级：`standard`（1 个源分片 2 处 + 重建产物 + 测试）

## 目标

「工具管理」页的 MCP 行与技能行在窄窗口下会把行尾开关挤出可视区，被卡片的 `overflow: hidden` 裁掉。开关一旦被裁，用户既看不到也点不到。

## 现状（实测）

两处行容器结构完全相同，都**没有 `flexWrap`**：

- `client/95-panel.js:550`（MCP 行）
- `client/95-panel.js:632`（技能行）

`style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', minWidth: 0 }`

而 `S.badge`（`20-styles.js:299-311`）与 `S.switchTrack`（`:316-332`）都是 `flexShrink: 0`，`S.card`（`:181-190`）是 `overflow: hidden`。

一个 MCP 行最多 6 个徽标 + 箭头 + 开关 + spinner（固定宽子元素 8 个）；技能行是 1 徽标 + 开关 + vault 按钮 + 隐藏按钮 + 最多 2 个 spinner。**两行的固定宽子元素数量相近（MCP 行反而更多）**，共同点是结构相同、都缺换行。它们的固定宽度之和在窄列里必然超出，超出的部分既不换行也不产生横向滚动，直接落到卡片的裁剪区。

## 方案

### 1. 两处都加 `flexWrap: 'wrap'`

```diff
- style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', minWidth: 0 }
+ style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', cursor: 'pointer', minWidth: 0 }
```

**issue 只点名 MCP 行，但技能行是同一个结构、同一个缺失的不变量**——只修 MCP 行会漏一半。

`gap` 同时是 row-gap，换行后行间自然有 10px，不需要新样式键。

### 2. 必须重跑构建

`client.js` 由 `scripts/build-inventory-client.mjs` 从 `client/` 分片拼接生成，`test/client-build.test.mjs` 断言产物与分片逐字节一致。改分片不重建 = 该测试红。

### 3. 不动的

- `S.card` 的 `overflow: hidden`（圆角裁切与动画依托，去掉会让行底色溢出圆角）
- `S.row`、`S.page`、rail 宽度
- 不加 `minWidth: '55%'`（issue 方案 A 的建议）：换行已能保证不被裁，额外下限会挤压窄窗口下的行主区

## 验收

- 遍历**总览页渲染树（MCP 段 + 技能段）**里所有 `role === 'switch'` 的节点，断言其**直接父容器**的 style 含 `flexWrap: 'wrap'`。两处任一处不修都会红，失败信息带上开关的 `aria-label`
- 用例同时断言 offender 的 label 集合恰为 `['long', 'long-skill']`——否则将来 fixture 变动让某个开关消失时，`length >= 2` 这类下界仍会绿，范围被悄悄缩小也看不出来
- 反向验证：删掉任一处 `flexWrap` → 对应用例红
- `client-build` 必须绿（产物已重建）

## 边界与已知限制

- **`flexWrap` 保证的是「可换行」，因此行尾控件不会被卡片横向裁掉**；它**不保证**单个子元素宽度超过行宽时也不越界——徽标是 `whiteSpace: nowrap` + `flexShrink: 0`，单个徽标若比行还宽仍会溢出。本次的徽标文案到不了这一步，但这不是无条件保证。
- **开关不保证留在首行，也不保证在最右侧**。Switch 后面还有兄弟节点（MCP 行有 busy spinner；技能行有 vault 按钮、两个 spinner 和隐藏按钮），所以 `marginLeft: auto` 只能把它推到**它所在那一行**的右侧，它右边仍有控件。对长行（最多 6 个徽标 + 箭头）开关落到第二行是**常规结果，不是极端情况**。
- 若产品要求开关钉在首行最右，需要把徽标收进一个可换行的胶囊组、把 Switch 与后续按钮留在不换行的外层行——那是新增容器节点，属更大改动，另开 ticket。
- 工作区详情页的行（`client/40-workspaces.js:138`、`:232`）用的是 `S.row`，同一不变式在那里实测有 **3 个 offender**（`codegraph`、`proj-skill`、`codegraph-explore`），本次**不修**（超 issue 边界）。
- 精确裁切断点（900 / 1024 / 1280px 哪一档真的裁）需要浏览器实测，本次未验证；单测只能锁「可换行」这个不变量。
- 换行后行高会从 44px 增高（`S.row` 的 `minHeight` 是下限，不是固定高）。注意 `test/client.test.mjs` 的 `rowOf()` 依赖 `minHeight === '44px'`，不要动这个键。
- **`S.rowMain` 的 `flex` 从 `1 1 auto` 改为 `1 1 0`**（review 补充）。`flex-basis: auto` 时 flex 换行的分行判定用的是 max-content 宽度，而 `S.rowMono` 是 `wordBreak: break-all`、一条长命令可达数百像素——那会让**本来放得下的行**也提前换行、行高从 44px 涨到 ~70px。改成 `flex-basis: 0` 后分行只由徽标决定，收缩能力不变。
- 本次未验证浏览器实测断点（本机无 headless 浏览器）：`flexBasis: 0` 的分行行为依据 CSS Flexbox 规范 §9.3，实际像素表现需在真实浏览器确认。
