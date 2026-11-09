# locale/*.json 侧键集契约(#136)

来源:PR #134 正确性轴 review P2。分级:standard。

## 审计结论(实测)

1. **消费关系**:packages/{dsh-credential-vault,dsh-websearch-failover}/locale/{zh,en}.json 经 package.json `exports["./locale/*.json"]` 声明、由宿主 `@deepseek-ai/dsh-client-locale` 消费(声明式注册,宿主实现不在本 checkout,运行时选侧机制以宿主为准)。
2. **漂移现状**(正则含引号键重审):
   - dsh-websearch-failover:client 内嵌字典 51 键 = locale/zh.json 51 键,**完全同源**。
   - dsh-credential-vault:client 40 键 ⊂ JSON 43 键;JSON 独有 createdName/entriesCount/never(宿主面板碎片,client 零消费;宿主实现不可见,**消费性未验证**)。
   - client 独有键:两包均无 → 「client 有 JSON 无」的真漂移不存在。
3. **真实缺陷判定**:非缺陷。JSON 是宿主注册全集,client 字典是其消费子集;超集关系即正确形态。

## 方案

仓库级 test/locale-contract.test.mjs 扩两组断言(不新增文件):
1. **zh/en 键集一致**(双向,逐包):locale/zh.json 与 locale/en.json 键集 deepEqual。
2. **client ⊆ JSON**(逐包):client.js 内嵌 zh 字典的每个键必须存在于 locale/zh.json(防"client 加键忘 JSON"的真漂移);JSON ⊃ client 的余量(宿主专用键)合法,不要求反向。

## 边界

- 只改 test/locale-contract.test.mjs(+可能的 .flow);不改包内容、不删 3 个未验证键(宿主消费性未验证,删除风险大于收益,留待宿主侧可证时处理)。
- 纯测试,无版本号/tag(循 #134 先例)。

## 验收

1. 新断言绿(当前状态即满足——契约把现状钉住)。
2. 反向验证:改坏任一 en.json(删键)或 client 加 JSON 没有的键 → 红。
3. pnpm test 全绿 + CI 绿。

## Tickets

| # | 标题 |
|---|---|
| 1 | locale/*.json 契约断言(zh/en 一致 + client⊆JSON)+ 反向验证 |
