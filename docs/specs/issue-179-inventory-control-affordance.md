# issue-179 — 控件可辨识度 + 加载态布局对齐

**分级：standard**（改动面：`client/20-styles.js`、`client/95-panel.js`、生成物 `client.js`（由 `scripts/build-inventory-client.mjs` 产出、`test/client-build.test.mjs` 守护）、`test/ui-detail.test.mjs`、`package.json`、`CHANGELOG.md`）

## 背景（用户实测反馈，issue #170 合并后）

1. **"按钮不好，没有让看出来是按钮还是标题"**：分段/胶囊控件是 `12% 灰底 + 次级文字`，
   而分组标题是 `13px / 600 / 次级文字` —— 两者字号、颜色、无描边全部同款，用户在视觉上分不出
   "能点的"和"只是标题的"。
2. **"一开始的加载过程中还是以前的垂直布局"**：`status === 'loading'` 与 `'error'` 两个分支返回的是
   nav + 单列 page（无左侧导航栏、无滚动容器），只有数据到位后才渲染 rail 两栏 —— 打开面板时结构跳变一次。

## 边界

做：

1. **形态区分优先于颜色区分**（`frontend-design-direction`）：可点控件带 `1px 描边 + 浅底 + 主文字色`，
   悬停加深描边与底色、按下微缩；分组标题保持无框、主文字色、由左侧箭头表示可展开。
2. **`.inv-btn` 补 hover/active**：返回、刷新、分组标题这类"图标/文字按钮"此前只有焦点态，没有任何悬停反馈。
3. **加载态与错误态复用同一套两栏外壳**：nav + 左右两栏（rail + `inv-scroll`）+ 页面列；
   加载时在"将来出内容的位置"放骨架，错误时放错误条。计数在数据未到位时不给（rail 只在有数字时显示计数）。

不做：

- 不改导航结构/栏目顺序/宽度，不改文案，不改数据与宿主 API；
- 不引入新的色板或第二套圆角体系；不把标题做成按钮、也不把按钮做成标题。

## 验收

1. 加载树与就绪树**外壳同构**：两者都包含 `nav[aria-label]` 的 rail、带 `inv-scroll` 的滚动容器，
   且 rail 的六个视图标签完全一致（加载时不显示计数）。
2. 错误树同构，且错误条下有可点的重试主按钮。
3. 控件"看得出是控件"：`.inv-chip` 规则同时声明 `background` 与 `border`，文字用主文字色；
   分组标题不带 `inv-chip` 类，控件不带 `aria-expanded`（结构上互斥，测试守住）。
4. `.inv-btn` 有 hover 规则且给背景反馈（删掉即红）。
5. `pnpm test` / `pnpm verify` / bundle --check 全绿；`dsh-inventory` 版本上抬。

## tickets

| id | title |
| --- | --- |
| 1 | 控件形态与 .inv-btn 反馈 |
| 2 | 加载/错误态复用两栏外壳 |
| 3 | 版本号与变更记录 |

## 裁剪

不裁剪（standard 全流程）。
