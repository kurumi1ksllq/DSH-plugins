# issue-234:处理审查剩余项

**分级:standard**(5 项、涉及 4 个包 + 仓库级测试)

## 目标

1. **copy-drift**:仓库级契约测试,钉死四份 http-guard 与两份 define-tool 逐字一致。纯测试,不升版。
2. **attribution-warn**:deep-ptc tool-policy 对无法归因的工具,隔离失败时给出每工具名一次的警告。
3. **nudge-guard**:skill-surface 的 looksLikeNudge 从「整块丢弃」改为「行级剔除」。
4. **lock-span**:failover doRefresh 的探测移出锁,RMW 仍留锁内(锁内重读)。
5. **read-unread**:通读 governor-softcut/anchor/settings/model 与 client 渲染层,修发现项。

## 边界

- 不改变各 bundle 包结构与对外接口。
- 第 1 项不跨包共享模块(破坏独立安装)。

## 验收

- 每项红绿;pnpm test / pnpm verify 绿;改动包升版本 + CHANGELOG。

## 变更点(实现中调整,留证)

1. **copy-drift 从「逐字一致」改为「语义紧凑一致」**:五份拷贝分布在两套房屋风格里(governor-* 用 tab/双引号/分号,http-guard 模块用两空格/单引号/无分号)。逐字比对会把风格差异报成漂移,故归一化时剥离空白、引号与语句分号后比对——任何条件/分支/返回的语义改动仍会变红。
2. **通读发现一个新的真缺陷(不在原清单里)**:deep-ptc 的治理器设置 POST 路由(`/plugins/stall-governor/settings`)是**全仓唯一没有 origin 守卫的状态变更路由**——其它四个 bundle 都有。恶意网页可跨站 POST 改检测阈值/纪律块/locale。已补守卫,并把该第 5 份拷贝纳入 copy-drift 契约。这是 5 项里唯一的真安全修复。
3. **版本口径**:deep-ptc 升 minor(1.16.1→1.17.0,新增源站校验属行为/安全变更);failover 与 skill-surface 升 patch(修复)。
