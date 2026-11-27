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

## 变更点(实现后补记)

1. **范围扩大**:diff 还改了 docs/update-scheme.md、docs/update-checkout.md、根 package.json(description)。理由:test/docs-contract.test.mjs 的计数契约在删包后必红(「八个插件/8 bundles/eight independently installable」),这些行不改无法过验收;属验收项 3 的必要推论,不是新需求。
2. **版本纪律预测订正**:spec 原预测「不改注入文本,预期免升版」错误 —— 实现给 role_search 加了空名册文案,lib/role-tools.mjs 属 shipped 文件,dsh-task-dispatcher 升版 0.9.4 → 0.9.5(符合 spec 自身规则,预测作废)。
3. **验收项 3 口径澄清**:「全仓不再有活引用」按「依赖该包存在的引用清零」执行;代码注释与历史 spec/CHANGELOG 里的「133 ECC presets」为历史说明,保留。
4. **review 裁决补做**(双轴 review 后):role_search 空名册测试改用真空名册(空数组 + 仅内置组合两形态);delegate_role 补对称守卫(空名册抛同语义错误,而非「unknown role」自相矛盾);docs/update-checkout.md 校准块残留旧计数三处修正;dispatcher README 测试计数补快照注记。
