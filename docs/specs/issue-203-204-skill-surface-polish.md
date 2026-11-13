# issue #203 + #204 — skill-surface:卡片标题如实反映行为 + 无 agent 时不再抛 WeakMap

- 分级:**trivial**(2 个源文件改动 ≤30 行,无接口/协议变更;测试 + 版本 + CHANGELOG 随行)
- 分支:`issue-203-204-skill-surface-polish`
- issue:https://github.com/kurumi1ksllq/DSH-plugins/issues/203 / https://github.com/kurumi1ksllq/DSH-plugins/issues/204
- 基线:main `e6f2202`(#201 / PR #202 的合并点),包内 77 条测试全绿

## 为什么合并成一个 PR

两条都出自 #201 / PR #202 双轴 review 的 P2 发现,都落在 `packages/dsh-skill-surface/index.js`,
共用一个版本号与一次发布。拆成两个 PR 会在同一文件同一版本上互相等待,没有收益。
任务板共用一块 `docs/specs/.flow/203.json`(与 #185–#188 的合并处理先例一致),
`204.json` 不单独建,避免面板出现两张同步推进的卡。

## 变更 1(#203):`presentCall` 的标题如实反映实际行为

**现状**(实测 main `e6f2202`):

```
presentCall({query:"only"}) -> {card:"generic", title:"List skills", kind:"read", rawInput:""}
```

而 `execute({query:"only"})` 在单命中时返回的是**技能正文**(#201 引入)。卡片说「列技能」,
模型实际收到一份正文 —— 排查时被误导。另外 `rawInput` 在无 `name` 时是空串,query 完全不展示。

**改法**:三态标题,与 `execute` 的分支顺序**完全对齐**(`name` 优先于 `query`,空/空白 query 视为列请求):

| args | title | rawInput |
|---|---|---|
| `{name}` | `Load skill <name>` | `<name>` |
| `{query}` 非空白 | `Search skills: <query>` | `<query>` |
| 无 / 空 / 空白 query | `List skills` | `''` |

**为什么选「Search skills」而不是「区分单命中 → Load skill <name>」**:
`presentCall` 是**纯同步**的 pending 态呈现器(`dsh-tools/lib/types/schema.d.ts:227-232`,
注释明确「Pure pending-state presenter」),拿不到 catalog,也拿不到 `exec`。
要判断单命中必须在 presenter 里做一次异步 snapshot —— 那既违反纯函数契约,
又引入时序问题(卡片先于 execute 渲染,两次 snapshot 之间策略可能变化)。
因此采纳 issue 里给的第一个建议(「统一用 Search skills」),放弃第二个。

**边界**:不改 `kind`(仍 `read`);不改 `execute` 的任何行为;不引入 catalog 访问。

## 变更 2(#204):`bodyFor()` 容忍无 `agent`

**现状**:`index.js:143-146`

```js
function bodyFor(skill, agent, api) {
  injectedSkills(agent).add(skill.name)   // agent === undefined -> WeakMap.get(undefined) 抛 TypeError
  return { text: capped(api.renderSkillContent(skill)) }
}
```

抛点链:`bodyFor()` → `injectedSkills(undefined)` → `memory.get(undefined)`,
`memory` 是 `WeakMap`(`lib/handoff.mjs:44/94-95`),不接受非对象键。

**两条路径的性质不同**(issue 原文的表格,已复核):

| 路径 | 改动前(`f598644`) | 改动后(`e6f2202`) | 性质 |
|---|---|---|---|
| `{name}` | 抛错 | 抛错 | 既有问题,#201 未触及 |
| `{query}` 单命中 | 正常返回列表 | **抛错** | #201 引入的回归 |
| `{query}` 多命中 / 无 query | 正常 | 正常 | 无变化 |

**改法**:记账加守卫,不记账不影响返回正文。

```js
if (agent !== undefined) injectedSkills(agent).add(skill.name)
```

**为什么是「跳过记账」而不是「记账到一个占位对象」**:记账的唯一消费者是 nudge
(`nudgeFor` 里 `injectedSkills(agent)` 判断「这个技能已在上下文里,别再提醒」)。
没有 agent 就没有那个 agent 的会话可记账,也不会有针对它的 nudge —— 跳过即语义正确。
伪造一个共享占位键会让不同 agent 互相污染,反而制造跨会话串味。

**与宿主惯例一致**:官方 `skill` 工具显式处理了 `exec.agent === void 0`
(`@deepseek-ai/dsh-tool-skill/lib/index.js:869`),本包此前与宿主不一致。

**可达性**:低。`hasOfficialLoader(scope, agent)`(`index.js:46-53`)在 `agent === undefined`
时返回 `true`,工具因此不会注册到那种 scope。所以这条只在非常规装配下可达 ——
但它是 #201 的行为回归,且改动只有一行守卫,没有理由留着。

## 验收标准

1. `presentCall({query:"x"})` 的 title 含该 query 且**不等于** `List skills`
2. `presentCall({query:"   "})` 仍是 `List skills`(空白 query 是列请求,与 201-13 口径一致)
3. `presentCall({name:"x"})` 仍是 `Load skill x`,`rawInput` 为 `x`(行为不变)
4. `presentCall({name:"x", query:"y"})` 为 `Load skill x`(`name` 优先,与 execute 一致)
5. `presentCall({})` 仍是 `List skills`,且 `rawInput` 为 `''`
6. `execute({query})` 在 `exec.agent === undefined` 时返回正文而不抛错
7. `execute({name})` 同上(顺带修掉既有问题)
8. 有 agent 时 `injectedSkills` 记账行为不变(201-11 仍绿)
9. 全部既有 77 条测试仍绿

## 反向验证(每条必须实测变红)

| 改回什么 | 应红哪条 |
|---|---|
| title 改回固定 `List skills` | 验收 1 |
| query 分支去掉空白判断(空白也算搜索) | 验收 2 |
| 去掉 `agent !== undefined` 守卫 | 验收 6、7(抛 TypeError) |
| 让 query 分支压过 name 分支 | 验收 4 |

## 裁剪

**不裁剪任何阶段**。虽定为 trivial,但 (a) 触及公开工具的返回行为,(b) #204 是回归,
(c) 两条都是「代码看起来对、行为不对」的典型,必须有反向验证锁住。
TDD、PR、CI、双轴 review 照做。

## 不做的事

- 不动 `nudgedTurn`(`index.js` 的 WeakMap):同一 `agent === undefined` 场景理论上也会抛,
  但 `agent/pre-step` 的 payload 一定带 agent,当前不可达;为它加守卫属于超出两条 issue 的边界。
  留作后续 issue 候选,不在此处夹带。
- 不改 `execute` 的三态返回逻辑(#201 已定型)。
- 不动 locale 文案:卡片标题是工具侧英文协议字段,与本包 `locale/` 的中文提示词无关。

## 版本

`dsh-skill-surface` 0.3.0 → 0.3.1(bugfix + 呈现文案,无接口变更)。
