# issue #203 + #204 — skill-surface:卡片标题如实反映行为 + 无 agent 时不再抛 WeakMap

- 分级:**standard**(FLOW.md:48 的 trivial 口径是「≤1 文件 且 ≤30 行 且 无接口变更」,本改动实测 7 个文件——包内 4 个(`index.js`、`package.json`、2 个新测试)+ `CHANGELOG.md` + 本 spec + `.flow/203.json`——套不进 trivial,按标准档走完整流程。初稿误判为 trivial 并自行放宽了文件口径,轴1 review 指出后更正)
- 分支:`issue-203-204-skill-surface-polish`
- issue:https://github.com/kurumi1ksllq/DSH-plugins/issues/203 / https://github.com/kurumi1ksllq/DSH-plugins/issues/204
- 基线:main `e6f2202`(#201 / PR #202 的合并点),包内 77 条测试全绿

## 为什么合并成一个 PR

两条都出自 #201 / PR #202 双轴 review 的 P2 发现,都落在 `packages/dsh-skill-surface/index.js`,
共用一个版本号与一次发布。拆成两个 PR 会在同一文件同一版本上互相等待,没有收益。
任务板共用一块 `docs/specs/.flow/203.json`(与 #185–#188 的合并处理先例一致),
`204.json` 不单独建,避免面板出现两张同步推进的卡。

## 变更 1(#203):`presentCall` 的标题如实反映实际行为

**现状**(实测 main `e6f2202`;此处按符号名引用,行号会随改动漂移):

```
presentCall({query:"only"}) -> {card:"generic", title:"List skills", kind:"read", rawInput:""}
```

而 `execute({query:"only"})` 在单命中时返回的是**技能正文**(#201 引入)。卡片说「列技能」,
模型实际收到一份正文 —— 排查时被误导。另外 `rawInput` 在无 `name` 时是空串,query 完全不展示。

**改法**:三态标题,与 `execute` 的分支顺序**完全对齐**(`name` 优先于 `query`,空/空白 query 视为列请求):

| args | title | rawInput |
|---|---|---|
| `{name}` | `Load skill <name>` | `<name>` |
| `{query}` 非空白 | `Search skills: <query>`,**经 `clampLine` 上限 120 字符、换行折叠为空格** | `<query>` **原文**(detail 视图不截断) |
| 无 / 空 / 空白 query | `List skills` | `''` |

**长度/换行口径**:宿主契约要求 title「Keep it short — a UI shows it as a card header / log line」
(`dsh-tools/lib/types/presentation.d.ts:49-52`),本包对同类单行文本已有 `clampLine` +
`NUDGE_MAX_CHARS = 120` 先例,直接复用;`rawInput` 是展开视图,保留 query **原文**(含首尾空白,不 trim)。

**为什么选「Search skills」而不是「区分单命中 → Load skill <name>」**:
`presentCall` 是**纯同步**的 pending 态呈现器(`dsh-tools/lib/types/schema.d.ts:227-232`,
注释明确「Pure pending-state presenter」),拿不到 catalog,也拿不到 `exec`。
要判断单命中必须在 presenter 里做一次异步 snapshot —— 那既违反纯函数契约,
又引入时序问题(卡片先于 execute 渲染,两次 snapshot 之间策略可能变化)。
因此采纳 issue 里给的第一个建议(「统一用 Search skills」),放弃第二个。

**边界**:不改 `kind`(仍 `read`);不改**有 agent 时** `execute` 的行为(无 agent 分支由抛错改为返回正文,见变更 2);不引入 catalog 访问。

## 变更 2(#204):`bodyFor()` 容忍无 `agent`

**现状**:`index.js` 的 `bodyFor()`

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
6. `execute({query})` 在 `exec.agent === undefined` 时返回正文而不抛错(**含 `ensure` 守卫**,不只是记账守卫)
7. `execute({name})` 同上(顺带修掉既有问题)
8. `presentCall({query})` 的 `rawInput` 等于该 query 原文(**含首尾空白**,不 trim)
9. 超长 query 的 title ≤ 120 字符;含换行的 query 的 title 仍是单行
10. 四个分支的 `card`/`kind` 恒为 `generic`/`read`
11. 有 agent 时 `injectedSkills` 记账行为不变(201-11 仍绿)
12. 全部既有 77 条测试仍绿

## 反向验证(每条必须实测变红)

| 改回什么 | 应红哪条 |
|---|---|
| title 改回固定 `List skills` | 验收 1 |
| query 分支去掉空白判断(空白也算搜索) | 验收 2 |
| 去掉 `bodyFor` 的 `agent !== undefined` 守卫 | 验收 6、7(抛 TypeError) |
| 去掉 `lookupFor` 的 `agent === undefined` 守卫 | 验收 6、7、以及多命中列表路径(抛 `reading 'session'`) |
| title 不过 `clampLine` | 203-1b |
| query 分支 `rawInput` 回空串 | 203-1、203-1b |
| 不折叠换行 | 203-1c、203-3b |
| name 分支不 clamp | 203-3a、203-3b |
| 让 query 分支压过 name 分支 | 验收 4(203-4;**只有它**——`{name}` 单独传入时没有 query,不受影响) |

## 裁剪

**不裁剪任何阶段**。虽曾按 trivial 预估(后按 FLOW.md:48 更正为 standard),但 (a) 触及公开工具的返回行为,(b) #204 是回归,
(c) 两条都是「代码看起来对、行为不对」的典型,必须有反向验证锁住。
TDD、PR、CI、双轴 review 照做。

## 裁剪与 review 视角的如实记录

**不裁剪任何阶段**:TDD、PR、CI、双轴 review 全部执行。

**但有一处必须如实说明**:双轴 review 的**轴2 由主智能体兜底完成,不是独立子代理**。

- 事实:原派子代理(审查开始时派出)与复派子代理(窄范围)都未在时限内交付;
  复派的一个后来交付了 P1×2+P2×6(已全部采纳),原派的最终报告在本轮末尾才到
  (又抓出 name 分支未 clamp 等 3 条 P1/P2,亦已采纳)。
- 依据:FLOW.md「委派失败或结果为空 → 主智能体自己兜底补做」。我在子代理未交付期间,
  按同一固定模板自行完成了轴2 口径的检查,并把结论写进 PR 描述。
- 风险:自审不是独立视角。为压低这个风险,兜底后仍保留了子代理的实际交付,
  且**每一轮 review 的发现都做了变异验证**(改坏实现→确认对应测试变红→恢复),
  而不是只凭文字判断。轴2 两轮实际抓到的都是可复现的缺陷(测试空转、引用行号错、
  name 分支未 clamp、CHANGELOG 事实错误),不是风格意见。
- 留证:本小节 + `.flow/203.json` 的 `review.note` + PR 描述「双轴 review 的发现与裁决」。

## 不做的事

- 不动 `nudgedTurn`(`index.js` 的 WeakMap):同一 `agent === undefined` 场景理论上也会抛,
  但 `agent/pre-step` 的 payload 一定带 agent,当前不可达;为它加守卫属于超出两条 issue 的边界。
  留作后续 issue 候选,不在此处夹带。
- 不改 `execute` 的三态返回逻辑(#201 已定型)。
- 不动 locale 文案:卡片标题是工具侧英文协议字段,与本包 `locale/` 的中文提示词无关。

## 变更(轴1 review 后,2026-11-13)

review 指出初版**只修了一半**:`lookupFor()` 仍无条件调 `workingDirectory.ensure(exec.agent, …)`,
而宿主实现第一行就读 `agent.session`(`dsh-working-directory/lib/index.js:91-93`),
所以无 agent 时在到达 `bodyFor()` 之前就抛 `TypeError: Cannot read properties of undefined (reading 'session')`。
初版测试之所以绿,是因为 stub 把 `ensure` 写成 `() => '/work'`,**掩盖了真实形状** —— 与 #201 那次
「stub 保留 content 导致空正文漏测」是同一类错误。官方 `skill` 工具守卫的正是 `ensure` 调用本身
(`dsh-tool-skill/lib/index.js:869`),初版只抄了记账那半。

据此:

1. `lookupFor` 加 `exec.agent === undefined` 守卫(与官方写法一致)。
2. `test/no-agent.test.mjs` 的 `ensure` stub 改成宿主真实形状(无 agent 时抛错),否则 204-1/204-2 是假绿。
3. 标题补 `clampLine` 上限与换行折叠(`rawInput` 保留原文);新增 203-1b/203-1c 与 rawInput 断言。
4. 分级由 `trivial` 更正为 `standard`(见首行理由)。
5. CHANGELOG 的缺 tag 清单按 `git tag -l` 实测重算(原句把已有 tag 的三个版本算作缺失)。

## 版本

`dsh-skill-surface` 0.3.0 → 0.3.1(bugfix + 呈现文案,无接口变更)。
