# issue-249 — 第 13 个外部工具静默顶掉第 1 个

## 目标

`packages/dsh-deep-ptc-mode/lib/tool-policy.mjs` 里 `selected` 的 12 条上限不再静默:上限有名字、有注释、被挤出的名字出现在 `load` 的返回值与 note 里,且返回值与 `selected` 描述同一个集合。

## 边界

- 只动本包:对外工具名(`deep_ptc_tools`)、参数、返回结构既有字段(loaded/unavailable/deferred/nextStep/note)保持不变,只**新增** `evicted`。
- 上限值本身不变(仍是 12),不新增配置 UI,不引入配置项。
- 不涉及 quarantine / search / SDK 渲染逻辑。

## 验收

1. 连续 load 超过上限时,`load` 返回值带出被挤出的名字(`evicted`),note 说明这些名字已从本次 SDK 移除、需要时重新 load。
2. 被挤出的名字不在下一次 `sdkDefinitions` 里;重新 load 能拿回。
3. 未超限时 `evicted` 为空(不误报)。
4. 返回值与 `selected` 一致:不会出现「返回值说 loaded 但 selected 里没有」。
5. 本包既有测试全绿,仓库级 `node --test test/docs-contract.test.mjs` 全绿。

## 变更点

- `lib/tool-policy.mjs`:新增模块内常量 `SELECTED_TOOL_LIMIT = 12`(带注释说明来源与用途);`load` 里两处裸 `12` 合并为 `select()` 收口,挤出名字记入 `evicted`;返回值新增 `evicted`;note 在真挤出时改口,deferred 承诺只在确有 deferred 名字仍被选中时才说。
- `test/tool-compatibility.test.mjs`:新增两条用例(超限报 evicted + 被挤出名字消失且可重新 load 拿回;未超限 evicted 为空)。
- `package.json` 1.17.2 → 1.17.3;`README.md` / `README.zh.md` 版本号同步;`CHANGELOG.md` Unreleased 新增一条,条目计数 90 → 91(87 已 tag + 2 待 tag + 2 仓库级)。
