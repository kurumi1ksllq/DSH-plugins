# issue-175 · 领域触发两处缺陷（v0.2.1）

> 分级 standard。真机验证 #172 时发现，证据见 #172 的验证评论。

## 缺陷

**D1（中）** deep-ptc 里模型调 `skill` 走 `tool/ptc-dispatch`，而 `injectedSkills` 只认 `tool/call`。
实测：3 次加载全在 dispatch 事件里（`isError:false`），会话的 `tool/call` 只有 `run_code`。
后果：该 preset 下加载过的技能下一轮仍被点名。

**D2（低）** 子 agent 回报引用那句提示时，父会话把它当新输入再次触发（lead 会话实测 1 条）。

## 修法

- `loadedBy` 同时读 `tool/ptc-dispatch`（`data.name` ∈ {skill, skill_get}；`data.arguments` 已是对象，不 JSON.parse）。
- 待匹配文本已含 nudge 标记（`本轮涉及` + `再动手。`）则跳过。

## 验收

| # | 验收 | 结果 |
| --- | --- | --- |
| F1 | dispatch 记录的加载能抑制下一轮点名 | ✅ 单测；**删掉该分支即红** |
| F1b | 非加载类 dispatch 不抑制 | ✅ 单测 |
| F2 | 文本已含 nudge 标记不触发 | ✅ 单测；**删掉该守卫即红** |
| F3 | 既有测试不回归 | ✅ 52 → 55 全过 |

## 裁剪

无裁剪。
