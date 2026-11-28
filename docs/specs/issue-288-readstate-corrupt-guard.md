# issue-288: plugin-sync.json 损坏时不许被默认值覆盖

分级: standard(改读侧逻辑 + 新增公开返回字段 + 备份副作用;涉及 1 个 lib 文件与 1 个测试文件)。

## 问题

`packages/dsh-inventory/lib/sync-state.js` 的 `readState` 在状态文件损坏时(截断、非法 JSON、
合法 JSON 但不是对象)直接返回默认值。默认值随后被 `withMachineId` 写回**同一个文件**,
于是 `repo` 与 `token` 被清零 —— 而这两项是唯一无法从别处重新获取的东西:token 只存在这里,
repo 丢了就不知道往哪儿同步。用户看到的现象是「同步配置自己没了」。

## 修法

- 读失败(解析异常 / 顶层不是对象)→ 走 `quarantineState`:先把原文件 `rename` 成
  `<原文件名>.corrupt-<ISO 时间戳>` 备份,再返回默认值 + `corrupt: true`。
- 改名失败(权限、占用)只吞掉错误:原文件留在原处,标记照旧返回,不抛。
- 该路径**不写回**原文件;机器 id 只在内存里铸,不落盘。
- 只有个别字段类型错的文件**不算损坏**:`mergeState` 逐字段兜底后 `repo`/`token` 仍在,
  不动文件、不留备份(避免把还能用的配置挪走)。
- 字段名取 `corrupt`(布尔,只在损坏时出现)。先 grep 全部调用点确认安全:
  `writeState` 用 `{...current, ...patch}` 后过 `mergeState`,`mergeState` 只挑已知字段,
  `corrupt` 被自然丢弃,不会写进文件、也不会污染下一次读;其余调用点
  (`sync-service` 的 `state = readState()` 默认参数、`index.js` 的 `publicState(readState())`)
  都按字段取值,新增字段不影响解构。

## 验收

1. 截断的 JSON:`readState` 后原路径出现 `<文件名>.corrupt-<时间戳>`,备份内容与原文逐字节相同;
   返回值 `corrupt === true`,`repo` 为空(默认值)。
2. 合法 JSON 但顶层是数组:同上,按损坏处理。
3. 只有字段类型错(`lastPullAt: 'yesterday'`):`repo`/`token` 原样保留,`lastPullAt` 归 0,
   `corrupt` 不出现,文件未被改动、无备份。
4. 改名失败(非 root 下把目录改成只读):`readState` 不抛错,`corrupt === true`,原文件内容不变。
5. `dsh-inventory` 包全量测试通过(既有 2 条 `syncApply` 红在 main 基线同样复现,与本次无关)。

反向验证:把 `quarantineState` 换回「返回默认值 + 写回」→ 验收 1/2/4 变红(备份不存在、
`corrupt` 为 undefined、原文件被覆盖)。

## 变更点

- 只做读侧。#290 的原子写(写侧临时文件 + rename)不在本次范围,未实现。
- `corrupt` 只作为返回值标记,不写进状态文件本身(写进文件会让下一次读自己也带标记)。
