# copySkill 测试环境隔离(#143)

来源:#135 收尾后环境清理遗留。分级:standard。

## 现状(实测)
- test/sync-issues-5-8.test.mjs:87 只注入 process.env.DSH_HOME,未隔离 DSH_AGENTS_HOME。
- skillRootOf(lib/sync-apply.js:510)优先选已存在的 skill root:本机 /root/.agents/skills 存在时 resolver 正确选它,测试断言假设回退 $DSH_HOME/skills → 本机红、CI 绿。
- 该测试曾把 /root/.agents/skills/ui-design 悬空符号链接写进真实用户目录(已手工清理,污染实例)。

## 方案
1. 该测试注入 process.env.DSH_AGENTS_HOME 指向空 scratch(finally 恢复),使「无 .agents/skills」前提确定成立。
2. 审计同文件其它测试是否有同类泄漏(写真实用户目录)。

## 边界
- 只改 test/sync-issues-5-8.test.mjs;不改 lib/ 行为(resolver 语义本来就对)。
- 纯测试,无版本号/tag(循 #134 先例)。

## 验收
1. 本机(带 /root/.agents/skills 环境)单跑/全量均绿。
2. 反向验证:去掉 DSH_AGENTS_HOME 注入 → 本机红(证明隔离必要)。
