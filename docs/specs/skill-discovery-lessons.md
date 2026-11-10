# 技能面：两次事故的机制与守卫

> 记录于 2026-11-10，对应 issue #159 / #160 / #164。这是**运维与实现的事实记录**，不是新方案。

## 背景

宿主层把 `dsh-skill-filesystem` 与 `dsh-tool-skill` 两行 `disabled: true`，改由每个 agent preset 自管。于是没挂这两行的 preset 完全没有技能（本部署 9 个 preset 里 6 个如此，含委派路由表点名的全部 5 个）。
补这个洞的过程中踩了两次坑，机制如下。

## 机制一：被遮蔽的发布器会发空目录（#159）

`dsh-tool-skill/lib/index.js`（上游 0.2.2-rc.1，约 935-941 行）在「本实例不是当前生效的 skill 工具」时走 `{ skills: [], complete: true }` 分支——**它不会沉默，而是发布一条空目录并宣称替换此前所有清单**。

所以在宿主平面再挂一份 `tool-skill`，会把本来有目录的会话（standard/ptc）清成 0。技能本身没丢（注册表仍 270），丢的是模型可见的目录。

**硬规则：宿主平面不要重复挂任何「发布器」型插件。** 只补「发现器」（provider）是安全的：`dsh-skill` 按技能名跨层合并、近层胜出，不会翻倍也不会遮蔽。

## 机制二：注册期抛错会回滚同回调内的 effect（#160）

`ctx.tools.register` 直接把 `output.schema` 交给 `assertSupportedJsonSchema`，属性级 `required: true` 会被拒。抛点若在某个 `inject` 回调里，**该回调此前注册的 effect 会一起回滚**——结果是一个工具消失，而同一回调里注册的提示仍在指向它。

**约定**：一个 `inject` 回调只承担一个关注点；`output.schema` 用对象级 `required: [...]`。

## 三个回归守卫（改坏即红）

| 守卫 | 位置 | 触发条件 |
| --- | --- | --- |
| 不许挂第二个 `tool-skill` | `packages/dsh-skill-surface/test/bundle.test.mjs` | 归一化后的 patch 里出现该包名或 `- id: tool-skill*` |
| 工具 schema 必须是宿主支持的形态 | 同上包 `test/tool-schema.test.mjs` | 属性带 `required`；本机还会用宿主真实校验器跑一遍 |
| 能力必须按 agent 门控 | 同上包 `test/apply.test.mjs`（A0/A0b） | 有官方 `skill` 时，提示为空且 `when` 返回 false |

## 验收口径（重载后才能证）

- **A5**：standard 会话技能目录条数不得变（本部署 270）。上次事故就是这条失效。
- **A0**：已有官方 `skill` 的 agent，工具目录里搜不到 `skill_get`。
- **A6 / A6′**：`agent_preset=planner` 之类的子 agent 能列出技能、能取回正文（`<skill_content>` + resources base）。

取证方式：`deep_ptc_tools(action=skills, query="")` 看注册表条数；`deep_ptc_tools(action=search, query="skill_get")` 看门控；`zstd -dc <session>.zstd` 看目录消息是否为空。

## 运维脚本

```bash
bash /root/dsh-wire-160.sh       # 接线 + 重载（幂等；首次会固化回滚基线）
bash /root/dsh-rollback-158.sh   # 回到「未装该插件」状态（读 package.json.no-skill-surface.bak）
```

## 明确没做

- 不做词法/语义检索层：实测 BM25 over name+description 对「cordis composition plugin development」返回 vue/swiftui/react-patterns，是错的；真信号在正文 `## When to Activate` 而不在 description。
- 不做每轮打扰式提示：`PreStepDecision` 只有 `messages`，注入即持久消息、会累积。
