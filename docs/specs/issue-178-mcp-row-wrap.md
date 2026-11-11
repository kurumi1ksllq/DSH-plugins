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

一个 MCP 行最多 6 个徽标 + 箭头 + 开关；技能行固定宽子元素更多（2 徽标 + Switch + 2 按钮 + 2 spinner）。它们的固定宽度之和在窄列里必然超出，超出的部分既不换行也不产生横向滚动，直接落到卡片的裁剪区。

## 方案

### 1. 两处都加 `flexWrap: 'wrap'`

```diff
- style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', minWidth: 0 }
+ style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', cursor: 'pointer', minWidth: 0 }
```

**issue 只点名 MCP 行，但技能行是同一个缺陷且固定宽子元素更多**——只修 MCP 行会漏一半。

`gap` 同时是 row-gap，换行后行间自然有 10px，不需要新样式键。

### 2. 必须重跑构建

`client.js` 由 `scripts/build-inventory-client.mjs` 从 `client/` 分片拼接生成，`test/client-build.test.mjs` 断言产物与分片逐字节一致。改分片不重建 = 该测试红。

### 3. 不动的

- `S.card` 的 `overflow: hidden`（圆角裁切与动画依托，去掉会让行底色溢出圆角）
- `S.row`、`S.page`、rail 宽度
- 不加 `minWidth: '55%'`（issue 方案 A 的建议）：换行已能保证不被裁，额外下限会挤压窄窗口下的行主区

## 验收

- 遍历渲染树里所有 `role === 'switch'` 的节点，断言其**直接父容器**的 style 含 `flexWrap: 'wrap'`。MCP 行与技能行任一处不修都会红，失败信息带上开关的 `aria-label`
- 反向验证：删掉任一处 `flexWrap` → 对应用例红
- `client-build` 必须绿（产物已重建）

## 边界与已知限制

- **`flexWrap` 只保证「不被裁」，不保证「开关留在首行」**。开关是最后一个子元素，极端情况下会跟着徽标换到第二行（仍完整可见可点，`marginLeft: 'auto'` 让它在该行右对齐）。若产品要求开关钉在首行，需要把徽标收进一个可换行的胶囊组、Switch 留在不换行的外层行——那是新增容器节点，属更大改动，另开 ticket。
- 工作区详情页的行（`client/40-workspaces.js`）与 `S.row` 是同类潜在缺陷，本次**不修**（超 issue 边界）。
- 精确裁切断点（900 / 1024 / 1280px 哪一档真的裁）需要浏览器实测，本次未验证；单测只能锁「可换行」这个不变量。
- 换行后行高会从 44px 增高（`S.row` 的 `minHeight` 是下限，不是固定高）。注意 `test/client.test.mjs` 的 `rowOf()` 依赖 `minHeight === '44px'`，不要动这个键。
