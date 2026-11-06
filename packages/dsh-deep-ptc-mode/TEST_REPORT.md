# 1.7.3 实测汇总 / Test summary

日期 / Date: 2026-11-05。测试宿主：Windows 桌面 DSH 0.2.2-rc.1 + WSL Ubuntu、Node 24。此版本是测试样本，运行时不据此固定工具清单。

## 中文

本版修复官方工具被旧隔离记录误拦、工具来源缓存不更新、暂停检测误判、缺失可执行程序误分类、大 schema 无法加载、适配失败后残留部分注册，以及重载按钮依赖缺失和网关返回结构处理错误。官方预设优先从运行宿主公开注册表读取，接口不可用时查找实际安装声明；仅最终兜底使用快照并告警。声明变化自动更新新预设，不强切换旧会话。

| 检查 | 汇总结果 |
| --- | --- |
| 自动化回归 | 77 项全通过；暂停检测另含 125 条断言用例，0 不符 |
| 官方适配 | 隔离宿主实际提供的 28 个官方工具身份、参数和可见性对照通过；官方工具不隔离，来源不明工具保留可用 |
| 动态更新 | 运行中改变官方声明，新增能力自动进入新预设；旧作用域保持不变。公开注册表变更与来源缓存刷新测试通过 |
| 降级与协作 | 可选模块/服务缺失、外部插件故障、自身适配失败时，官方 PTC 保持可用；部分注册回滚、大 schema 完整披露通过 |
| 桌面实测 A | 日志记录 43 次调用、19 种工具（含目录入口）。文件、图片、搜索、shell、job、联网和目标工具正常；4 次有意读取不存在文件失败后，官方 read 仍正常 |
| 桌面实测 B | 普通 subagent、fork、代理列表、限时提问正常；自有 WSL job 取消后 Linux PID 已消失。对子代理 UUID 使用 teammate 通信接口不满足前置条件，按此记录，不归因插件故障 |
| 真实插话 | 自动在真实命令开始约 1 秒后发送消息，调用约 2 秒后返回后台 job，原命令继续并完成；区别于伪造事件的单元测试 |
| 重载按钮 | 实际桌面点击成功，界面和会话命令日志均确认；不触发模型调用、不终止后台任务 |
| 打包 | 干净目录中在宿主依赖图下加载通过；交接文档与原始审计数据不进入发行包 |

边界：静态暂停检测不是完整语言解释器，未知时长放行；任意 `run_code`、同步子进程和长 workflow 内部等待不能保证被插话提前结束，应使用受管理的后台任务。`wsl -- sleep 20` 的实际暂停仍被拒绝。实际桌面未提供 workflow；未为测试创建真实定时任务/工作树，未在 macOS 真机执行。报告不宣称穷尽所有 bug 或全部第三方插件组合。

## English

The release fixes stale official-tool quarantine, source-cache refresh, false pause detection, missing-executable classification, oversized schema disclosure, partial registration rollback, and the composer's reset dependency/response handling. It prefers the running host's public PTC registry, discovers installed declarations as fallback, and warns before using a bundled snapshot. Changed declarations refresh new generations without switching leased sessions.

77 regression tests pass, including a 125-case pause table. Actual-host comparison covers the 28 official capabilities and their identity, schema and visibility. Missing optional services, incompatible plugins and adapter failures preserve official operation. Live declaration changes and registration rollback pass.

Desktop audit A records 43 calls across 19 tool names, including the directory; four intentional missing-file reads do not disable official read. File/image/search/shell/job/web/goal operations succeed. Audit B covers subagents, fork, lists and timed questions; cancelling the owned WSL job removes its Linux PID. Teammate-only communication with a subagent UUID is recorded as an unmet precondition, not a plugin defect.

A real interjection sent about one second after command start releases its foreground wait about two seconds later; the job continues and completes. The actual composer reset button and command log both confirm success. Clean-package loading passes; private handoffs and raw session logs are excluded.

Limits: static pause detection is not a full interpreter; unresolved waits pass through. Arbitrary run_code/synchronous/workflow waits cannot guarantee early steering. Use managed jobs. The real `wsl -- sleep 20` pause remains blocked. No workflow was exposed in the desktop session; live schedules/worktrees and native macOS were not exercised. This is bounded coverage, not a universal defect-free claim.
