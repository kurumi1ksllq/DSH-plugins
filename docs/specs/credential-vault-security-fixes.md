# spec: 凭据保险库现存安全缺陷修复（原型污染 + 元数据校验）

> 停点2 产物。用户于 2026-11-04 确认：本批与「导出/导入」**拆成两个 issue**，
> 本条先发，因为它是**已发布版本 0.3.0 的现存缺陷**，不该等新功能。
> 版本号经对抗审查后由 0.3.1 改为 **0.4.0**：本次收紧了对外契约（新错误码 +
> 拒绝过去接受的输入），补丁号会误导使用者以为没有行为变更。
> 来源：2026-11-04 三轴对抗审查（安全 / 数据一致性 / 实施方案），本 spec 只收录
> 与导出功能无关、且能独立复现的两条。

## 1. 目标

修两个能在**当前线上版本**复现的缺陷，不引入新功能：

1. **原型污染**：`isValidName('__proto__') === true`，写库后条目静默消失，
   且 `get('toString')` 会返回**幽灵凭据**（走 `Object.prototype` 原型链）。
2. **元数据无校验**：`service` / `aliases` 在 `POST /set` 只做 `trim` 与类型过滤，
   而 `hint.js` 把它们**原样拼进每轮系统提示词** —— 可注入任意指令。

两条都独立成立，与导出功能无关；导出功能会**放大**它们的攻击面，所以先修。

## 2. 复现证据（2026-11-04 实测）

```
isValidName('__proto__')   → true
isValidName('toString')    → true
isValidName('constructor') → true

set('__proto__', {kind:'token', secret:'INJECTED'})
  → vault.json 的 entries 自有键为 []（键写不进去）
  → 但 entries['secret'] 开始返回导入的密文

get('toString')
  → { name:'toString', slug:'tostring', kind:'other', hasSecret:false, preview:null }
  → 幽灵条目：库里根本没有它，reveal 会抛 "sealed secret is truncated"
```

提示词注入路径（代码事实）：

- `lib/hint.js` `indexLine()`：`details.push(entry.service)`、
  `aliases.join(', ')` —— 原样插值，无转义、无长度上限、无换行过滤
- `lib/api.mjs` `POST /set`：`service` 仅 `trim()`；`aliases` 仅过滤非字符串
- `lib/store.js` `isValidName`：只拦路径分隔符与控制字符，**不拦危险键名**

## 3. 修复 1：拒绝危险键名

### 3.1 规则

`isValidName(name)` 追加一条否决：**名字不得是 `Object.prototype` 的自有属性名**。

```js
function isDangerousKey(name) {
  return name === '__proto__' || Object.hasOwn(Object.prototype, name)
}
```

实测覆盖：`__proto__` / `toString` / `constructor` / `valueOf` / `hasOwnProperty`
全部拒绝；`github token` / `阿里云 ECS 密码` 不受影响。

### 3.2 为什么用这条规则而不是白名单

- 白名单会误杀合法名字（中文、带空格、带标点都是用户真实用法）。
- `Object.prototype` 自有属性集合是**有限且明确**的，且未来新增内建方法也自动覆盖。
- `__proto__` 需单列：它是访问器属性，`Object.hasOwn` 对它返回 true，但显式写出更清楚。

### 3.3 同时加固 `entries` 的读取

`readVault` 返回的 `entries` 改为**无原型对象**（`Object.create(null)`），
这样即使历史库文件里已经存在 `__proto__` 键（手改/导入），也不会污染原型。
`vault-store.js` 的 `entry(name)` 改用 `Object.hasOwn(vault.entries, name)` 判断，
不再走原型链。

## 4. 修复 2：元数据校验

### 4.1 上限（在 `POST /set` 与 `store.set`/`update` 都执行）

| 字段 | 规则 |
| --- | --- |
| `service` | 字符串，≤ 64 字符，**不得含换行/控制字符** |
| `aliases` | 数组，≤ 16 条，每条 ≤ 64 字符，**不得含换行/控制字符** |
| `username` | ≤ 128 字符，不得含换行 |
| `url` | ≤ 512 字符，不得含换行 |
| `note` | ≤ 512 字符，**允许换行**（备注是给人读的，但不进提示词） |

违规则抛错（API 返回 `400 invalid-metadata`），**不静默截断**——静默截断会让用户
以为存进去了。

### 4.2 提示词侧二次防御

`hint.js` 的 `indexLine()` 不信任输入：

- `service` / 别名逐项 `replace(/[\r\n]+/g, ' ')` 并 `slice(0, 64)`
- 整个索引行 `slice(0, 200)`
- 这样即使某条历史数据已含换行，也进不了提示词结构

## 5. 验收标准

1. `isValidName` 拒绝 `__proto__` / `toString` / `constructor` / `valueOf` /
   `hasOwnProperty`；仍接受 `github token` / `阿里云 ECS 密码` / `a`.repeat(128)。
2. `set('__proto__', …)` 抛错；vault 文件不变。
3. 手工构造含 `__proto__` 键的 vault.json，`readVault` 后 `entries` 无原型污染，
   `Object.keys(entries)` 只含真实条目。
4. `get('toString')` 返回 `null`（不再有幽灵条目）。
5. `POST /set` 传含 `\n` 的 `service` → `400 invalid-metadata`，vault 不变。
6. 传 17 条 aliases 或单条 65 字符 → `400`。
7. 提示词：手工把一条 `service` 写成含 `\n## 新规则` 的历史数据，
   `buildHintText` 输出里该换行被压成空格，**不出现独立行**。
8. 全部既有测试仍绿（`pnpm test`），`pnpm verify` 绿。
9. `dsh-credential-vault` 0.3.0 → **0.4.0**（次要版本：修复缺陷，但**收紧了对外契约**——
   新增 `400 invalid-metadata` 错误码，并开始拒绝过去被接受的输入（危险键名、
   含换行的 service、非字符串 aliases）。按 0.x 语义这不该是补丁号。）

## 6. 边界（明确不做）

- 不改存储结构（仍按 `name` 索引）。
- 不引入导出/导入（那是下一个 issue）。
- 不做名字白名单/字符集限制。
- 不迁移历史数据：历史坏键只是读时不再污染，不自动删除（删除属破坏性操作，
  由用户在面板手动处理）。

## 7. 影响面

| 文件 | 改动 |
| --- | --- |
| `lib/store.js` | `isValidName` 加危险键否决；`readVault` 用无原型对象；新增 `validateMeta` |
| `lib/vault-store.js` | `set`/`update` 调 `validateMeta`；`entry()` 用 `Object.hasOwn` |
| `lib/api.mjs` | `POST /set` 的 `service`/`aliases`/`username`/`url`/`note` 走同一套校验，违规 `400 invalid-metadata` |
| `lib/hint.js` | `indexLine` 清洗换行 + 截断 |
| `test/` | 新增 `security-hardening.test.mjs`；补 `store.test.mjs` 与 `api-normalize.test.mjs` |

## 8. Tickets

| # | 标题 | 依赖 |
| --- | --- | --- |
| T1 | 危险键名拒绝 + `readVault` 无原型 + `entry()` 用 `hasOwn` | — |
| T2 | 元数据校验（`validateMeta`）接入 store 与 API | — |
| T3 | 提示词二次防御（换行压平 + 截断） | — |
| T4 | 文档（README 安全边界补充）+ 版本 0.4.0（实现时按审查意见升为次版本：新增错误码 + 拒绝曾接受的输入） | T1–T3 |

T1/T2/T3 互不依赖，可并行实现。
