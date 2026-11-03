# spec: 凭据保险库规范化存储 + 模糊命中 + 零明文使用路径

> 停点2 产物。用户于 2026-11-04 确认：
> ① 命中能力用独立 `action:"search"`，不给 `list` 加 query 参数；
> ② `KINDS` 增加 `database`（纯分类标签，不影响加密与权限）；
> ③ 别名（aliases）**只由用户在面板维护**，AI 只读、不得写入；
> ④ `reveal` **保留但降级**为显式逃生门（用户明确要看值时才用），`use` 成为默认路径；
> ⑤ `shellEnv` 缺失时 `use` **明确报错**（不静默退化为 `reveal`）——用户要求"要求安全"；
> ⑥ 历史明文清理脚本 T7 **纳入本次范围**；
> ⑦ 用户稍后自行重新添加 token，本次不代其写入任何凭据。

## 1. 目标

三件事，缺一不可：

1. **AI 先知道库里有什么** —— 系统提示词每轮动态列出凭据索引（只有名字与元数据，无值），
   并硬性要求"向用户索取任何密码/token/API key 之前必须先查库"。
2. **用户不用写准确名称** —— 名称、服务、别名三层规范化，`github token` / `github-token` /
   `gh` 都能命中同一条；匹配不确定时返回候选清单，绝不猜。
3. **值不再交给模型** —— 新增 `action:"use"`，把凭据注入为每次 shell 调用重建的
   `DSH_CRED_*` 环境变量（该环境不进请求前缀、不进会话日志），使"模型可见明文"这条
   泄露链断掉。

## 2. 现状与实测证据（本 spec 的事实基础）

### 2.1 已核实的能力缺口

| 缺口 | 代码位置 |
| --- | --- |
| 提示词是静态字符串，不含任何凭据名 | `packages/dsh-credential-vault/index.js` `HINT_SECTION` |
| 提示词无"问用户之前先查库"规则 | 同上 |
| 提示词反而鼓励"先问用户" | 同上（`Ask the user before revealing…`） |
| `get`/`reveal` 只接受精确名 | `index.js` `execute` → `store.reveal(name)` |
| 条目无 `service` / `aliases`，无法表达"这是 GitHub 的 token" | `lib/store.js` 条目结构 |
| `KINDS` 无 `database` | `lib/store.js` `KINDS` |
| 审计无 `sessionId` / `resolvedBy` / `use` 与 `reveal` 的区分 | `lib/audit.js` |

### 2.2 泄露实测（2026-11-04，本地解密后全盘比对，未打印值）

`reveal` 的明文已经出现在 **34 个文件**中：

| 位置 | 命中数 |
| --- | --- |
| `~/.dsh/sessions/**/session.*.jsonl.zstd` | 24 |
| `~/.dsh/storages/session_projcache/*.json` | 6 |
| `/tmp/dsh-spill-*/**.txt` | 2 |
| `/root/quanmin-patch/.git/config`（token 嵌在 remote URL） | 1 |
| `/tmp/git-config-backup-*`、`/tmp/file-issues.sh` | 2 |

泄露链：`reveal 明文` → `tool/result` 落盘 → 模型抄进 `bash` 参数（`tool/call` 落盘）→
`job label` 再落一次 → 顺手拼进 git remote URL 落进 `.git/config`。

运行时侧核实结论：

- `dsh-tools` 的 `finalizeContent` 无人用于脱敏；`redact` 仅用于 settings 与 telemetry。
- `dsh-spill-policy` 只做截断保留，**不做脱敏**。
- `dsh-client-ui-secret-mask` 只改**绘制**，不改消息文本与模型输入（README 明示）。
- `dsh-credentials-local` README 明示「agent 工具进程与你是同一 OS 用户，本存储无法对 agent 隔离」。
- `dsh-shell-env` 明示「managed environment never enters the request prefix」→ **环境变量不进会话日志**，
  这是本方案的技术支点。

### 2.3 由此得到的结论

README 现有表述「明文只存在于进程内存和 `credential` 工具的返回值里」**是错的**，
必须随本 spec 修正。

## 3. 数据模型（向后兼容，不迁移、不丢数据）

### 3.1 条目结构（`vault.json` `version: 2`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `kind` | enum | `password` / `token` / `api-key` / `ssh-key` / **`database`** / `other` |
| `secret` | string | AES-256-GCM 密文（不变） |
| `username` | string \| null | 不变 |
| `url` | string \| null | 不变 |
| `note` | string \| null | 不变 |
| `service` | string \| null | **新增**。服务标识，如 `github` / `openai` / `aliyun-ecs` |
| `aliases` | string[] | **新增**。用户手工维护的其他叫法，如 `["gh","github-token","git"]` |
| `createdAt` / `updatedAt` | ISO | 不变 |

`slug` **不落盘**，由 `name` 派生（单一事实源，避免漂移）。

### 3.2 规范化函数 `normalizeKey(value)`

小写 → 非字母数字字符折叠为 `-` → 合并连续 `-` → 去首尾 `-`。用于 `slug` 与别名比较。
中文等其他字符保留（不做音译），只折叠标点与空白。

### 3.3 向后兼容

`readVault` 读到旧条目（`version: 1`、无 `service`/`aliases`）时按 `null` / `[]` 处理；
`set` 写入时统一升到 `version: 2`。不批量迁移、不改动 `secret`，任何读路径对老条目行为不变。

### 3.4 slug 撞名校验

`set(name, …)` 时若另一条目的 `slug` 与新 `name` 的 `slug` 相同且不是同一条目 → 拒绝，
错误信息给出冲突的既有名称，要求用户改名。这样 `github token` 与 `github-token` 不会并存。

## 4. 命中解析 `resolveName(query)`

顺序短路，**确定性命中，不用编辑距离**：

1. **exact** —— 精确 `name`
2. **slug** —— `normalizeKey(query) === slug(entry.name)`
3. **alias** —— `normalizeKey(query)` 命中任一 `normalizeKey(alias)`
4. **service** —— `normalizeKey(query)` 命中 `normalizeKey(service)`
5. **keyword** —— 把 query 按空白/标点切词，**每个词**都出现在
   `name + aliases + service + url + note` 的规范化文本中

返回形态：

- 唯一命中 → `{ status: 'resolved', name, resolvedBy }`
- 多条命中 → `{ status: 'ambiguous', candidates: [...] }`（掩码元数据，**不猜**）
- 零命中 → `{ status: 'missing', candidates: [] }`

`resolvedBy ∈ { exact, slug, alias, service, keyword }`，写入审计。

## 5. 工具契约（`credential`）

| action | 参数 | 返回 | 审计 |
| --- | --- | --- | --- |
| `list` | — | `{ count, entries }`，每条含 `name/slug/kind/service/aliases/username/url/note/updatedAt`，**无值** | 不写 |
| `search` | `query`（必填） | `{ query, status, matches: [{name,slug,kind,service,aliases,preview}] }`，**无值** | 不写 |
| `get` | `name` | 掩码元数据，走 `resolveName` | 写 `ok`/`missing` |
| `use` | `name` | `{ ok, name, envVar, expiresAt }`，**不含 secret** | 写 `use` |
| `reveal` | `name` | 明文 + 元数据（逃生门） | 写 `reveal`，`source` 标记 |

- `get`/`use`/`reveal` 的 `name` 全部走 `resolveName`；`ambiguous` 时抛错并**列出候选名**，
  提示用 `search` 或写准确名。
- `use` 不接受"没命中的猜测"；解析为 `ambiguous`/`missing` 一律拒绝。
- 非法名、`ambiguous`、`missing` 都写审计（`outcome` 分别为 `rejected`/`ambiguous`/`missing`）。

## 6. 零明文使用路径（`use` + shellEnv 注入）

### 6.1 机制

1. `use` 在插件内存里登记票据：`(sessionId, credentialName) → { secret, expiresAt }`，
   TTL 默认 10 分钟，重复 `use` 刷新 TTL。
2. 插件通过 `ctx.shellEnv.register()` 注册一个 contributor，声明
   `DSH_CRED_<SLUG>`（slug 大写、`-`→`_`）变量；`resolve(execution)` 按
   `execution.agent.session.header.id` 取票据，命中则返回该值，否则返回 `{}`。
3. 每次 shell 调用由 `dsh-shell-env` 重建快照 → 变量随执行生效，**不进请求前缀、不进会话日志**。
4. 票据不落盘；进程退出即消失。

### 6.2 为什么这能断链

| 泄露链环节 | `use` 之后 |
| --- | --- |
| `reveal` → `tool/result` 落盘 | `use` 返回体不含 secret，落盘的只有变量名 |
| 模型把值抄进 `bash` 参数 | 模型手上没有值，只能写 `$DSH_CRED_GITHUB_TOKEN` |
| `job label` 再落一次 | 同上，label 里是变量名 |
| 拼进 git remote URL | 提示词禁止；变量在子进程环境里，URL 里写不进去（见 6.4 残留风险） |

### 6.3 环境变量命名

`DSH_CRED_<SLUG_UPPER>`：`github-token` → `DSH_CRED_GITHUB_TOKEN`。
声明集合随凭据集合变化：`shellEnv` 的 `register` 一次声明**全部**当前凭据的变量名，
新增/删除凭据时重新注册（`ctx.effect` 管理 disposer）。

### 6.4 诚实的威胁模型（必须写进 README，不假装）

- **防的是意外泄露**：手滑粘贴、拼进 URL、写进文件、日志留存。
- **防不住主动窃取**：agent 与用户是同一 OS 用户，能读 `master.key`、能 `echo $DSH_CRED_*`、
  能 `cat vault.json` 后自行解密。要防这一层必须换外部 KMS / 独立低权限用户，超出本插件能力。
- **`reveal` 仍是完整泄露路径**，保留是因为"用户明确要看值"是合理需求；降级手段是
  提示词限制 + 审计单列 + 面板红色标记。

## 7. 提示词（`HINT_SECTION` 改为函数）

`text: () => …`，每轮 `assemble()` 重新求值（`dsh-system-prompt` 支持 `text` 为函数，
已核对实现 `resolveSection`/`assemble`）。内容：

1. **凭据索引**：逐条 `name (kind, service; aliases: a, b)`，只出元数据。
   超过 50 条时截断并注明 `…and N more, use action:"search"`。
2. **硬规则 A**：在向用户索取任何密码 / token / API key / 连接串之前，**必须先**
   `action:"list"` 或 `action:"search"`；命中即用，**不得再问用户"叫什么/存哪了"**。
3. **硬规则 B**：使用凭据**只能**通过 `action:"use"` 拿到 `DSH_CRED_*` 变量名，在命令里
   引用变量；**禁止**把值拼进 URL / remote / 命令行参数 / 文件 / 消息。
4. **硬规则 C**：禁止 `echo` / `printenv` / `env` 打印 `DSH_CRED_*`；禁止把变量值写入任何文件。
5. **逃生门**：仅当用户**明确要求看到值**时才 `action:"reveal"`，并说明该次读取已入审计。
6. 保留原约束：不得把明文写进用户未要求的文件或消息。

空库时索引部分换成"库为空，需要时请用户先在面板添加"。

## 8. 审计强化（`lib/audit.js`）

| 字段 | 变化 |
| --- | --- |
| `source` | 现为 `tool`；新增 `use` / `reveal` 语义区分（`source` 保持，新增 `action` 字段） |
| `sessionId` | **新增**，来自 `exec.agent.session.header.id`，无 agent 时为 `null` |
| `resolvedBy` | **新增**，`exact`/`slug`/`alias`/`service`/`keyword`/`null` |
| `outcome` | 扩为 `ok` / `missing` / `rejected` / `ambiguous` |

文件权限从 `644` 改为 `600`（`appendFileSync` 前确保文件存在且 `chmod`）。
审计仍**只记名称与结果**，不记值。

## 9. 面板（`packages/dsh-inventory`）

1. 「类型」下拉增加 `database`（zh「数据库」/ en「Database」）。
2. 新增输入：**服务**（`service`，占位 `github / openai / aliyun-ecs`）、
   **别名**（逗号分隔，提交时切分、去空、去重）。
3. 名称框下方**实时显示规范化后的 slug**，让用户看见"写什么都会被归一"。
4. 列表行与详情显示 `service` 与别名 chips。
5. 只读约束：AI 无任何写入别名的路径（无对应 action），面板是唯一入口。

## 10. 历史明文清理脚本 `scripts/scrub-session-secrets.mjs`

- 默认 **dry-run**：只报告"哪些文件含当前 vault 中的值"，不打印值。
- `--apply`：先备份（`<file>.bak-<ts>`）再就地遮蔽为 `***`，`zstd` 文件解压→替换→重压缩。
- 拒绝在检测到活动 session（`session.lock` 存在且最近修改）时对 `sessions/` 执行 `--apply`。
- 退出码：0 无命中，1 有命中（dry-run），2 执行错误。

## 11. 验收标准

1. `pnpm test` 全绿；`pnpm verify` 全绿（含版本纪律）。
2. `credential list` / `search` / `get` / `use` 的返回体**均不含 secret**（测试断言）。
3. `credential use` 返回 `envVar`，且 `store.reveal` 未被调用（用 fake store 断言）。
4. `normalizeKey` 覆盖：`github token` ≡ `github-token` ≡ `GitHub_Token`；中文名不被破坏。
5. `resolveName` 五级顺序有测试；`ambiguous` 返回候选且**不**返回值。
6. slug 撞名被 `set` 拒绝，错误信息含既有名称。
7. 旧版 `version: 1` 条目读取行为不变（回归测试）。
8. 提示词为函数：两轮 assemble 之间新增凭据后，索引内容变化（用 fake ctx 断言）。
9. 审计含 `sessionId` 与 `resolvedBy`；`reveal` 与 `use` 可区分。
10. 审计文件权限 600。
11. 面板：`database` 可选中、`service`/`aliases` 可保存并回填、slug 预览随输入变化。
12. README 修正错误表述并写明 6.4 威胁模型。
13. `dsh-credential-vault` 0.2.1 → **0.3.0**；`dsh-inventory` 0.5.0 → **0.6.0**。

## 12. 边界（明确不做）

- **不做**编辑距离 / 模糊打分 / 语义检索：命中必须可解释、可审计。
- **不做**别名自动学习：AI 不得写入元数据（用户已明确）。
- **不做**外部 KMS / 硬件密钥 / 独立低权限用户：超出插件能力，只写进威胁模型。
- **不做**批量数据迁移：老条目按缺省值读，只在 `set` 时升版本。
- **不做**会话日志的结构性脱敏钩子：运行时无此扩展点，脚本清理属事后补救。

## 13. Tickets（有序，T4 依赖 T1/T2）

| # | 标题 | 交付物 | 依赖 |
| --- | --- | --- | --- |
| T1 | 数据模型规范化 | `normalizeKey`/`slug`/`service`/`aliases`/`KINDS+database`/`version:2`/撞名校验/旧版兼容 | — |
| T2 | 命中解析 + `search` | `resolveName` 五级 + `action:"search"` + `ambiguous` 候选 | T1 |
| T3 | 动态提示词 | `HINT_SECTION.text` 改函数 + 索引 + 硬规则 A/B/C + 逃生门 | T1 |
| T4 | 零明文使用路径 | `action:"use"` + 票据表 + `shellEnv` contributor + 变量声明同步 | T1,T2 |
| T5 | 审计强化 | `sessionId`/`resolvedBy`/`ambiguous`/权限 600 | T1 |
| T6 | 面板字段 | `database`/`service`/`aliases`/slug 预览/chips | T1 |
| T7 | 历史明文清理脚本 | `scripts/scrub-session-secrets.mjs`（dry-run + `--apply`） | — |
| T8 | 文档与威胁模型 | README 修正、威胁模型章节、面板文案、版本号 | T1–T7 |

## 14. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| `shellEnv` 未挂载的 profile | 用可选 inject（`ctx.inject(['shellEnv'], …)`）；缺失时 `use` **明确报错**「本部署未启用环境变量注入，安全路径不可用；如确需明文请由用户显式要求 reveal」，**绝不静默退化**为 `reveal`（用户 2026-11-04 决定：要求安全） |
| 变量名冲突（两条 slug 同大写形态） | 注册时检测，冲突则拒绝注册并在 `use` 报错 |
| 提示词索引过长挤压上下文 | 硬上限 50 条 + 截断提示 |
| 票据被同一 session 的其他 agent 复用 | 票据键为 `sessionId`，同 session 内共享是有意设计（子 agent 需要同一凭据）；文档写明 |
| 清理脚本破坏会话 | 默认 dry-run、强制备份、活动会话拒绝 `--apply` |
