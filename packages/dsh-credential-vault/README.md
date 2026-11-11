# dsh-credential-vault

DeepSeek Harness 凭据保险库插件：把服务器登录密码、GitHub token、API key、数据库连接串等
凭据 AES-256-GCM 加密保存在 `$DSH_HOME/credential-vault/`，AI 在需要时通过一个
`credential` 工具**按名称或任意近似叫法**取用，且默认**拿不到明文**——
它只拿到一个环境变量名。

## 它做什么

- **加密存储**：首次使用自动生成 32 字节主密钥（`master.key`，0600）；每条凭据
  用 AES-256-GCM 单独加密后写入 `vault.json`（0600，原子写）。支持主密钥轮换
  （全部条目重新加密，旧密钥备份为 `master.key.bak` —— **它是明文密钥副本，
  确认新密钥可用后应手动删除**）。
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
  （只有名字与元数据；索引有 8000 字符预算，超过会折叠成
  `…and N more; call action:"search"`——这是有意取舍，名字**永不截断**）。硬规则：向用户索取任何密码/token/连接串**之前**必须先查库；
  凭据只能通过 `action:"use"` 拿到的 `DSH_CRED_*` 变量使用；禁止把值拼进
  URL / remote / 命令行参数 / 文件 / 消息；禁止 `echo` / `printenv` 打印变量；
  `reveal` 仅在用户明确要求时使用。
- **导出 / 导入（0.5.0）**：整库凭据打包成**口令加密的 `.dsvault` 信封**
  （scrypt N=2¹⁷ + AES-256-GCM，header 进 AAD），用于跨设备同步。导入按**稳定 id**
  去重（同名不同内容的凭据报告冲突、绝不覆盖），导入端用本机 master.key 重新加密。
  面板有导出/导入表单；CLI 为 `bin/vault-sync.mjs`（`pnpm vault:export` / `vault:import`），
  口令只从 stdin 读，**没有环境变量入口**。威胁模型见下文「已知限制」。
- **凭据级 TTL（0.6.0）**：`set` / `update` / HTTP API 接受可选 `ttlSeconds`（正整数，或 `null` 清除）；`use` 拿到的授权以它封顶，并在返回值里报 `ttlSeconds`；过期后重新 `use` 即可。存量无 TTL 的记录行为不变。
- **管理界面（在「工具管理」页里）**：`dsh-inventory` 的**工具管理**页有「凭据保险库」分区与同名
  分段标签：凭据列表（掩码预览）+ 详情 + 新增/编辑/删除 + 主密钥轮换 + 使用日志。
  本 bundle 的浏览器半区只注册 `credential-vault` 命名空间的文案字典，**不再注册侧边栏槽位**。
  **界面的所有接口都不回传明文**——`set` 只收不吐。

## 安装

本包是 [DSH-plugins](../../README.md) 仓库的 bundle 之一(完整清单见根 README)。先按根 README 的「装上」clone 并 `pnpm install`，再在 profile 的 `package.json` 里接两处：

```json
"dependencies": {
  "dsh-credential-vault": "link:<仓库绝对路径>/packages/dsh-credential-vault"
}
```

并把 `"dsh-credential-vault"` 加进同一份 `package.json` 的 `dsh.profile.bundles`——只加依赖不会加载。首次接线需要一次 DSH 冷启动才会读新的 `package.json`；**重启必须先拿到用户明确批准**（见 `AGENTS.md`）。

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

## 0.4.0 的对外契约变更

0.4.0 是**缺陷修复版本，但包含两处输入收紧**，升级前请知悉：

| 变更 | 影响 |
| --- | --- |
| 新增 `400 invalid-metadata` | `POST /set` 的 `service`/`aliases`/`username`/`url`/`note` 超限、含换行或类型不符时返回 400，**不再静默丢弃或截断** |
| 拒绝危险键名 | 名字为 `__proto__` / `toString` / `constructor` 等 `Object.prototype` 自有属性时拒绝写入（这些名字此前会让凭据静默消失或产生幽灵条目） |
| `aliases` 必须是字符串数组 | 非字符串元素返回 400（此前被静默过滤）；空串与重复仍会归一化 |

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
- **路径与键名安全**：凭据名不允许路径分隔符与控制字符，也**不允许是
  `Object.prototype` 的自有属性名**（`__proto__` / `toString` / `constructor` …）。
  后者曾能在 0.3.0 上复现：`set('__proto__')` 会让条目静默消失并污染 `entries`，
  而 `get('toString')` 会沿原型链返回一条**不存在的凭据**。`vault.json` 的 `entries`
  现为无原型对象，查表一律用 `Object.hasOwn`。
  否决用的是 `Object.prototype` 自有属性这一有限集合，不限制字符集，所以
  `阿里云 ECS 密码` 这类中文名照常可用。
- **危险键名的存量条目（0.4.1）**：0.3.0 允许用 `__proto__` / `toString` 这类名字
  建凭据。0.4.0 起写入被拒，但**已有的条目不会被删除**——它们在面板里可见并标记
  `unsafeName: true`，`get` / `reveal` / `use` 会明确报错，只有你在面板里显式删除才会消失。
- **元数据校验**：`service` / `aliases` 会**逐字进入每轮系统提示词**，因此在 store 与
  HTTP API 两处都强制单行且限长（`service` ≤64、`aliases` ≤16 条×≤64、
  `username` ≤128、`url` ≤512、`note` ≤512 但允许换行）。超限返回
  `400 invalid-metadata`，**不静默截断**。提示词侧还有第二道防线：索引渲染时会压平
  换行并截断，即使历史数据里已含换行也进不了提示词结构。这里的"换行"包括
  `\n` / `\r`、NEL(`U+0085`)、LS(`U+2028`)、PS(`U+2029`)——后三者在 JavaScript
  和多数 Markdown 渲染器里同样算换行。

**没有做什么（请不要误解）**

- **挡不住主动窃取**：agent 的工具进程与你是同一个 OS 用户，它能读 `master.key`、
  能 `echo $DSH_CRED_*`、能 `cat vault.json` 后自行解密。本插件防的是**意外泄露**
  （手滑粘贴、拼进 URL、写进文件、日志留存），不是防恶意 exfiltration。
  要防后者必须换外部 KMS 或独立低权限用户。
- **`reveal` 仍是完整泄露路径**：保留它是因为"用户明确要看值"是合理需求；
  降级手段是提示词限制 + 审计单列。
- **`use` 内部仍然调用 `store.reveal`**：那是存储层"取一条明文"的能力，`use` 只是
  保证它**不进入返回值**。不要把这两件事混为一谈——"工具返回值不含值"是契约，
  "进程内从不出现明文"不是，也不可能是（要注入就必须先解封）。
- **`shellEnv` 缺失时 `use` 会明确报错**，不会静默退化到 `reveal`。
- **历史残留需要手动清理**：见下面的清理脚本。
- **导出文件（0.5.0）离线可破解**：口令强度直接决定安全性；文件泄露 + 口令泄露 =
  全库泄露。建议走私密渠道传输，导完即删。
- **回滚攻击防不住**：拿旧的导出文件用 overwrite 模式重导，能把已轮换的凭据换回旧值
  （导入时会提示「本机较新」，但拦不住显式覆盖）。记为已知限制。
- **导出/导入端点非认证**：同源校验只防浏览器 CSRF；本机任何进程（含 agent）都能调用。
- **`master.key.bak`**：`rotateKey` 会留一份明文旧密钥，确认新密钥可用后应手动删除。

## 清理历史明文

旧版本写进日志的明文不会自己消失。仓库根目录提供：

```bash
node scripts/scrub-session-secrets.mjs              # 只报告，不改文件（默认）
node scripts/scrub-session-secrets.mjs --apply      # 就地遮蔽，原件备份到扫描根之外
node scripts/scrub-session-secrets.mjs --apply --no-backup   # 连副本都不留
node scripts/scrub-session-secrets.mjs --roots A,B  # 额外/自定义扫描根
```

- 用当前 vault 里的值去比对，报告哪些文件命中、命中几条，**不打印值**。
- **默认只扫 `$DSH_HOME/sessions` 与 `$DSH_HOME/storages`**。实测泄露过的其他位置
  （`/tmp` 下的 spill 文件、其他仓库 `.git/config` 里的 remote URL）需要你自己 `--roots`，
  脚本不替你决定要动哪里。
- `--apply` 会把原件备份到**扫描根之外**（默认 `$DSH_HOME/scrub-backups/<时间戳>/`，
  目录 0700、文件 0600）。**注意：备份文件里仍然是明文**，确认清理结果后请自行删除。
- **活动会话判定看 `session.lock` 的新鲜度（60 秒内）**，不是"文件存在"——POSIX 上
  flock 释放后不会删该文件，本机实测有 100+ 个残留锁；只看存在性会让脚本跳过它唯一
  该清理的那批文件。
- 只搜索长度 ≥ 8 的值：更短的口令会全局误伤，脚本会把它们单独列出来要求手工处理。
- 含 NUL 字节的文件按二进制跳过，不做 utf8 读→写。
- `.zstd` 会话日志通过 `zstd` 命令解压/重压；没有该命令时这些文件被标记为跳过。
- 退出码：0 无命中、1 有命中（dry-run）、2 执行错误（含任一文件写回失败）。
- 它只处理**当前**库里的值：轮换过的旧值匹配不到，需要单独处理。
- 清理完建议轮换对应凭据——它们曾经以明文存在于磁盘上。

## 测试

```bash
pnpm --filter dsh-credential-vault test
```

测试覆盖（`test/*.test.mjs`，离线）：加解密往返与防篡改、掩码规则、文件权限、名称校验（含危险键名与 Unicode 分隔符）、store 全操作、
`normalizeKey` / `slug` / 别名去重 / slug 撞名拒绝 / v1 旧库兼容、五级命中
（exact→slug→alias→service→keyword）与 `ambiguous` 不猜、动态提示词（函数求值 +
索引 + 硬规则）、`use` 的零明文返回与按会话注入（含 TTL 过期、跨会话隔离、
`shellEnv` 缺失时明确报错）、审计字段与 0600 权限、元数据校验与提示词注入防御（含 0.4.1 的保留-标记-拒绝语义）、HTTP 路由/校验/同源/405/404，
以及一条贯穿断言：明文不出现在任何工具返回值、HTTP 响应或审计日志里。

仓库根目录另有 13 个测试覆盖历史明文清理脚本（dry-run、备份外置、陈旧锁不再挡路、
短值/二进制防护、写回失败上报、压缩日志降级、已轮换值不误伤、CLI 退出码）。
