# ralph 20 轮审查 · 汇总(2026-11-23)

> 历史留证。原始目录 `ralph-reviews/`(19 份逐轮报告 + 本汇总,共 460K)已在 2026-11-27 清理;
> 其中的可执行发现已按 round-20 的分批逐条开成 issue **#265–#278**,编号见下。
>
> 本文件保留汇总结论(方法、Top 风险排序、系统性问题、诚实边界),供 issue 里的
> 「round-XX Fx」引用可查。

## 发现 → issue 对照

| 来源 | issue | 标题要点 |
| --- | --- | --- |
| R7 F1 | #265 | clone 回退的清单路径可穿越 |
| R10 F1 | #266 | bootstrapRepoClone 引用未定义标识符 |
| R16 F1 | #267 | 状态文件损坏被默认值覆盖(token 丢失) |
| R1 F1/F2 | #268 | 畸形 iv/tag 抛原始 TypeError + rotateKey EEXIST |
| R5 F1/F2/F3 · R19 F2 · R14 F1 | #269 | 脱敏口径五处不一致 |
| R12 F1 · R16 F2 | #270 | 关键配置非原子写 |
| R2 F1-F4 · R15 F1/F2 | #271 | 冷却并发 / 模板美元注入 / AUTH_RE / retryAfter |
| R17 F1/F2 | #272 | 混合换行下 SKILL.md 开关写坏 |
| R9 F1/F2 | #273 | scrub 未按长度降序,长密钥部分泄露 |
| R19 F1/F2 | #274 | 未转义工具名构造 RegExp |
| R4 F1/F2 | #275 | 暂停守卫可被 sudo/nice/timeout 绕过 |
| R3 F1-F3 · R11 F1/F2 | #276 | 远程分支标志 / 快照缓存 / statusSha / href 协议 |
| R6 F2 · R8 · R13 · R14 F2 · R18 | #277 | 九条低中风险项 |
| A-H 系统性问题 | #278 | 跨包根因与统一解法 |

---

# Ralph 审查 · 第 20 轮（2026-11-23）汇总轮
主题：**跨轮次归纳、Top 风险排序、修复计划与未覆盖清单**

本目录共 19 份逐轮报告 + 本汇总。逐轮细节见 round-01.md ~ round-19.md；本文件只做归纳与排序，不重复复述。

## 方法与范围
- 轮次覆盖：credential-vault（加密/HTTP/脱敏相关）、websearch-failover、dev-flow（宿主 + 客户端）、deep-ptc（守卫/工具策略/设置/上游）、task-dispatcher、skill-surface、inventory（同步/发布/脱敏/技能/工作区/快照）、scripts（清洗/验证/版本纪律）。
- 只读审查 + 针对性运行时复现；**未修改任何仓库代码**，复现脚本放在 /tmp。
- 共记录约 90 条发现，其中约 18 条经运行时实测复现（各轮标注「已实测」）。

## Top 风险（按严重度排序，均已实测或代码可验证）
1. [高] 同步 clone 回退的清单路径可穿越，读取任意本地文件 — sync-remote.js:374（路径来自面板 sync 配置，仅 trim）。round-07 F1
2. [高] 新机器自动克隆插件仓库引用未定义标识符 mkdir / explainError，功能必失败且抛 ReferenceError — sync-apply.js:349/362。round-10 F1
3. [高] 同步状态文件损坏时被默认值覆盖，repo 与 token 永久丢失 — sync-state.js:76-108。round-16 F1
4. [中] 导出信封的畸形 iv/tag 抛原始 TypeError，破坏「单一错误无 oracle」 — envelope.mjs:135-137。round-01 F1
5. [中] rotateKey 被残留 vault.json.new 永久阻塞（EEXIST） — vault-store.js:508。round-01 F2
6. [中] 脱敏深度上限 12：更深层的 secret 原样发布 — redact.js:271。round-05 F1
7. [中] 扫描器不传播环境块标记，发布预览系统性少报秘密 — redact.js:426。round-05 F2
8. [中] 冷却状态读改写未纳入 mutex，clearCooldown 被并发搜索复活 — core.mjs + index.js。round-02 F1
9. [中] 技能开关在混合换行下重复写入 disable-model-invocation / 漏改 — skill-toggle.js:30。round-17 F1
10. [中] 清洗脚本未按长度降序替换，短前缀导致长密钥部分泄露 — scrub-session-secrets.mjs:99。round-09 F1
11. [中] 工具归属推断用未转义工具名建正则，可让整次快照构建 500 — plugin-tool-index.js:67。round-19 F1
12. [中] 暂停守卫可被 sudo -u / nice -n / GNU timeout 绕过 — sleep-lint.mjs:161-174。round-04 F1/F2
13. [中] custom 适配器与 balance 的 replaceAll 模板替换可被美元符号注入 — core.mjs:430、balance.mjs:186。round-02 F2 / round-15 F1
14. [低中] 远程分支标志恒为 false，面板把 origin/* 当本地 — git-info.js:50。round-03 F1
15. [低中] statusSha 未透传，diff 的乐观并发校验从不生效 — client.js:689。round-11 F1
16. [低] 角色搜索把用户显式输入的英文也标成 mapped，过度收窄 — roles.mjs:112。round-06 F1

## 跨轮次的系统性问题（建议「修一次，修遍全仓」）
A. 关键文件的非原子写：cordis.patch.yml（R12）、plugin-sync.json（R16）、SKILL.md（R17）、state.json（R2 固定 tmp 名）。→ 抽一个 atomicWrite（temp + rename + fchmod）。
B. 读改写未串行化：冷却 state.json（R2）、withMachineId 铸号（R16）。→ 复用各包已有的 mutex/queue。
C. 替换串与正则未转义：replaceAll 的美元模式（R2/R15）、new RegExp(工具名)（R19）。→ 抽 escapeRegExp + fillTemplate（回调式替换）。
D. 脱敏口径不一致：扫描器 vs 脱敏器（R5）、深度上限（R5）、短凭据白名单（R5）、URL userinfo（R19）、publicFields（R14）。→ 单一脱敏源 + 「scan 的变更集合 == redact 的变更集合」的属性测试。
E. 路径约束缺失：clone 读取（R7）、工作区 MCP 声明来自父目录（R18/R5）。→ 统一 resolveInsideRoot + 在视图上标注声明来源。
F. 定时器/资源不清理：withTimeoutAbort（R7）、sync-publish 的 withTimeout、verify-clean 的轮询（R9）。→ 统一 withTimeout（clear + abort + race）。
G. 大小/深度上限缺失：readSessionEvents（R13）、脱敏深度（R5）、zstd 解压 1GiB（R9）。→ 统一「读到上限就拒绝并报告」。
H. 行级解析器的边界：handoff 代码围栏（R6）、frontmatter EOL（R17）、patch YAML 破折号换行（R12）、heredoc（R4）。→ 每类解析器补一组混合输入测试。

## 建议修复批次
- P0（安全/数据丢失/功能不可用）：Top 1-3、4-5、6-7。
- P1（可复现的功能/安全缺陷）：8-13。
- P2（显示/一致性/性能）：14-16 与各轮低风险项。
- 每批修完补一条反向验证测试（改坏实现会变红），尤其是 P0 的三条路径穿越/数据丢失/未定义标识符。

## 未覆盖或未验证（诚实边界）
- deep-ptc 的 governor-apply / governor-core / governor-softcut 各检测器只做了设置层与少量函数走读，逐条检测器的误判率未系统评估。
- dev-flow client.js 的多数展示组件、credential-vault client、inventory client 的构建产物未逐行审。
- 未运行性能基准；性能类结论（O(n^2)、重复扫描）来自代码走读。
- 未审 test/ 下断言的强弱（只顺带确认了几个测试覆盖缺口）。
- 未审 ecc-agent-presets 的 133 行数据本身（只确认入口是 inert）。
- 所有结论未经过修复后的回归验证。

## 文件索引
round-01 凭证保险库安全实现 · round-02 websearch 失败转移 · round-03 dev-flow 宿主 · round-04 deep-ptc 暂停/可达性 · round-05 inventory 脱敏与工作区门禁 · round-06 角色路由与技能发现 · round-07 同步传输 · round-08 插件自更新 · round-09 仓库脚本 · round-10 清单落地 · round-11 dev-flow 客户端 · round-12 全局开关与 patch · round-13 会话解码与清单构建 · round-14 凭证解析/提示 · round-15 余额探测与工具匹配 · round-16 差异与状态 · round-17 技能开关 · round-18 工作区视图与依赖图 · round-19 快照采集 · round-20 本汇总。
