# issue-234:处理审查剩余项

**分级:standard**(5 项、涉及 3 个包 + 仓库级测试)

## 目标

1. **copy-drift**:仓库级契约测试,钉死**全部六份** isForbiddenOrigin(含 dsh-inventory 的两份)与两份 define-tool 兜底。纯测试,不升版。
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
4. **双轴 review 后修正(第一版有误)**:①契约漏掉第 6 份(dsh-inventory/lib-prompt-inject.js),清单改为「扫描集合必须等于钉死清单」;②归一化曾剥掉引号,会掩盖「字面量变标识符」的真缺陷——改为只统一引号风格并剥注释;③define-tool「等价」契约改为同一输入矩阵比对(此前只测 undefined,vault 与 dispatcher 对纯空白串判定不同);④归因警告从「派发即警告」改为「失败时警告」并排除插件自己的 deep_ptc_tools,补走 installToolCompatibility 的测试;⑤nudge 守卫从行级改为**子串级**(同行/跨行引用都不再吞任务);⑥failover 的探测出锁会引入「旧读数覆盖新读数」回归,已加「新读数才覆盖」守卫与测试。

## 第 5 项留证(read-unread)

通读范围与结论(结论:除下述 1 项外未发现问题):

| 文件 | 规模 | 结论 |
|---|---|---|
| lib/governor-softcut.mjs | 70KB / 1604 行 | 未发现问题(检测器阈值与守卫均有注释与测试) |
| lib/governor-anchor.mjs | 34KB / 871 行 | 未发现问题 |
| lib/governor-settings.mjs | 29KB / 417 行 | 未发现问题(clamp 对小数/整数的处理已修过) |
| lib/model.mjs | 17KB / 353 行 | 未发现问题 |
| lib/tool-catalog.mjs | 2.9KB / 46 行 | 未发现问题 |
| lib/governor-apply.mjs | 60KB / 1218 行 | **发现 1 项**:设置 POST 路由无 origin 守卫(全仓唯一)→ 已修 |
| 各包 client 渲染层 | ~350KB | 未发现 XSS 面:全仓无 innerHTML/eval/document.write/postMessage,均为 React.createElement |

注:governor-apply.mjs 不在原目标 5 的清单里,是通读 governor-* 时顺带发现的。
