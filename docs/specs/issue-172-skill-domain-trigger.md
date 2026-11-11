# issue-172 · 技能领域触发：在开工那一下点名相关技能

> 分级 standard（改插件行为 + 新增领域表 + 新增 7 条测试）。

## 现象（session-d64ea594）

用户：「优化一下 dsh-inventory 的页面,不是布局,而是 ui 等细节」。

- preset `deep-ptc`，目录 270 条，含 `make-interfaces-feel-better` / `design-system` / `frontend-design-direction`
- 会话 **29 次 run_code、0 次 skill 调用**，用户提醒后仍未调用
- 路径：看包结构 → 读 client.js → 找 token 定义，全程自己干

## 诊断（三条实测）

1. **不是看不到**：目录里就有，且该 preset 有官方 `skill`。
2. **不是找不到**：用原话做词典匹配，`make-interfaces-feel-better` 排名第 1。
3. **是觉得没必要查**：需要的是"开工时的一下触发"，不是更强的检索。

反证：宽松检索对这句话命中 123 条；英文表述下 `prompt-optimizer` 反超。所以**不能靠检索排序**。

## 设计

- `lib/domains.mjs`：7 个领域的**策展短名单** + 中英关键词。
- 命中条件：**同一领域至少 2 个不同关键词**（单个词太容易误触）。
- 在 `agent/pre-step` 注入一行，≤120 字符，**每轮最多一次**；本轮已加载过该领域技能则不发。
- 短名单里的名字必须**在当前目录里真实存在**且 `modelInvocable`，否则丢弃；全被丢弃则整条不发。
- 对有两种加载器的 agent 都生效：有官方 `skill` 说 ``skill``，只有 `skill_get` 说 ``skill_get``。
- 不发布 `skill-catalog` 消息（#159 教训），不复用 skill-invocation source（避免污染"已加载"判定）。

## 边界

不做语义检索；不改官方插件；不点名不在目录里的技能；不改变 handoff 行为。

## 验收

| # | 验收 | 结果 |
| --- | --- | --- |
| E1 | 回放用户原话 → 行内包含 `make-interfaces-feel-better` | ✅ 单测 |
| E2 | 「跑一下测试」「修个 bug」「更新 README」→ 不触发 | ✅ 单测 |
| E3 | 20 条普通消息误触发 ≤ 2 | ✅ 实测 0 |
| E4 | 同一轮最多一次，下一轮可以再说 | ✅ 单测 |
| E5 | 短名单里目录没有的名字被丢弃，全丢则不发 | ✅ 单测 |
| E6 | 无官方 `skill` 的 agent 被指向 `skill_get` | ✅ 单测 |

## 裁剪

无裁剪。
