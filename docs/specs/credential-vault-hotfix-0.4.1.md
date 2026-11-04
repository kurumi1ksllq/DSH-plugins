# spec: 凭据保险库 0.4.1 热修（#49 审查遗留 8 项）

> 停点2 产物。用户于 2026-11-04 确认三点：
> ① #52 采用**方案 A**：读侧保留危险键、标记 `unsafeName`、`get`/`reveal`/`use` **明确报错**、
>    面板可见可手动删、**写回时绝不删除**；
> ② 接受「凭据很多时提示词里会折叠一部分，模型需用 search」这个取舍；
> ③ `master.key.bak` **只保留最新一份**，更早的自动清理。

## 1. 目标

收口 #49 合并后由双轴审查发现的 8 个问题。全部在 `dsh-credential-vault` 一个包内，
彼此强相关，因此**一个 PR 收口 8 个 issue**：

| issue | 一句话 |
| --- | --- |
| #52 | 读侧丢弃危险键，导致历史凭据被**永久删除** |
| #53 | `trim()` 在控制字符检查之前，尾部换行被静默洗掉 |
| #54 | `isValidName` 漏 Unicode 行分隔符 |
| #55 | 提示词索引整行截断 200，不同名字渲染成同一行 |
| #56 | 整段预算 4000 超 spec 授权，折叠了合法凭据 |
| #57 | 面板「保留密钥」编辑会清空全部元数据 |
| #50 | `rotateKey` 遗留的 `master.key.bak`（**更正：不累积，仅补文档，见 §2.6**） |
| #58 | 文档与 `.flow` 状态不一致 |

## 2. 逐项设计

### 2.1 #52 —— 读侧保留，不删除（方案 A）

**现状**：`adoptEntries` 里 `if (isDangerousKey(key)) continue`，直接把条目从内存丢弃。
0.3.0 允许这些名字入库，于是升级后条目从列表消失，**任何无关写入**会把它们从磁盘永久抹掉。

**改为**：

| 位置 | 行为 |
| --- | --- |
| `adoptEntries` | **保留**条目（不再 `continue`），用无原型对象承载 |
| `list()` / `listMeta()` | 照常返回，**多带 `unsafeName: true`**（`isDangerousKey(name)` 时） |
| `get()` / `reveal()` | 命中危险键时**抛错**（`credential "<name>" has an unsafe name; rename or delete it in the panel`），不返回 `null` |
| `use`（工具） | 同上，通过 `get`/`reveal` 自然抛错 |
| `set()` / `update()` | 仍拒绝（`isValidName` 为 false）：不能**新建**这类名字 |
| `delete()` | 允许：这是用户手动清理的唯一出口，且是显式操作 |
| `writeVault` 路径 | **绝不**删除既有条目 —— 保留是默认行为 |

**为什么 `set` 拒绝但 `delete` 允许**：危险键的危害在于"能被悄悄创建"和"能被当成普通凭据
喂给模型"。既有条目保留可避免数据丢失，而允许显式删除给出清理出口。

`audit.log` 不因这类条目变化（读它们会留 `rejected` 记录，reason 说明 unsafe name）。

### 2.2 #53 —— 控制字符检查提到 trim 之前

```js
if (typeof value !== 'string') throw ...
if (CONTROL_CHARS.test(value)) throw ...   // 先查原始值
const text = value.trim()
if (text.length === 0) return null
if (text.length > max) throw ...
return text
```

纯空格仍被 trim（`'  github  '` → `'github'`），但**任何位置的**换行/控制字符都在 trim 前被拒。

### 2.3 #54 —— `isValidName` 复用 `CONTROL_CHARS`

删除 `isValidName` 里那份窄正则 `[\r\n/\\\u0000-\u001f]`，改为：

```js
typeof name === 'string' &&
name.trim().length > 0 &&
name.length <= 128 &&
!/[/\\]/.test(name) &&          // 路径分隔符
!CONTROL_CHARS.test(name) &&    // 单一事实源
!isDangerousKey(name)
```

**注意**：这条会让**新写入**带 U+2028 的名字被拒，但按 §2.1 既有的这类条目会被保留并标记
（不删除），仍可手动删。

### 2.4 #55 + #56 —— 提示词索引（一并解决）

这两条互相牵涉，必须一起改。

| 项 | 现在 | 改为 |
| --- | --- | --- |
| 名字 | 参与整行 200 截断 | **不截断**（名字是标识符，最长 128） |
| 单行上限 | `INDEX_LINE_MAX = 200`（截整行，名字也被截） | **名字永不截断**；元数据尾部上限 `INDEX_DETAILS_MAX = 640`（= 64 service + 8×64 别名 + 装饰，实测 5.3.0 版算过 612）|
| 整段预算 | `HINT_INDEX_BUDGET = 4000` | 提到 **`8000`**（写进 spec，用户已接受折叠取舍）；验收按「索引段字符数」而不是整段提示词 |
| 别名渲染 | 最多 8 条 | 保持 8 条，超出部分在行尾注明 `+N` |

结果：
- 两个不同的 128 字符名 → **渲染成不同行**
- 50 条合法满配凭据：最坏 ≈ 50 × 720 = 36000 字符，仍会按 8000 预算折叠；
  **这是有意取舍**——折叠时明确提示 `…and N more; call action:"search"`。
- 更新 `hint.test.mjs` 里与真实上限不符的断言。

### 2.5 #57 —— API 只透传真实出现的键

```js
const has = (key) => Object.hasOwn(body ?? {}, key)
meta = validateMeta({
  service: has('service') ? body.service : undefined,
  aliases: has('aliases') ? body.aliases : undefined,
  username: has('username') ? body.username : undefined,
  url: has('url') ? body.url : undefined,
  note: has('note') ? body.note : undefined,
})
```

`validateMeta` 对 `undefined` 返回 `null`（保持现有语义），但 `update()` 只在字段**为
`undefined`** 时保留旧值 —— 所以要让"未提供"与"显式清空"区分开，`validateMeta` 需要
在输入为 `undefined` 时返回 `undefined`。

**因此同步调整** `validateMeta`：`undefined` 入参 → 输出 `undefined`（表示"未提供"）；
`null` 或空串入参 → 输出 `null`（表示"清空"）。`set()` 侧把 `undefined` 归一成 `null`。

### 2.6 #50 —— 更正：前提错误，无需改代码

写 TDD 测试时实测：**`.bak` 不会累积**。`vault-store.js` 用的是固定文件名
`master.key.bak`，每次轮换直接覆盖上一份（轮换 3 次后目录里只有 1 份）。
提 issue 时只看了 `copyFileSync` 一行就推断会累积，**没有实测** —— 记录为教训。

仍然要做的是 README 提示：`.bak` 是**明文主密钥副本**，确认新密钥可用后应删除。
issue #50 已附实测证据并关闭为无效。

### 2.7 #58 —— 文档与状态一致性

- spec `credential-vault-security-fixes.md` §8 的 T4 行：`0.3.1` → `0.4.0`
- `.flow/48.json`：ticket 标题同步、`ci.run` 改为实际值（2）
- 把「改 spec 需回停点2 确认」写进 `packages/dev-flow-skill/SKILL.md`

## 3. 验收标准

1. 含 `constructor` 条目的历史库：`list()` 能看到且带 `unsafeName: true`
2. `get('constructor')` / `reveal('constructor')` **抛错**（不是返回 null）
3. 执行无关 `set` 后，磁盘上该条目**仍在**
4. 显式 `delete('constructor')` 后消失
5. `set('constructor', …)` 仍被拒（不能新建）
6. `service: 'github\n'` → 400；`'\ngithub'` → 400；`'github\r\n'` → 400；`'  github  '` → 200 且存成 `'github'`
7. `isValidName('a\u2028b')` / `'a\u2029b'` / `'a\u200bb'` 均为 false；中文名仍可用
8. 两个不同的 128 字符名在提示词里渲染成**不同**行
9. 50 条满配凭据时预算生效并给出 `…and N more`
10. 空 secret 编辑后 `service`/`aliases`/`username`/`url` **原样保留**
11. 显式 `service: ''` 仍能清空该字段
12. 连续轮换 3 次后目录里最多 1 份 `.bak`，且新密钥能解开全部条目
13. 全部既有测试绿；`pnpm test` + `pnpm verify` 全绿
14. 版本 `0.4.0` → **`0.4.1`**（纯缺陷修复；本批不再收紧对外契约，`unsafeName` 细节见下）

**关于版本号**：本批修的是缺陷，不新增错误码（`unsafeName` 只是 payload 上的额外字段，
`get`/`reveal` 抛错取代返回 null 属修复语义），因此 `0.4.1` 合适。

## 4. 边界（明确不做）

- **不做**危险键自动改名迁移（用户选 A）
- **不做**导出/导入（#51 单独）
- **不做**提示词索引的分页/懒加载
- **不改**存储结构（仍按 `name` 索引）
- **不改** `HINT_INDEX_LIMIT = 50`（只调整预算与单行上限）

## 5. 影响面

| 文件 | 改动 |
| --- | --- |
| `lib/store.js` | `adoptEntries` 保留条目；`checkSingleLine` 顺序；`isValidName` 用 `CONTROL_CHARS`；`validateMeta` 区分 `undefined`/`null` |
| `lib/vault-store.js` | `list`/`listMeta` 加 `unsafeName`；`get`/`reveal` 对危险键抛错 |
| `lib/hint.js` | 名字不截断；`INDEX_LINE_MAX=720`；`HINT_INDEX_BUDGET=8000`；别名 `+N` |
| `lib/api.mjs` | 只透传 body 中真实出现的键 |
| `test/` | 新增/改写对应用例（含 #52 的"写回不删"回归） |
| 文档 | 本包 README（`.bak` 说明、`unsafeName`）、spec §8 T4、`.flow/48.json`、SKILL.md 补规则 |

## 6. Tickets

| # | 标题 | 依赖 |
| --- | --- | --- |
| T1 | #53 顺序 + #54 复用 CONTROL_CHARS（同一函数族） | — |
| T2 | #52 危险键保留 / 抛错 / 写回不删 | T1 |
| T3 | #57 只透传真实出现的键（含 `validateMeta` 语义） | — |
| T4 | #55+#56 提示词索引 | — |
| T5 | #50 `.bak` 清理 | — |
| T6 | #58 文档与状态 | T1–T5 |

T1/T3/T4/T5 互不依赖，可并行实现；T2 依赖 T1（共用 `CONTROL_CHARS` 语义）。
