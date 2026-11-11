# #177 技能使用统计在 deep-ptc 会话里恒为空

- 分级：`standard`（2 个代码文件 + 测试 + 文档；两条独立根因）

## 目标

`packages/dsh-inventory` 的「哪些技能被用过」统计在 deep-ptc 会话里恒为空。本 issue 让它能读到 deep-ptc 的技能加载，并且**先修掉让它完全读不到会话文件的路径 bug**。

## 现状（实测）

两条根因叠加，只修一条都看不出效果：

### 根因 A：路径拼错，任何会话都读不到

`index.js:340` 写 `join(dshHome(), '.dsh', 'sessions')`，而 `lib/dsh-home.js:22` 的 `dshHome()` **本身已经返回 `.dsh` 目录**。

```
DSH_HOME=/root/.dsh
code path:  /root/.dsh/.dsh/sessions   ← 不存在
correct:    /root/.dsh/sessions        ← 存在(365 个会话文件)
```

后果：`listSessionFiles` 返回空数组，`collectSessionEdges` 连文件都读不到——**补了事件源也仍然恒为空**。

### 根因 B：只认 `tool/call`，看不到 deep-ptc 的技能加载

`lib/collect-sessions.js:37` 只收 `event.type === 'tool/call'`。但 deep-ptc 会话里外层 `tool/call` 只有 `run_code`，真正的 `skill` 调用落在 `tool/ptc-dispatch`（`arguments` 是对象，不是 JSON 字符串）。

实测（真实会话 `4dbe0403`）：`tool/call` 4 条全是 `run_code`；`tool/ptc-dispatch` 里 `skill` 3 条。用现有采集器跑该会话 → `rows: []`。

第 8-9 行注释「`tool/ptc-dispatch` 是嵌套 dispatch，被有意忽略——外层 `tool/call` 已经点名它们」与事实相反。

## 方案

### 1. 修路径（必须先做）

`index.js:340`：`join(dshHome(), '.dsh', 'sessions')` → `join(dshHome(), 'sessions')`

依据：`dsh-home.js` 的契约就是「`$DSH_HOME`，否则 `~/.dsh`」；`scripts/scrub-session-secrets.mjs:271` 也是这么拼的。

### 2. 事件源放宽为两类

`collect-sessions.js`：门改为 `TOOL_EVENTS = new Set(['tool/call', 'tool/ptc-dispatch'])`。

`parseArguments`（`:14-23`）**已经同时接受对象与字符串**，不需要改。窗口计数逻辑对两类事件通用。

只认结算事件 `tool/ptc-dispatch`，不认 `-start`（结算事件恰好一条且带 `isError`，避免同一子调用被数两次）。

### 3. 修正注释

`:1-10` 的「A skill load is an ordinary `tool/call`」与「外层已点名」两句改为如实描述。

### 4. 不做（写进边界）

- 不引入 `isError` 过滤（`tool/call` 没有该字段，只在 dispatch 上过滤会造成两类事件源不对称）。
- 不排除 `run_code`（它是内置工具，排除它属改统计口径）。

## 验收

- T1：dispatch 事件里的 `skill` 加载产生证据
- T2：两种事件源在同一会话里都被认
- T3：畸形 dispatch 不炸
- **T4（端到端）**：临时 `DSH_HOME` + 真实会话文件 → `GET /inventory/snapshot` 有 session 边。**这是唯一能在 CI 上抓住路径 bug 的测试**

反向验证：
- 改回只认 `tool/call` → T1/T2/T4 红
- 改回 `.dsh/.dsh` → **只有 T4 红**（证明两条测试锁不同根因）

## 边界

- 不改统计口径（窗口大小、是否排除 `run_code`）。
- 不改 UI。
- 验收不能写「本机面板必须出现会话边」——本机最近 12 个会话里 skill 加载数为 0，修好也可能看不到；只能断言构造的 fixture。
