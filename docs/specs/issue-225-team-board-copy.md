# issue-225: dispatcher 注入文本对齐宿主 Team 机制

## 问题

v0.2.1-rc.2 起 `spawn_teammate` 已从宿主移除(官方 upgrade guide:
docs/upgrade-guide/v0.2.1-rc.2/agent-team-subagents),但
`packages/dsh-task-dispatcher/lib/delegation-text.mjs` 的 zh/en 分档 bullet
仍写「组队(`spawn_teammate` + 任务板)」——指引指向不存在的工具。

宿主现行机制(0.2.2-rc.4 实测 + 源码):teammate 用 `subagent` 创建,
共享任务板用 `team_task_create/list/get/update` 四个工具(CAS + revision)。
且宿主 README 明确:任务更新**不会唤醒成员**、不会结束 `wait_agent`、
不会投递消息——需要成员行动必须 `send_message` 点名。注入文本没有这一条。

## 改动(trivial,单文件 lib/delegation-text.mjs + 测试)

1. zh/en 分档 bullet:「组队(`spawn_teammate` + 任务板)」→
   「组队(`subagent` 派出成员 + `team_task_*` 共享任务板)」。
2. zh/en 各补一条 bullet:任务更新不唤醒人,需要成员行动必须 `send_message`。
3. README.md 的 spawn_teammate 提及改为现状描述(该行是历史注记,保留指向)。
4. 测试守护:triggers.test.mjs 增加断言——文本不得出现 `spawn_teammate`,
   必须点名 `team_task` 与「send_message 点名/唤醒」条款;反向验证(改坏变红)。

## 变更点

无(实现与 spec 一致)。

