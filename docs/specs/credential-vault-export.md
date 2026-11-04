# spec: 凭据保险库导出 / 导入（跨设备同步）

> 停点2 产物（**第二版**；原稿在临时 worktree 清理中丢失，本版按会话内确认过的
> 决策与三轴审查结论重写，设计不变）。用户于 2026-11-04 确认：
> ① 口令加密信封，非明文；② 去重按**唯一 id**，不按名称；③ 面板与 CLI 同批做；
> ④ 与「现存安全缺陷修复」拆成两个 issue（#48 已合并）；
> ⑤ scrypt 提到 **N=2¹⁷**；⑥ CLI 放包内 `bin/`（测试自动收集）；
> ⑦ 接受「凭据多时提示词索引折叠」的取舍（此为 hint 侧，与本 spec 无关但同期）。

## 1. 目标

把整库凭据安全地搬到另一台设备：

1. **单个口令加密文件**（`.dsvault`），可放网盘/U 盘/私有 git；丢了没口令也解不开。
2. **按 id 去重**：同一凭据重复导入不产生副本；不同凭据即使同名也各自保留。
3. **导入端用本机 master.key 重新加密**：两台设备不共享主密钥。

## 2. 现状约束（0.4.1 代码事实）

| 事实 | 位置 | 影响 |
| --- | --- | --- |
| 条目按 `name` 索引 | `lib/store.js` | 本机不允许重名；id 只解决跨设备去重 |
| 条目无稳定标识 | `lib/vault-store.js` `set()` | 必须新增 `id` |
| `set()` 全新对象重建条目 | `lib/vault-store.js` | 新增字段必须显式保留 |
| `readVault` 无版本上界 | `lib/store.js` | 须防旧插件把 v3 读成 v2 写回 |
| 无 rename 操作 | 全仓 | 导入不做改名 |
| `set()` 逐条 `writeVault` | `lib/vault-store.js` | 批量导入必须单事务 |
| `MAX_BODY_BYTES=128KiB` | `lib/http.mjs` | import 路由需单独 `bodyLimit` |
| 路由硬编码 6 条 | `index.js` | 加路由 + `index.test.mjs` 断言数量 |
| 元数据校验 `validateMeta` | `lib/store.js`（0.4.0+） | 导入载荷必须走同一套校验 |
| 危险键否决 `isDangerousKey` | `lib/store.js`（0.4.0+） | 导入 name 复用 |

## 3. 数据模型：稳定 id（vault `version: 3`）

### 3.1 条目新增 `id`

- UUID v4，创建时生成（`set()` 里 `previous?.id ?? randomUUID()`），**永不变更**
- `name` 仍是本机存储键；`id` 是跨设备身份
- `set()`/`update()` 用 `...previous` 已自然保留 id；`list()`/`listMeta()`/`get()`/
  `reveal()` 输出**补上 `id` 字段**（`set` 返回值不加 id，避免两条 deepEqual 红）
- 老条目（无 id）：**导出时**生成真 UUID 并**写回本机 vault**（一次性迁移），
  派生 id（`sha256(name+createdAt)`）**不进入传输**——审查证明它可被第三方精确构造

### 3.2 版本上界

`readVault` 遇 `version > VAULT_VERSION` 抛 `unsupported-vault-version`，不静默降级。

## 4. 导出文件格式 `.dsvault`

```json
{
  "format": "dsh-credential-vault-export",
  "version": 1,
  "exportedAt": "<ISO>",
  "kdf": { "name": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "<b64 16B>" },
  "cipher": { "name": "aes-256-gcm", "iv": "<b64 12B>", "tag": "<b64 16B>" },
  "payload": "<b64 密文>"
}
```

密文解开后的载荷：

```json
{ "sourceVaultVersion": 3,
  "entries": [ { "id": "uuid", "name": "…", "kind": "…", "service": "…",
                 "aliases": […], "username": "…", "url": "…", "note": "…",
                 "createdAt": "…", "updatedAt": "…", "secret": "<明文>" } ] }
```

**包含**全部元数据（另一台设备五级命中能力一致）；**不包含** `audit.log`、`master.key`。

### 4.0 载荷必须由新增 `store.exportEntries()` 产生

`reveal()` 拿不到 `service`/`aliases`/`id`/时间戳。`exportEntries()`：
一次 `readVault` + 逐条 `openSecret`，返回完整字段，是**唯一批量明文入口**。
坏条目（解密失败）→ 跳过 + 计入 `corrupt`，不让一条坏条目毁掉全库备份。

### 4.1 密码学决策

| 项 | 决定 | 理由 |
| --- | --- | --- |
| KDF | scrypt **N=131072(2¹⁷), r=8, p=1**，显式 `maxmem` | 实测 ~500ms/128MiB；抬高离线暴力成本 |
| KDF 参数 | **只接受等于内置常量** | 信封里 N=2³⁰ → 128GiB DoS；Node 默认 maxmem 32MiB 会炸 |
| AAD | `format\|version\|kdf.name\|N\|r\|p\|exportedAt` | 防 header 篡改/版本降级/回滚 |
| salt/IV | 每次导出新生成（16B/12B） | 防 nonce 复用 |
| 口令 | ≥12 字符，非空；NFC 规范化后比较 | 弱口令是唯一代码无法弥补的环节 |
| 错误码 | 口令错/篡改/参数不符统一 `bad-passphrase-or-tampered`；**本地 stderr 与审计可细分** | 防 oracle，保排障 |

## 5. API

| 路由 | 方法 | 请求 | 成功响应 |
| --- | --- | --- | --- |
| `/credential-vault/api/export` | POST | `{ passphrase }` | `{ ok, filename, content }`（**密文信封**） |
| `/credential-vault/api/import` | POST | `{ passphrase, content, mode }` | `{ ok, imported, updated, skipped, conflicts, stale, corrupt }` |

`mode ∈ {"skip","overwrite"}`，默认 `skip`。

### 5.1 bodyLimit 按路由

routes 表条目带 `bodyLimit`；import = `8MiB + 64KiB`，其余沿用 128KiB；
`readJsonBody(req, route.bodyLimit ?? maxBodyBytes)`。**不抬全局**（保护 `/set`）。
路由内再校验 `content.length > 8MiB → 413`。

### 5.2 校验顺序（解密前）

`content` ≤ 8MiB、`passphrase` 非空 ≤1024 → 信封 format/version 匹配 →
kdf/cipher 是已知算法 → kdf 参数等于内置常量。任一不符 → `bad-passphrase-or-tampered`。

### 5.3 审计

`export`/`import` 写 `action`、`sessionId`、`outcome`、`reason`（细分、不含口令与值）。
导出是最高风险动作，必须可追溯。

### 5.4 filename 由 host 生成

`<hostname>-<YYYYMMDD>.dsvault`，前端原样使用。

## 6. 导入合并（两阶段，消除顺序依赖）

### 6.1 第一阶段：载荷校验（任一不合格**整批拒绝**）

- `id` 是合法 UUID v4
- `name` 过 `isValidName`（含危险键否决）
- `kind` ∈ KINDS；`service`/`aliases`/`username`/`url`/`note` 过 `validateMeta`
- `secret` 非空字符串
- **批内 id 唯一**；**批内 slug 唯一**（折叠后不撞）

### 6.2 第二阶段：按快照合并（先建 `localById`/`localBySlug`，合并期间不重读）

| # | 条件 | skip | overwrite |
| --- | --- | --- | --- |
| 1 | 同 id **且同名** | 跳过（本机 updatedAt 更新 → 计 stale） | 覆盖（本机 key 重封）；本机更新 → conflicts |
| 2 | 同 id **但异名** | **conflicts，不写入** | **conflicts，不写入** |
| 3 | 无该 id，但 name/slug 被别的 id 占 | **conflicts，不写入** | **conflicts，不写入** |
| 4 | 其余 | 新增 | 新增 |

- **同 id 异名一律 conflicts**（原方案会让 `{id:A,name:"beta"}` 静默销毁本机 `beta{id:C}`）
- **不做改名**（代码无 rename 操作）
- **必须按 `(id,name)` 双键预查，不调 `set()` 判重**——`set()` 同名即覆盖，靠它兜底会假通过

### 6.3 写入：单事务

先写 `vault.json.bak-<ts>`（0600）→ 内存副本完成全部改动 → **一次** `writeVault` →
清理残留 `tmp-*`。写盘失败 → vault 保持导入前状态。

### 6.4 时间戳

新增：`createdAt`/`updatedAt` 保留导入值。
覆盖：`createdAt` 取**较早**者；`updatedAt` 保留导入值。`stale` 计数提示本机更新。

## 7. CLI（`packages/dsh-credential-vault/bin/vault-sync.mjs`）

```bash
node packages/dsh-credential-vault/bin/vault-sync.mjs export --out FILE [--vault DIR]
node packages/dsh-credential-vault/bin/vault-sync.mjs import --in FILE [--vault DIR] [--mode skip|overwrite] [--dry-run]
node packages/dsh-credential-vault/bin/vault-sync.mjs inspect --in FILE
```

- 口令**只从 stdin 或 `--passphrase-fd N`** 读；**不提供环境变量入口**
  （agent 能跑 CLI，环境变量口令 = 模型获得全库导出能力）
- `main` 是 `async`、`readPassphrase` 可注入；测试放包内 `test/vault-sync.test.mjs`
- `--dry-run`：完整校验与合并不写盘；`inspect` 只验信封头不解密
- 退出码：0 成功 / 1 有 conflicts 或 stale / 2 执行错误
- 根 `package.json` 加 `vault:export`/`vault:import` 快捷入口；包 `files`+`bin` 登记

## 8. 面板（`dsh-inventory` 凭据分段）

1. 工具条加**导出**、**导入**按钮，新增 `aux` 状态与 `editing`/`selectedName` 互斥
2. 导出：口令 + 确认口令（`autocomplete="new-password"`），不一致本地拦下；
   成功后下载 `<filename>`（host 生成）并提示「密文，用完请删」
3. 导入：口令 + 粘贴信封内容 + 覆盖开关；显示
   `导入 N / 更新 M / 跳过 K / 冲突 J / 过期 S / 损坏 C`，冲突逐条列出
4. **下载可注入**：`defaultSaveFile` 内 `typeof document === 'undefined'` 守卫 +
   try/catch；`CredentialVault` 接受 `props.saveFile`/`props.readFile`（默认实现用
   `Blob`+`createObjectURL`+`<a download>`，官方 bundle 有先例、线上无 CSP 拦截）
5. **不用 `useRef`**（测试运行时无此 hook）、**不用 `FileReader`**（Node 无）、
   **不引 jsdom**（workspace 零 devDependencies，动 lockfile 触发 CI 守卫）
6. 新文案必须都被 `t()` 读到（死键闸），zh/en 键集一致

## 9. 验收标准

1. 信封往返：同口令可解；错口令抛错；密文改一字节抛错；**改 header 的 exportedAt 抛错**（AAD）
2. 两次导出 salt/iv 不同
3. 信封 kdf 参数 ≠ 内置常量 → 统一错误码，**不分配额外内存**（N=2³⁰ 不炸）
4. 导出响应**只含密文**；解密后才出现明文
5. v3 库经一次 `set()` 后 `version===3` 且该条 id 不变
6. `readVault` 遇 `version>3` 抛 `unsupported-vault-version`
7. 老条目（无 id）导出时被铸真 UUID 并**写回本机**；两次导出 id 一致
8. 同一文件导入两次 → 第二次 `imported===0`、`skipped===条目数`
9. **同 id 异名 → conflicts**，本机原条目 secret 不变（**走 HTTP 断言**）
10. **同名异 id → conflicts**，本机未修改（**走 HTTP 断言**）
11. 同 id 同名 + 本机 updatedAt 更新 + overwrite → 转 conflicts
12. 批内两个同 id / 两个同 slug → 整批拒绝，vault 不变
13. 导入后库内不存在两条同 slug
14. 写盘失败（注入失败 writer）→ vault 保持导入前状态，无残留 `tmp-*`
15. 审计含 `action:"export"`/`"import"` 与 `sessionId`，不含口令与值
16. 坏条目导出：跳过 + `corrupt===1`，其余条目完整
17. CLI：export 产物可被 import 读回；`--dry-run` 不写盘；退出码符合 §7
18. 恶意 name（`__proto__`）在载荷校验阶段整批拒绝
19. 8 MiB content → 200；8 MiB+1 → 413；`set` 超 128KiB 仍 413
20. 路由数 6→8，`index.test.mjs` 同步 + export/import 存在性断言
21. `set()` 返回值**不加 id**（既有 deepEqual 不红）
22. 面板：`saveFile` spy 收到 `{filename,text}` 且 text 无明文；口令不一致时 spy 与 `/export` 调用数均为 0
23. `pnpm test` + `pnpm verify` 全绿
24. `dsh-credential-vault` 0.4.1 → **0.5.0**；`dsh-inventory` 0.7.1 → **0.8.0**
25. 版本纪律顺序：先升版 → 合入 → 打 tag → tag 后不再动该目录

## 10. 边界（明确不做）

- 本机重名支持；导入时改名；云端同步/自动上传/三方合并；审计跨设备迁移；
  口令强度评估（只验 ≥12）；导出 `master.key`；并发文件锁

## 11. 威胁模型（写进 README）

- 导出文件**离线可破解**：口令强度直接决定安全性
- 文件泄露 + 口令泄露 = 全库泄露；建议走私密渠道，导完即删
- **回滚攻击防不住**：`exportedAt` 进 AAD 但不参与合并决策，旧文件 overwrite
  可把已轮换凭据换回旧值。缓解：`stale` 计数 + 面板警告。记入已知限制
- 文件投毒：能解密即接受。建议先 `inspect` 再 `--dry-run`
- 多设备并行编辑：最后导入者覆盖
- 面板下载目录：密文落盘，用后删除
- `master.key.bak`：rotateKey 留一份明文旧密钥，与本次同类残留风险，README 待办
- **导出/导入端点非认证**：同源校验只防浏览器 CSRF，本机任何进程都能调用

## 12. 影响面

| 文件 | 改动 |
| --- | --- |
| `lib/store.js` | `VAULT_VERSION=3`；`readVault` 版本上界；`exportEntries()` |
| `lib/vault-store.js` | `set` 生成 id 并保留；`list/listMeta/get/reveal` 输出 id |
| `lib/envelope.mjs` | **新增**：seal/open、参数 allowlist、AAD |
| `lib/merge.mjs` | **新增**：纯函数两阶段合并 |
| `lib/api.mjs` | export/import 路由、按路由 bodyLimit |
| `index.js` | 路由 6→8 |
| `bin/vault-sync.mjs` | **新增** CLI |
| `dsh-inventory/client.js` | 导出/导入 UI + 可注入 saveFile + zh/en 文案 |
| `test/` | envelope / merge / export-import / vault-sync 测试；index 路由数 |
| 文档 | 两包 README、根 README 计数、CHANGELOG |

## 13. Tickets

T1 稳定 id + 版本上界 + exportEntries（T2 可并行）
T2 `lib/envelope.mjs`
T3 `lib/merge.mjs`（依赖 T1）
T4 export/import API（依赖 T1,T2,T3）
T5 面板 UI（依赖 T4）／T6 CLI（依赖 T2,T3,T4）——可并行
T7 文档与版本（依赖全部）

## 14. 对抗审查记录

三轴审查（安全/数据一致性/实施）判第一版**不通过**，本版全部采纳：
提示词注入（→ 依赖 #48 已修 + §6.1 复用 validateMeta）、overwrite 不可逆（→ §6.3）、
scrypt 偏弱（→ 2¹⁷）、无 AAD（→ §4.1）、kdf DoS（→ 白名单）、legacy id 可构造
（→ §3.1 铸真 UUID）、环境变量口令（→ 删）、body 上限冲突（→ §5.1）、
`reveal()` 拿不到元数据（→ §4.0 exportEntries）、同名异 id 被静默覆盖（→ §6.2 双键预查）、
下载不可测（→ §8.4）、CLI 测试漏跑（→ §7 包内 bin）。
