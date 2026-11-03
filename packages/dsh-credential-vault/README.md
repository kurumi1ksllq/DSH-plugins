# dsh-credential-vault

DeepSeek Harness 凭据保险库插件：把服务器登录密码、GitHub token、API key、数据库连接串等
凭据 AES-256-GCM 加密保存在 `$DSH_HOME/credential-vault/`，AI 在需要时通过一个
`credential` 工具**按名称或任意近似叫法**取用，且默认**拿不到明文**——
它只拿到一个环境变量名。

## 它做什么

- **加密存储**：首次使用自动生成 32 字节主密钥（`master.key`，0600）；每条凭据
  用 AES-256-GCM 单独加密后写入 `vault.json`（0600，原子写）。支持主密钥轮换
  （全部条目重新加密，旧密钥备份为 `master.key.bak`）。
- **规范化元数据**：每条凭据除 `name` 外可带 `service`（`github` / `openai` / `mysql` …）、
  `aliases`（用户手写的别名，如 `gh, git`）与 `kind`
  （`password` / `token` / `api-key` / `ssh-key` / `database` / `other`）。
  内部 `slug` 由 `name` 派生（小写、标点折叠为 `-`），**不落盘**；两条名称折叠后相同
  会被拒绝，避免 `github token` 与 `github-token` 并存互相遮蔽。
  别名与 `kind`/`service` **只由用户在面板维护**，AI 没有任何写入路径。
- **AI 读取**：注册一个 `credential` 工具，五种动作：
  - `action:"list"` — 名称、`slug`、类型、服务、别名、备注，不含任何密钥值；
  - `action:"search", query:"…"` — 五级命中（exact → slug → alias → service → keyword），
    返回候选与命中规则，同样不含值；多条命中时明确返回 `ambiguous`，**绝不猜**；
  - `action:"get", name:"…"` — 返回掩码元数据，密钥不解封；
  - `action:"use", name:"…"` — **推荐路径**。只返回环境变量名（如 `DSH_CRED_GITHUB_TOKEN`）
    与票据过期时间，**不返回密钥**；值由 `dsh-shell-env` 注入到每次 shell 调用里；
  - `action:"reveal", name:"…"` — 返回明文，**逃生门**：仅当用户明确要求看到值时才用，
    且每一次 reveal 都写入审计日志（`audit.log`，JSON lines，面板可见）。
  - `get`/`use`/`reveal` 的 `name` 都走同一套命中解析，因此模型写 `gh` 也能取到
    `github token`。
- **提示词约定**：注入一段 system prompt，**每轮重新求值**并列出当前库里的凭据索引
  （只有名字与元数据）。硬规则：向用户索取任何密码/token/连接串**之前**必须先查库；
  凭据只能通过 `action:"use"` 拿到的 `DSH_CRED_*` 变量使用；禁止把值拼进
  URL / remote / 命令行参数 / 文件 / 消息；禁止 `echo` / `printenv` 打印变量；
  `reveal` 仅在用户明确要求时使用。
- **管理界面（在「工具管理」页里）**：`dsh-inventory` 的**工具管理**页有「凭据保险库」分区与同名
  分段标签：凭据列表（掩码预览）+ 详情 + 新增/编辑/删除 + 主密钥轮换 + 使用日志。
  本 bundle 的浏览器半区只注册 `credential-vault` 命名空间的文案字典，**不再注册侧边栏槽位**。
  **界面的所有接口都不回传明文**——`set` 只收不吐。

## 安装

profile 的 `package.json` 里加一行：

```json
"dependencies": {
  "dsh-credential-vault": "link:../../packages/dsh-credential-vault"
}
```

然后 `pnpm install`，重启 DSH。

## HTTP 接口（工具管理页用，非界面调用方请勿依赖）

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/credential-vault/api/list` | GET | 掩码条目列表 |
| `/credential-vault/api/entry?name=x` | GET | 单条掩码元数据 |
| `/credential-vault/api/audit` | GET | 最近 100 条读取记录 |
| `/credential-vault/api/set` | POST | 新增/更新（明文只进不出；接受 `service` / `aliases`） |
| `/credential-vault/api/delete` | POST | 删除一条 |
| `/credential-vault/api/rotate` | POST | 轮换主密钥 |

所有 POST 都做同源校验（`sec-fetch-site` / `Origin` / `Host`），跨站请求 403。

## 安全边界（威胁模型）

旧版本这里写过一句「明文只存在于进程内存和 `credential` 的返回值里」——**那是错的**，
实测一条 `reveal` 的明文曾出现在 34 个本地文件里（会话日志 24、投影缓存 6、
spill 2、`.git/config` 1、`/tmp` 2）。原因很直接：只要明文进入模型可见的输出，
它就会被持久化，模型还会把它抄进 shell 命令与 job label。

现在的边界是这样：

**做了什么**

- **零明文主路径**：`action:"use"` 返回的只有变量名。票据存在内存里、按会话隔离、
  默认 10 分钟过期、不落盘；`dsh-shell-env` 每次 shell 调用重建 `DSH_*` 快照，
  该快照**不进请求前缀、不进会话日志**。所以模型手上没有值可抄。
- **披露最小化**：HTTP API 的所有响应都不含密钥值（测试覆盖）；面板只显示掩码。
- **审计可追溯**：`audit.log` 记录时间、名称、结果（`ok` / `missing` / `rejected` /
  `ambiguous`）、`action`（`use` 或 `reveal`）、`sessionId`、`resolvedBy` 与原因，
  **不记值**；文件权限 0600。
- **路径安全**：凭据名不允许路径分隔符与控制字符；`master.key` / `vault.json`
  均为 0600，写入走临时文件 + rename 的原子路径。

**没有做什么（请不要误解）**

- **挡不住主动窃取**：agent 的工具进程与你是同一个 OS 用户，它能读 `master.key`、
  能 `echo $DSH_CRED_*`、能 `cat vault.json` 后自行解密。本插件防的是**意外泄露**
  （手滑粘贴、拼进 URL、写进文件、日志留存），不是防恶意 exfiltration。
  要防后者必须换外部 KMS 或独立低权限用户。
- **`reveal` 仍是完整泄露路径**：保留它是因为"用户明确要看值"是合理需求；
  降级手段是提示词限制 + 审计单列。
- **`shellEnv` 缺失时 `use` 会明确报错**，不会静默退化到 `reveal`。
- **历史残留需要手动清理**：见下面的清理脚本。

## 清理历史明文

旧版本写进日志的明文不会自己消失。仓库根目录提供：

```bash
node scripts/scrub-session-secrets.mjs            # 只报告，不改文件（默认）
node scripts/scrub-session-secrets.mjs --apply    # 就地遮蔽，先写 <file>.bak-<时间戳>
```

- 用当前 vault 里的值去比对，报告哪些文件命中、命中几条，**不打印值**。
- `--apply` 前会备份；有活动 `session.lock` 的会话目录会被跳过（运行中的 DSH
  还在追加，替换会打架）。
- `.zstd` 会话日志通过 `zstd` 命令解压/重压；没有该命令时这些文件被标记为跳过。
- 它只处理**当前**库里的值：轮换过的旧值匹配不到，需要单独处理。
- 清理完建议轮换对应凭据——它们曾经以明文存在于磁盘上。

## 测试

```bash
pnpm --filter dsh-credential-vault test
```

102 个测试覆盖：加解密往返与防篡改、掩码规则、文件权限、名称校验、store 全操作、
`normalizeKey` / `slug` / 别名去重 / slug 撞名拒绝 / v1 旧库兼容、五级命中
（exact→slug→alias→service→keyword）与 `ambiguous` 不猜、动态提示词（函数求值 +
索引 + 硬规则）、`use` 的零明文返回与按会话注入（含 TTL 过期、跨会话隔离、
`shellEnv` 缺失时明确报错）、审计字段与 0600 权限、HTTP 路由/校验/同源/405/404，
以及一条贯穿断言：明文不出现在任何工具返回值、HTTP 响应或审计日志里。

仓库根目录另有 7 个测试覆盖历史明文清理脚本（dry-run、备份、活动会话跳过、
压缩日志降级、已轮换值不误伤）。
