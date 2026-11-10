# 技能面：两次事故的机制与守卫（issue #164）

> 记录于 2026-11-10，对应 #159 / #160 / #164。这是**事实记录**，不是新方案。

## 背景

宿主层把 `dsh-skill-filesystem` 与 `dsh-tool-skill` 两行 `disabled: true`（上游 `dsh-web-app/cordis.patch.yml:521-526`），改由每个 agent preset 自管。

可复核的现象：`dsh --profile web --dump-config` 组合出 9 个 preset 行，其中只有 3 个（`standard`/`ptc`/`cordis`）的 plugins 里含 skill 行；其余 6 个是 persona-only——包含委派路由表点名的全部 5 个。
（profile 的 `cordis.patch.yml` 本身只有那 5 个白名单 preset 行，所以直接 grep profile 会得到 5，要以**组合后的树**为准。）

## 机制一：被遮蔽的发布器会发空目录（#159）

上游 `dsh-tool-skill/lib/index.js`（0.2.2-rc.1，约 935-942 行）在「本实例不是当前生效的 skill 工具」时走 `{ skills: [], complete: true }` 分支。
它并非在任何情形下都发消息：955-958 行还有一个沉默分支（本会话**从未**发布过目录时不发）。但只要此前发布过目录，959 行就会渲染一条**替换**消息（"replaces every earlier available-skills list in this session"），把已有目录清空。

所以在宿主平面再挂一份 `tool-skill`，会把本来有目录的会话（standard/ptc）清成 0。技能本身没丢（注册表仍 270），丢的是模型可见的目录。

**硬规则：宿主平面只补「发现器」（provider），不重复挂「发布器」型插件。**
补 provider 的**前置条件**：必须给它一个与既有行不同的 `providerName`（本包用 `skill-surface-filesystem`）。
沿用 `skill-filesystem` 会被近层同名遮蔽——看起来挂上了，实际发现不到。

## 机制二：注册期抛错会回滚同一回调内的 effect（#160）

`ctx.tools.register` 直接把 `output.schema` 交给 `assertSupportedJsonSchema`（`dsh-tools/lib/index.js:437`）；属性级 `required: true` 会被拒。
抛点若在某个 `inject` 回调里，**该回调此前注册的 effect 会一起回滚**。

v0.1.0 的实际形态：握手监听与工具注册同在 `ctx.inject(['skills','workingDirectory'])` 这个回调里，所以随工具一起消失；
而提示与协议段在**另一个**回调（`ctx.inject(['systemPrompt'])`）里，依然存活——于是出现「提示还在，工具没了」。

**约定**：一个 `inject` 回调只承担一个关注点；`output.schema` 用对象级 `required: [...]`。

## 三个回归守卫（改坏即红）

| 守卫 | 位置 | 触发条件 |
| --- | --- | --- |
| 不许挂第二个 `tool-skill` | `packages/dsh-skill-surface/test/bundle.test.mjs` | 归一化后的 patch 里出现该包名或 `- id: tool-skill*` |
| 工具 schema 必须是宿主支持的形态 | 同包 `test/tool-schema.test.mjs` | 属性带 `required`（结构断言恒跑；能解析到宿主包时再用真实 `assertSupportedJsonSchema` 复核，否则 skip） |
| 能力必须按 agent 门控 | 同包 `test/apply.test.mjs` | 有官方 `skill` 时提示为空、且 `when` 返回 false |

## 验收口径（重载后才能证）

- **A0**：已有官方 `skill` 的 agent，工具目录里搜不到 `skill_get`。
- **A5**：standard 会话技能目录条数不变。基线 **270**——其中 1 条（`ui-design`）是指向 `/tmp` 的软链，临时目录被清则基线为 269。
  这条**此前没有自动守卫**，是事故后补的人工验收，不是「既有守卫失效」。
- **A6**：（`issue-160` 的验收表）无 skill 的 preset 子 agent 能列出技能、能取回正文（`<skill_content>` + resources base）。

取证：`deep_ptc_tools(action=skills, query="")` 看注册表条数；`deep_ptc_tools(action=search, query="skill_get")` 看门控；
`zstd -dc <session>.zstd` 找 `"kind":"skill-catalog"` 看目录消息是否为空。

## 运维脚本（**在部署宿主上，不在仓库里**）

```bash
bash /root/dsh-wire-160.sh       # 接线 + 重启（幂等：不重复备份、不重复插 bundles）
bash /root/dsh-rollback-158.sh   # 回到「未装该插件」（读 package.json.no-skill-surface.bak，缺失则拒绝执行）
```

> **两个脚本的最后一步都是 `systemctl restart dsh`。**
> 按全局 `~/.dsh/AGENTS.md` 的强制条，重启必须先获得用户明确批准，**agent 不得代跑**；脚本里的「幂等」只指备份与 bundles 条目，不包括重启。

## 明确没做

- 不做词法/语义检索层：实测 BM25 over name+description 对「cordis composition plugin development」返回 vue/swiftui/react-patterns，是错的；真信号在正文 `## When to Activate` 而不在 description。
- 不做每轮打扰式提示：`PreStepDecision` 只有 `messages`，注入即持久消息、会累积。
