# issue-279: 移除 ecc-agent-presets 包(用户方案 B:只清理)

分级: standard(删整包 + 跨包引用 + 测试改写;无接口变更,但涉及 ≥3 文件)。

## 背景
用户要求对比第三方插件 MichengAI/dsh-agency-agents(331 位业务专家名册 + 召唤工具 + Web 管理面板),判断本仓库哪些功能可移除。结论:唯一重叠是「专家名册 + 角色化委派」线;用户选方案 B —— 只清理,不装第三方插件。

## 边界
- 删除 packages/ecc-agent-presets 整个包(14796 行 cordis.patch.yml 的 133 行 preset + index.js + 测试 + locale + icon)。
- profile package.json 去掉该依赖;scripts/check-profile.mjs、scripts/verify-packages.mjs 去掉对它的校验。
- 根 README.md / AGENTS.md 目录表去掉对应行;CHANGELOG 记录。
- dsh-task-dispatcher 角色工具(role_search/delegate_role)**保留**;测试不再读 ecc 名册,改为「名册为空/不可用时如实报不可用」的公开行为测试。
- 不装 MichengAI/dsh-agency-agents,不动其它包。

## 验收
1. pnpm test 全绿(仓库级)。
2. pnpm verify 全绿(打包/版本纪律;被删包不再出现在清单)。
3. 全仓(排除 node_modules/.git/docs 历史 spec)不再有对 ecc-agent-presets 的活引用(历史 spec 与 CHANGELOG 历史条目保留,不改写历史)。
4. role_search 在空名册下返回明确的「无角色」提示(现有行为,测试化)。

## 裁剪
- 无。standard 档走完整 TDD + 双轴 review。

## 版本纪律
- ecc-agent-presets 整包删除 → 不打删除包的 tag;改动的 dsh-task-dispatcher(若测试改动)按「纯测试改动免升版」口径判定,但注入文本若有变化需升版 —— 本任务不改注入文本,预期免升版;scripts/ 与根文档改动按仓库既有惯例处理。
