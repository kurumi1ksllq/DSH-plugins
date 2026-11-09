# locale/*.json 侧键集契约(#136)

来源:PR #134 正确性轴 review P2。分级:standard。

## 审计结论(实测)

1. **消费关系**(轴2 P2 修正后):dsh-credential-vault 三证齐全(`exports["./locale/*.json"]` + `files` 分发 + `@deepseek-ai/dsh-client-locale` 依赖)——由宿主 locale 系统消费。dsh-websearch-failover 仅 `files` 分发含 locale/*.json,**无 exports 声明、无该依赖**——宿主是否注册、以何 namespace 注册未经证实(宿主实现不在本 checkout);本契约按「若宿主按 JSON 注册,则键集应一致」的假设语气钉现状,方向(哪侧是全集)待宿主侧证据闭合后再定。
2. **漂移现状**(正则含引号键重审):
   - dsh-websearch-failover:client 内嵌字典 51 键 = locale/zh.json 51 键,键集逐一同源(消费机制未证实,见上)。
   - dsh-credential-vault:client 40 键(含 kinds.* 5 个点分键,vm 求值口径) ⊂ JSON 43 键;JSON 独有 createdName/entriesCount/never(宿主面板碎片,client 零消费;宿主实现不可见,**消费性未验证**)。
   - client 独有键:两包均无 → 「client 有 JSON 无」的真漂移不存在。
3. **真实缺陷判定**:非缺陷。JSON 是宿主注册全集,client 字典是其消费子集;超集关系即正确形态。

## 方案

仓库级 test/locale-contract.test.mjs 扩两组断言(不新增文件):
1. **zh/en 键集一致**(双向,逐包):locale/zh.json 与 locale/en.json 键集 deepEqual。
2. **client ⊆ JSON**(逐包,双侧对称):client.js 内嵌 zh/en 字典的每个键必须存在于 locale/zh.json / locale/en.json(防「client 加键忘 JSON」与「zh.json 加了 en.json 漏了」两类漂移);JSON ⊃ client 的余量(宿主专用键)合法,不要求反向。键提取用 node:vm 求值(正则提键漏点分键且受文案内括号干扰——轴2 P1)。

## 边界

- 实现面不新增文件(流程产物 spec/.flow 除外);不改包内容、不删 3 个未验证键(宿主消费性未验证,删除风险大于收益,留待宿主侧可证时处理)。#136 分支另携带 #132 的 CI 自修 d312b05(根 CHANGELOG tag 条目),已记账。
- 纯测试,无版本号/tag(循 #134 先例)。

## 验收

1. 新断言绿(当前状态即满足——契约把现状钉住)。
2. 反向验证:改坏任一 en.json(删键)或 client 加 JSON 没有的键 → 红。
3. pnpm test 全绿 + CI 绿。

## Tickets

| # | 标题 |
|---|---|
| 1 | locale/*.json 契约断言(zh/en 一致 + client⊆JSON)+ 反向验证 |
