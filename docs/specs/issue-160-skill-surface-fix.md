# issue-160 · dsh-skill-surface v0.1.1（修复 #159 上线事故）

> 分级 standard；用户明示「现在做修正版」，意图确认已完成。本文件是状态源。

## 事故

重载后 **standard 会话技能目录 270 → 0**。

根因在官方发布器（`dsh-tool-skill/lib/index.js:935-941`）：当本实例不是当前生效的 `skill` 工具时，它**仍然发布** `{skills: [], complete: true}` 的空目录并宣称替换此前所有清单。#159 把 `tool-skill` 又挂了一份到宿主平面，于是 standard/ptc 的目录被自己挂的那份清空。

技能本身没丢（`deep_ptc_tools(action=skills, query='')` → total 270）。

## 目标

1. 删除 `tool-skill-global` 行；**永不**再挂第二个 `tool-skill`。
2. `dsh-skill-filesystem` 仍挂 global 层，但用独立 `providerName`。
3. 已有 `skill` 工具的 agent：本插件零输出（硬判）。
4. 没有 `skill` 的 agent：`skill_get`（列目录 / 取正文）+ 一段恒定 `systemPrompt.context` 提示。
5. 派活握手 `skills: a, b` 行为不变。

## 边界

- 不发布 `skill-catalog` 消息（避免任何"替换"语义）。
- 不抢 `skill` 工具名。
- 不改 preset、不改上游 SKILL.md。

## 验收

| # | 验收 | 判定 | 状态 |
| --- | --- | --- | --- |
| A0 | 有官方 `skill` 的 agent → 提示文本为空 | 单测 | ✅ |
| A1 | 无官方 loader 的 agent → 提示非空且 ≤12 行并提到 `skill_get` | 单测 | ✅ |
| A2 | `skill_get` 列目录 / 取正文 / 未知名字报错 | 单测 | ✅ |
| A3 | 派活握手行为不变 | 既有单测 | ✅ |
| A4 | patch 中不得出现 `tool-skill` 行（#159 回归闸） | 单测 | ✅ |
| A5 | 重载后 standard 会话目录条数仍为 270 | 人工 | ⏳ 待重载 |

## Tickets

| # | 内容 | 状态 |
| --- | --- | --- |
| 1 | 重写 patch（删 tool-skill 行、加 providerName） | done |
| 2 | `skill_get` + 提示 + 硬判闸 | done |
| 3 | 测试 A0–A4 | done |
| 4 | 版本 0.1.1 / CHANGELOG / README | done |
| 5 | 全量验收 + PR | in-progress |

## 回滚

本版只新增"读"能力与一段提示；若重载后异常，把 profile 的 `dsh-skill-surface` 两条摘掉再重载即可（`/root/dsh-rollback-158.sh` 仍是同一路径的回滚脚本）。
