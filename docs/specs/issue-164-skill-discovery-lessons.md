# 技能面：两次事故的机制与守卫（issue #164）

> 记录于 2026-11-10，对应 #159 / #160 / #164。**本文是这条链路的单一事实源**：
> `docs/specs/issue-160-skill-surface-fix.md` 与 `packages/dsh-skill-surface/cordis.patch.yml` 的注释
> 描述同一机制时以本文为准，改一处请回改另外两处的指针而不是各自重写。

## 背景

宿主层把 `dsh-skill-filesystem` 与 `dsh-tool-skill` 两行 `disabled: true`（上游 `dsh-web-app/cordis.patch.yml:521-526`），改由每个 agent preset 自管。

可复核的现象：`dsh --profile web --dump-config` 组合出 9 个 preset 行，其中只有 3 个（`standard`/`ptc`/`cordis`）的 plugins 里含 skill 行，其余 6 个是 persona-only——包含委派路由表点名的全部 5 个。
**不要直接 grep profile**：`~/.dsh/profiles/web/cordis.patch.yml` 只有那 5 个白名单 preset 行，看它会得到相反结论。

## 机制一：被遮蔽的发布器会发空目录（#159）

上游 `dsh-tool-skill/lib/index.js`（0.2.2-rc.1，约 935-942 行）在「本实例不是当前生效的 skill 工具」时走 `{ skills: [], complete: true }` 分支。
它分两种情形：本会话**从未**发布过目录 → 950-957 行直接返回（沉默）；此前发布过 → 959 行渲染一条**替换**消息（"replaces every earlier available-skills list in this session"），把已有目录清空。

所以在宿主平面再挂一份 `tool-skill`，会把本来有目录的会话（standard/ptc）清成 0。技能本身没丢（注册表仍 270），丢的是模型可见的目录。

**硬规则：宿主平面只补「发现器」（provider），不重复挂「发布器」型插件。**
补 provider 的前提是三条同时成立：新 row id、**独立的 `providerName`**（本包用 `skill-surface-filesystem`）、目标层无同名。
宿主对「同一层内重名」是**直接抛错**（`dsh-skill/lib/index.js:138-140`），不是静默覆盖；跨层同名则近层胜出——沿用 `skill-filesystem` 会被遮蔽，看起来挂上了、实际发现不到。

## 机制二：注册期抛错会回滚同一回调内的 effect（#160）

`ctx.tools.register` 直接把 `output.schema` 交给 `assertSupportedJsonSchema`（`dsh-tools/lib/index.js:437`）；属性级 `required: true` 会被拒。
抛点若在某个 `inject` 回调里，**该回调此前注册的 effect 会一起回滚**。

实际形态出现在 #160 的中间提交 `2d67e98`：提示与协议段在 `ctx.inject(['systemPrompt','tools'])`，而工具注册与握手监听同在 `ctx.inject(['skills','workingDirectory','tools'])`。
所以抛错时**被回滚的是同回调里的握手监听**，提示因为住在另一个回调而存活 —— 症状是「提示还在，工具没了」。
（更早的 v0.1.0/`1314074` 里根本没有 `tools.register`，不适用这段描述。）

**约定**：一个 `inject` 回调只承担一个关注点；`output.schema` 用对象级 `required: [...]`。

## 三个回归守卫（结构断言恒跑；宿主校验器仅本机能跑）

| 守卫 | 位置 | 触发条件 |
| --- | --- | --- |
| 不许挂第二个 `tool-skill` | `packages/dsh-skill-surface/test/bundle.test.mjs` | 归一化后的 patch 里出现该包名或 `- id: tool-skill*` |
| 工具 schema 必须是宿主支持的形态 | 同包 `test/tool-schema.test.mjs` | 属性带 `required`（结构断言恒跑；能解析到宿主包时才用真实 `assertSupportedJsonSchema` 复核，CI 上 skip） |
| 能力必须按 agent 门控 | 同包 `test/apply.test.mjs` | 有官方 `skill` 时提示为空、且 `when` 返回 false |

## 重载后的人工验收（本 issue 编号，避免与 #158/#160 的 A 编号混淆）

- **B1**：已有官方 `skill` 的 agent，工具目录里搜不到 `skill_get`。（`#160` 表里对应 A0 的后半条）
- **B2**：standard 会话**目录消息**的条目数不变 —— 指 `"kind":"skill-catalog"` 那条 user 消息里的 `entries` 数量，**不是**注册表总数。
  基线 **270**；其中 1 条（`ui-design`）是指向 `/tmp` 的软链，临时目录被清则基线为 269。
  这条**此前没有自动守卫**，是事故后补的人工验收，不是「既有守卫失效」。
- **B3**：无 skill 的 preset 子 agent 能列出技能、能取回正文（`<skill_content>` + resources base）。（`#160` 表里对应 A6 的实操部分）

取证命令：

```bash
# 注册表条数（B2 的旁证，不是 B2 本身）
#   deep_ptc_tools(action="skills", query="")  → total
# 目录消息条目数（B2 本身）
zstd -dc /root/.dsh/sessions/<workspace>/<session-uuid>/session.v4.jsonl.zstd \
  | grep -c '"kind":"skill-catalog"'
# 门控（B1）
#   deep_ptc_tools(action="search", query="skill_get") → total 应为 0
```

## 运维脚本（仓库内 `scripts/`）

```bash
scripts/skill-surface-wire.sh --dry-run      # 先看它要做什么（不改任何文件）
scripts/skill-surface-wire.sh               # 写 link/bundles + pnpm install；默认不重启
scripts/skill-surface-rollback.sh --dry-run # 打印基线内容与「恢复后将丢弃什么」
scripts/skill-surface-rollback.sh --yes     # 真的恢复；默认不重启
```

`--profile DIR` / `--baseline FILE` / `--service UNIT` 可覆盖默认解析（默认 profile 走 `$DSH_PROFILE_DIR`，
否则 `${DSH_HOME:-$HOME/.dsh}/profiles/${DSH_PROFILE_NAME:-web}`）。

> **两个脚本默认都不重启**；只有显式加 `--restart` 才会执行 `systemctl restart <unit>`，
> 且重启后会轮询 `systemctl is-active` 核验，10 秒内没起来就 exit 1 并提示看 `journalctl`。
> 按全局 `~/.dsh/AGENTS.md` 的强制条，重启必须先获得用户明确批准，**agent 不得代跑**。
>
> 三个别误解的点：
> 1. wire 用 `JSON.stringify` **整份写回** profile 的 `package.json`；
> 2. rollback 恢复的是**基线那一刻的整份快照**——基线之后其它 bundle 的变更也会被一起回滚，所以它不是「只摘掉这个插件」；
>    因此它要求 `--yes` 才动手，覆盖前还会把当前 profile 备份成 `package.json.pre-rollback.<UTC>`；
> 3. 从 linked git worktree 运行时 wire **直接拒绝**（除非 `--force`）：软链会指向那个工作树，工作树一删即断。

## 明确没做

- 不做词法/语义检索层：一次**性观察**（未留脚本）—— BM25 over name+description 对「cordis composition plugin development」返回 vue/swiftui/react-patterns，是错的；真信号在正文 `## When to Activate` 而不在 description。
- 不做每轮打扰式提示：`PreStepDecision` 是 `{kind:"reject"} | {kind:"enter"; messages; startsRequestSeries?}`（`dsh-agent/lib/types/runtime-types.d.ts:117-125`），**没有** `additionalContexts`；注入的 messages 是持久消息、会累积。
