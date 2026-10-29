# DSH 上下文预算方案（2026-10-28 决策版）

> 结论：把"求模型听话"换成"引擎硬闸"。三项落地——压缩阈值调参、预算闸插件、`/handoff` 命令；
> 两项明确不做——自动拆任务、继续堆提示词。

---

## 0. 决策摘要

| # | 事项 | 决定 | 载体 | 生效方式 |
|---|---|---|---|---|
| A | 全局压缩阈值 `0.55 → 0.3`、保留比例 `0.12 → 0.1` | **做** | `~/.dsh/profiles/desktop/cordis.patch.yml` | 重启 profile |
| A2 | `save-token: keepRatioMax 0.72 → 0.5` | **做**（可回滚） | 同上 | 重启 profile |
| A3 | `tool-search: listingMaxTokens 4000 → 800` | **做**（可回滚） | 同上 | 重启 profile |
| B | 预算闸插件（`tools/pre-execute` 硬拒绝 + 上下文超线冻结扩张操作） | **做** | 新插件 `E:/Project-hub/dsh-ctx-guard` | 重启 profile |
| C | `/handoff` 命令（生成交接文档 + 可粘贴的续跑指令） | **做** | 同一插件内注册命令 | 重启 profile |
| — | 自动拆任务（`subagents.startActivation` 自动派生） | **不做** | — | — |
| — | 继续增补提示词 / 依赖 AGENTS.md 约束行为 | **不做** | — | — |
| — | `tool-result-pruner` 调狠（4096/2048/512 → 更低） | **不做** | 维持现状 | — |
| — | `ctx.sessions.fork` 自动开新会话 | **不做**（fork 复制历史，不省 token） | — | — |

---

## 1. 事实依据（本机实测，可复算）

数据源：`~/.dsh/sessions/**/session.v4.jsonl.zstd`（v4 格式为逐条 zstd 帧，需按 `28 b5 2f fd` 切分后逐帧解压）+ `~/.dsh/storages/session_projcache`。

**压缩实际上几乎没跑过**

| 指标 | 值 |
|---|---:|
| 有请求的会话 | 83 |
| 模型请求总数 | 5,876 |
| 压缩次数（`compact-checkpoint`/`compaction/end`） | **5**（仅 3 个会话） |

当前配置 `thresholdRatio: 0.55`、`contextWindow: 512000` ⇒ 压缩线 = `min(512000×0.55, 512000−65536−65536)` = **281,600 token**。绝大多数会话峰值到不了这条线，所以压缩等于关闭。

**上下文体量归因**（2026-10-26 之后，42 会话 / 2,020 请求，按"内容插入后到会话结束被重复计入请求"折算）

| 类别 | 占输入 | 备注 |
|---|---:|---|
| assistant 历史（含 reasoning） | 32.5% | reasoning 612k vs 可见正文 61k，约 10:1 |
| tool 结果 | 25.6% | top 10% 的结果占 54%，单条最大 8,357 token |
| system prompt | 13.2% | 9.3k/请求，其中 6.9k 来自 `~/.dsh/prompt-inject/state.json` |
| tool-call 参数 | 11.0% | `write` 整文件内容会永久留在历史里 |
| tools schema | 6.9% | 24 工具 / 18,348 字符（tool-search 已生效） |
| agent-instructions + skill-catalog + runtime-context | 10.5% | 单会话最多 16 份 runtime 快照；含 3 份逐字节相同的 14,526 字符副本 |

**成本口径提示**：以上是"上下文体量"，不是账单。2026-10-23 的审计显示 cacheRead 占 billed token 的 90.2%、按价折算约 42%。压缩阈值调低主要降的是峰值与前缀断裂频率，不是等比降钱。

---

## 2. 方案 A：全局压缩阈值

### 2.1 改动

`~/.dsh/profiles/desktop/cordis.patch.yml` 中现有块（约第 428 行）：

```yaml
- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
  config:
    thresholdRatio: 0.3      # 原 0.55
    retainRatio: 0.1         # 原 0.12
```

同一文件追加一段（`save-token` 目前**没有** config 覆盖行，走插件默认 0.72）：

```yaml
- id: save-token
  config:
    keepRatioMax: 0.5        # 原默认 0.72；插件 README 引的 RCT：0.5 档 −27.9%
```

`tool-search` **已有**覆盖块（`enabled: auto`、`listingMaxTokens: 4000`、`maxWarmTools: 3`、`core: [...]`），只改其中的数字，不要把整块重写成单行——按 id patch 是**整体替换** `config`，省略的键回落插件默认值，`core` 白名单会被清空。

### 2.2 生效后的数值

| 项 | 现在 | 改后 |
|---|---:|---:|
| 压缩触发线 | 281,600 | **153,600** |
| 保留原文尾部 | 53,575 | **44,646** |
| 每次压缩需摘要的输入 | ~228k | ~109k |

约束校验：`retainTokens(44,646) < thresholdTokens(153,600)` ✓；`headroomTokens`/`maxTokens` 保持默认 65,536。

### 2.3 诚实的代价

压缩不是免费的：每次触发是一次**全价**摘要请求（输入 ≈ 触发线，无缓存命中），并在历史中产生替换点（后续请求前缀缓存重建一次）。

- 会话累计上下文 `< 250k` 就结束的任务型会话：压缩一次可能反而更贵。
- 长会话（累计 > 400k，例如 `a6deb29b` 那种 584 请求的）：0.3 是净赚。
- 折中不改：用户已选定 0.3，方案按 0.3 执行；验收时用"压缩次数 / 节省 token"两个数复核。

---

## 3. 方案 B：预算闸插件（硬约束）

### 3.1 为什么是硬闸

`AGENTS.md` 只能进 system prompt，与 100k 历史争夺注意力；记录里 user-message 级 reminder 被重复追加最多 16 次，行为未变。引擎侧的拒绝是**物理的**：

源码 `@deepseek-ai/dsh-tools/lib/index.js:3321`

```js
const gate = await this.ctx.waterfall(carrier, 'tools/pre-execute', exec, () => ({ kind: 'allow' }))
// gate.kind === 'deny' → 工具结果直接变成 "Error: <reason>"，工具体不执行
```

已验证可用的钩子/服务：

| 能力 | 位置 | 用途 |
|---|---|---|
| `tools/pre-execute`（waterfall） | `dsh-tools` 3321 | 拒绝/放行单次工具调用 |
| `tools/post-execute` | save-token 已用 | 改写工具结果（不重复造） |
| `agent/pre-step` | `compaction-basic` 已用 | 每步前读 token、触发维护动作 |
| `ctx.tokenMeter.measure(session).totalTokens` | `dsh-token-meter` | 当前上下文估算 |
| `ctx.compaction.compactIfNeeded(agent, 'pressure', signal)` | `dsh-compaction-basic` | 程序化压缩（**内部仍按 thresholdRatio 判定，不能早于 153.6k**） |
| `ctx.commands.register({...})` | `dsh-commands` | 注册斜杠命令 |
| `ctx.sessions.create / fork` | `dsh-session` | 建会话 / 分支（本期不用） |

注意：`compactIfNeeded` 有内部阈值守卫，插件无法用它把压缩提前到 153.6k 之前。所以 B 段的目标不是"更早压缩"，而是**超线后禁止把上下文继续撑大**。

### 3.2 行为定义

| 规则 | 条件 | 动作 |
|---|---|---|
| R1 单次写入预算 | `write.content` > 8,000 字符 | deny，`reason` 要求改用 `edit` 增量或拆分文件 |
| R2 单次改写预算 | `edit.new_string` > 4,000 字符 | deny，要求分次 edit |
| R3 命令长度 | `bash.command` / `pwsh.command` > 2,000 字符 | deny，要求写脚本文件后执行 |
| R4 上下文告警 | `totalTokens` > 120,000 | 仅日志/状态，不注入提示词 |
| R5 冻结扩张 | `totalTokens` > 140,000 | deny `write`(新文件)、`skill`、网页整页抓取；只放行 `read`(带 offset/limit)、`grep`、`edit`、短 `bash` |
| R6 兜底 | 触发 R5 时 | 若 `totalTokens ≥ 153,600`，先调一次 `compactIfNeeded`，再继续判定 |

R5 的语义是"要么交付、要么收尾"，而不是"你要注意上下文"。

### 3.3 实现骨架

`E:/Project-hub/dsh-ctx-guard/package.json`

```json
{
  "name": "dsh-ctx-guard",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`

```yaml
- insert:
    - id: ctx-guard
      name: dsh-ctx-guard
      config:
        maxWriteChars: 8000
        maxEditChars: 4000
        maxCommandChars: 2000
        warnTokens: 120000
        freezeTokens: 140000
```

`lib/index.js`

```js
export const name = 'dsh-ctx-guard'
export const inject = ['tools', 'tokenMeter']

export function apply(ctx, config) {
  const tokensOf = (agent) => {
    try { return ctx.tokenMeter.measure(agent.session).totalTokens } catch { return 0 }
  }

  ctx.on('agent/pre-step', ({ agent }, next) => {
    const t = tokensOf(agent)
    if (t > config.warnTokens) ctx.logger.warn(`ctx-guard: ${t}t (freeze at ${config.freezeTokens})`)
    return next()
  })

  ctx.on('tools/pre-execute', (exec) => {
    const a = exec.arguments ?? {}
    const over = (n) => (typeof a[n] === 'string' ? a[n].length : 0)

    if (exec.name === 'write' && over('content') > config.maxWriteChars)
      return { kind: 'deny', reason: `write 单次 ${over('content')} 字符 > ${config.maxWriteChars}：改用 edit 增量修改，或拆成多个文件` }

    if (exec.name === 'edit' && over('new_string') > config.maxEditChars)
      return { kind: 'deny', reason: `edit 单次 ${over('new_string')} 字符 > ${config.maxEditChars}：分多次 edit` }

    if ((exec.name === 'bash' || exec.name === 'pwsh') && over('command') > config.maxCommandChars)
      return { kind: 'deny', reason: '命令过长：写成脚本文件再执行' }

    const t = exec.agent ? tokensOf(exec.agent) : 0
    if (t > config.freezeTokens) {
      const frozen = new Set(['write', 'skill', 'web_fetch', 'browser-snapshot'])
      if (frozen.has(exec.name))
        return { kind: 'deny', reason: `上下文 ${t}t 已冻结扩张：先产出/deliver，或用 edit 收尾；需要更多上下文请 /handoff` }
    }
    return { kind: 'allow' }
  })
}
```

加载：`~/.dsh/profiles/desktop/package.json` 的 `dependencies` 加 `"dsh-ctx-guard": "link:E:/Project-hub/dsh-ctx-guard"`，`dsh.profile.bundles` 追加 `"dsh-ctx-guard"`，`pnpm install` 后重启。

### 3.4 失败模式

| 失败 | 表现 | 处理 |
|---|---|---|
| `inject` 写错 | 插件不加载，profile 启动日志报 missing service | 检查 `tokenMeter`/`tools` 是否在 bundle 里 |
| deny 文案太笼统 | 模型反复重试同一调用 | `reason` 必须给替代做法（骨架里已带） |
| R5 冻结后误伤 | 收尾需要写新文件 | `freezeTokens` 留 20% 余量；或 `/handoff` 转新会话 |
| 阈值与 A 段冲突 | 触发线 153.6k 已在自己压缩 | R6 只是兜底，不与之竞争 |

---

## 4. 方案 C：`/handoff` 命令

### 4.1 定位

**不自动切会话**，只做"零成本交接"：把当前会话压成一份可读取的文档 + 一段可直接粘贴的续跑指令。用户自己开新会话，粘进去。

不做自动建会话的理由：`ctx.sessions.create()` 只建会话，不带 agent loop 生命周期（`dsh-agent-loop` 的创建事务）；`fork()` 复制前缀历史，token 一点不少。两者都不解决"新会话从零开始"的问题，反而引入 attach/回收风险。

### 4.2 行为

```text
/handoff            → 采集当前会话，写 <cwd>/.dsh/handoff/HANDOFF-<ISO>.md，回一条摘要 + 续跑指令
/handoff <标题>     → 同上，标题写进文档头
```

命令返回值（`{kind:'success', text}`）里包含：文档路径、写入的文件清单、剩余待办、以及一段 200 字以内的"新会话首条消息"。

### 4.3 采集口径（事件类型已核实）

`invocation.agent.session.snapshotEvents()` 返回事件数组：

| 事件 `type` | 取什么 |
|---|---|
| `session/title` | `data.title` |
| `user/message`（`source.kind === 'user'`） | 全部可见文本，取首条 + 最近 5 条 |
| `assistant/message` | `content[].type === 'text'`，取最后 2 条 |
| `tool/call` | `name`、`arguments`；`write`/`edit` 的 `file_path` 去重成"改动清单" |
| `tool/call`（`name === 'todo_write'`） | 最后一次的 `arguments.todos` → 待办清单 |
| — | `ctx.tokenMeter.measure(agent.session).totalTokens` → 当前上下文规模 |

### 4.4 实现骨架

```js
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function handoff(ctx, invocation, titleHint) {
  const events = invocation.agent.session.snapshotEvents()
  const textOf = (m) => (m?.content ?? []).map((c) => c.text ?? '').join('')
  const users = events.filter((e) => e.type === 'user/message' && e.data?.source?.kind === 'user')
  const lastTodos = events.filter((e) => e.type === 'tool/call' && e.data?.name === 'todo_write').at(-1)
  const files = [...new Set(
    events.filter((e) => e.type === 'tool/call' && ['write', 'edit'].includes(e.data?.name))
          .map((e) => { try { return JSON.parse(e.data.arguments).file_path } catch { return undefined } })
          .filter(Boolean)
  )]
  const title = events.find((e) => e.type === 'session/title')?.data?.title ?? titleHint ?? 'handoff'
  const tokens = ctx.tokenMeter.measure(invocation.agent.session).totalTokens

  const body = [
    `# HANDOFF — ${title}`,
    '',
    `- 会话: ${invocation.agent.session.header.id}`,
    `- 生成时间: ${new Date().toISOString()}`,
    `- 来源上下文: ~${tokens} tokens`,
    '',
    '## 目标',
    textOf(users[0]?.data.message ?? users[0]?.data).slice(0, 800),
    '',
    '## 最近进展',
    ...users.slice(-5).map((e) => `- ${textOf(e.data.message ?? e.data).slice(0, 200)}`),
    '',
    '## 改动文件',
    ...files.map((f) => `- ${f}`),
    '',
    '## 未完成',
    JSON.stringify(lastTodos?.data?.arguments ?? {}, null, 2).slice(0, 1500),
  ].join('\n')

  const dir = join(invocation.agent.session.header.cwd ?? process.cwd(), '.dsh', 'handoff')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `HANDOFF-${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
  await writeFile(path, body, 'utf8')

  return {
    kind: 'success',
    text: `交接文档: ${path}\n\n新会话直接粘贴：\n> 先读 ${path}，按“目标/未完成”继续；改动前先 git diff 确认现状。`,
  }
}

export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('@local/dsh-handoff'),
      name: 'handoff',
      description: 'Write a handoff document and a paste-ready continuation prompt',
      handler: (invocation) => handoff(ctx, invocation, invocation.rawInput.trim() || undefined),
    })
  }, 'handoff-command lifecycle')
}
```

命令注册契约（照 `@deepseek-ai/dsh-command-compact` 的写法）：`inject = ['commands']`，handler 收到 `{agent, signal, commandId, rawInput}`，返回 `{kind:'success'|'error', text}`。

---

## 5. 不做清单（含理由）

| 不做 | 理由 |
|---|---|
| 自动拆任务 | `ctx.subagents.startActivation()` 可编程派生，但子代理要自带上下文；只有"子任务可独立验证"（单文件重构、批量转换、跑测试）才净赚。探索型任务（如"把 ComfyUI 更新到最新"）串联依赖强，拆开多付一遍探索成本——这正是那 584 次请求会话的形态。 |
| 继续加提示词/`AGENTS.md` 约束 | 记录里同样的 reminder 最多重复 16 次、含逐字节相同的 14.5k 字符副本，行为未变。软约束的边际收益已归零。 |
| `tool-result-pruner` 调狠 | 该 pruner 是 lossy 的（中间段直接替换为 `[... tool result middle pruned ...]`，**没有 spill 可回取**），当前 4096/2048/512 已在切文件读取；再降会吃掉 `read` 的中段代码。要可逆压缩请走 save-token。 |
| `fork` 自动开新会话 | fork 复制前缀历史，token 不变，只适合分支实验。 |

---

## 6. 验收

1. **A 段**：重启后新会话跑一个 ≥200k 的任务，确认 `compaction/end` 出现且触发点在 ~153k（不是 281k）。
2. **B 段**：故意让模型执行一次 >8k 字符的 `write`，确认工具结果是 `Error: write 单次 ... 超过`，且模型改用 edit。
3. **C 段**：`/handoff` 后检查 `.dsh/handoff/HANDOFF-*.md` 是否含目标/进展/改动文件/未完成四段；把返回的续跑指令粘进新会话，确认能接上。
4. **复算**：用同一套归因脚本对比 `attributed input tokens`、`compaction 次数`、`峰值上下文` 三个数（脚本口径：按 zstd 帧切分解压 → 按类别统计 → 按"插入位置到会话结束的请求数"折算）。

预期：长会话（>400k 累计）的归因值下降 40% 以上；单任务短会话可能因压缩而略升——这是 2.3 说明的已知代价，不为它调参。

---

## 7. 落地顺序

1. A 段改配置（3 处）→ 重启 profile → 跑一次长任务验证压缩点。
2. B 段建插件 → link + bundle 注册 → 重启 → 验证 R1/R5。
3. C 段在同一插件里加命令 → 重启 → `/handoff` 验证。
4. 观察 3 天，用复算脚本对比，再决定是否把 `thresholdRatio` 往下压（0.25）或把 R5 的 `freezeTokens` 提到 160k。

回滚：A 段三行改回原值（`0.55 / 0.12`、`keepRatioMax 0.72`、`listingMaxTokens 4000`）；B/C 段在 profile `bundles` 与 `dependencies` 里删掉 `dsh-ctx-guard` 即整体卸载。

---

## 8. 落地记录（2026-10-28 实施）

| 段 | 状态 | 位置 |
|---|---|---|
| A | 已改 | `~/.dsh/profiles/desktop/cordis.patch.yml`：`thresholdRatio 0.3`、`retainRatio 0.1`、新增 `save-token.keepRatioMax 0.5`、`tool-search.listingMaxTokens 800` |
| B | 已上线 | `E:/Project-hub/dsh-ctx-guard`（R1–R6 + `test/self-check.mjs`）；实测热加载生效，一条 2,735 字符命令被 R3 拒绝 |
| C | 已注册 | 同仓库 `lib/handoff.js`，`/handoff [标题]` |

实现与本文的两处差异：
1. bundle patch **不写** `config`，默认值放 `lib/index.js` 的 `DEFAULTS`。原因：按 id 的 patch 是整体替换 `config`，按本文 §3.3 把默认值写进 patch，profile 侧任何局部覆盖都会把其余键打回插件默认值；现在 `- id: ctx-guard / config: {冻结线}` 是真正的浅合并。
2. `definitionId` 用普通字符串 `@local/dsh-handoff`：`CommandDefinitionId()` 在运行时是恒等函数，省掉对 asar 内 `@deepseek-ai/dsh-commands/brand` 的解析依赖。

验收待办（需一次 ≥200k 的真会话）：确认 `compaction/end` 触发点在 ~153.6k；`/handoff` 产物四段齐全；140k 后新文件写入被拒而 `present` 通过。

