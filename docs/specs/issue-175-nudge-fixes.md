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

## 边界

- 只改判定与守卫，不改 nudge 文案与领域表（除把标记抽成常量）。
- 不改其它包；`dsh-inventory` 有同一盲区，另开 issue（见下）。
- 不做语义检索、不发布 catalog 消息。

## 变更（review 后追加）

- 回声守卫从"整批"改为"逐条 block"：同批里引用提示+真实请求时，只丢引用那条。
- 领域匹配改为**按句**：同一段长文里散落的词不再合并成信号（真机上确有一次误触发）。
- 标记常量收敛到 `domains.mjs`（`NUDGE_PREFIX` / `NUDGE_SUFFIX` / `looksLikeNudge`），测试用 `nudgeLine()` 生成引文，避免双源漂移。
- dispatch 分支接受字符串形式 arguments，并忽略 `isError` 的加载。

## 关联

`packages/dsh-inventory/lib/collect-sessions.js` 同样只认 `tool/call` → 另开 issue 记录。