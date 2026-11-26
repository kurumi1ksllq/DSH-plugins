# issue-236:单次 run_code 时限与 ralph 分批续跑

**分级:trivial**(一个 bundle:一行 patch 覆盖 + 一段注入规则 + 一段 README + 一条契约测试)

## 目标

deep-PTC 下 `ralph` 被 600s 截断,截断后重新调用从第 1 轮重启。根因不是 ralph,是 `run_code` 单次程序的硬时限:

- 时限来自 `ptc-runtime` 行的配置(`timeoutMs` 默认 120s、`maxTimeoutMs` 上限 600s),该行由 `@deepseek-ai/dsh-base/cordis.patch.yml:407` 声明且**不带 config**,于是 loader 默认值生效。
- 前台阻塞的工具(ralph)整个循环跑在一次程序里,所以 600s 就是它的批长。
- `foregroundSeconds`(5–600)只设 shell executor 行(`lib/model.mjs:281`),与 `run_code` 无关。

## 边界

- **不修改、不包装、不替换** 官方 `dsh-tool-ralph`:那份 loop script 归上游维护,替它维护不可持续。
- 只改本 bundle 的 `cordis.patch.yml`(按行 id 覆盖 `ptc-runtime`)、`lib/rules.mjs`(注入规则)、`README.zh.md`/`README.md`,外加一条契约测试。
- 不改 `foregroundSeconds`、不改 executor 行、不改任何其它 bundle。

## 验收

- 组合后的 profile 里 `ptc-runtime` 行带 `timeoutMs: 600000` / `maxTimeoutMs: 1800000`(`dsh web --dump-config` 实看)。
- `test/ptc-deadline.test.mjs`:①patch 里该行存在、两个键都在、上限 > 600s、默认 ≤ 上限且 ≥ 600s;②注入规则提到 `run_code` 有硬时限、点名 ralph、要求分批与 `round-01.md` 形状,且**不复述**具体秒数。反向验证:把上限改回 600000 → 红(实测 `the ceiling must exceed the host default of 600s, got 600000`)。
- 本包 224/224 绿;仓库级 `test/docs-contract.test.mjs` 31/31;`scripts/verify-packages.mjs` ok。
- 版本 1.17.3 → 1.18.0(行为面:默认程序预算与上限都变,属 minor)。

## 变更点 / 取舍

1. **数字只写在一处**:patch 里给具体毫秒,注入规则与 README 只说「有硬时限、要分批」,避免提示词里的秒数与配置漂移(测试里也钉了「提示词不得复述上限」)。
2. **30 分钟而不是无上限**:实测最慢一轮 577s,30 分钟留了足够余量;但 20 轮 × 最慢仍是数小时,所以「分批 + 编号交接文件」不是装饰而是配合项,README 与注入规则都写了。
3. **未采用「包装 ralph 加 resume」**:那需要我们自己维护一份 loop script 并跟上游语义,与「不维护官方代码」的要求冲突。分批约定 + 放宽时限在不改官方代码的前提下解决了同一个痛点。

## 双轴 review 裁决(轴1 与轴2 各回报,合计 10 条;全部处理)

两轴独立指向同一条最重的问题,已按更小的改法重做:

1. **【高】抬默认 `timeoutMs` 把「可插话窗口」从 2 分钟拉到 10 分钟**(两轴都提)→ **采纳**:只抬 `maxTimeoutMs`,默认值保持宿主原值。依据:`clampTimeout(requested, default, max)` 只在模型显式传 `timeoutMs` 时用上限;而程序的 `spec.timeoutMs` 同时就是不可打断窗口(steer 只在步骤边界取走,deep-ptc 的 guard 只让 `job_output`/`ask_user_question` 可插话,无法中断正在跑的程序)。
2. **【高】规则没告诉模型「可以显式传更长预算」,30 分钟上限实际不可达** → **采纳**:规则里加 `pass run_code an explicit timeoutMs up to that printed cap`,并补断言要求提示词出现 `timeoutMs`。
3. **【中】契约测试只解析自家 YAML,宿主行改名时修复静默失效而测试全绿** → **采纳**:新增一条组合测试,用宿主自己的 `applyEntryPatches` 把 base 声明与本包 patch 依次组合,断言 `maxTimeoutMs` 真的被改到、`warnings` 里没有 `not found`;宿主存在但层不可解析时**直接失败**(不静默跳过),只有完全没有宿主的 checkout 才 skip。
4. **【中】测试锁排版而不是行为;注释声称「重排也绿」但手写扫描做不到** → **采纳**:改用 `js-yaml` 解析后按结构断言;反向验证两个方向都红(上限改小 → `the ceiling must exceed…`;把行 id 改名 → `the bundle must patch the ptc-runtime row`)。
5. **【中】数字被写进 README,与 spec「数字只写一处」冲突** → **采纳**:README 中英都不再写具体毫秒,改为「见 `cordis.patch.yml`,工具描述会印出当前值」;测试里那条「提示词不得复述时长」的断言收窄到**只检查 deadline 那一句**(其余规则本来就该写自己的秒数,原断言会误伤)。
6. **【中】英文 README 没有对应章节** → **采纳**:补同构小节(含 `round-01.md` 形状与分批表)。
7. **【低】分级 `trivial` 与 FLOW.md 定义冲突(>1 文件、改宿主行为)** → **部分采纳**:保留 `trivial` 但在此写明裁剪依据——改动仍是「一处配置 + 一段文案 + 一条契约测试」,没有新接口、没有新模块;双轴 review **没有裁剪**(两轴都跑了,共 10 条)。若按 FLOW 的「≤1 文件」硬判则应记 `standard`,此处以「裁剪依据留证」代替改档。
8. **【低】`doesNotMatch(/1800000|1800 s/)` 是 token 级假护栏** → **采纳**:换成「deadline 那句不得出现时长数字」,并先把 `round-01.md` 这类文件名剥掉。
9. **【低】子调用配额被动放大未记录** → **采纳为留证**:`maxSubCalls = floor(spec.timeoutMs/60000 * maxSubCallsPerMinute)`。默认值不变,所以默认配额不变;只有显式要更长预算时配额才同比放大,属调用方的选择,记录在此。
10. **【低】跨 preset 作用域** → **采纳**:patch 注释与 README 中英都写明「裸 id 覆盖是 profile 级,对本 profile 内所有模式生效;其它模式看到的差别只是可以要求更长预算」。

**仍未验证**:30 分钟窗口下 ralph 的内存与取消语义(issue 自己的研究问题之一);未在真机跑一次超过 10 分钟的 ralph 批次(需重载宿主后才可能)。

## 真机实测(2026-11-26 重载宿主后)

重载后逐项验证,**其中一条推翻了我自己的错误结论**,记录在此:

| 测什么 | 做法 | 结果 |
| --- | --- | --- |
| 上限确实抬到 30 分钟 | 显式传 `timeoutMs: 700000`,程序跑 660 秒 | **通过**:跑满 660.7 秒并返回,越过旧的 600 秒天花板 |
| 默认值仍是宿主的 120 秒 | 不传 `timeoutMs`,程序跑 200 秒 | **通过**:在 120 秒被杀(`execution timed out during execution (120000ms)`) |
| 计时器本身有效 | 外层给 5000 ms,程序跑 60 秒 | **通过**:5 秒被杀 |
| 组合配置 | `dsh web --dump-config` | `ptc-runtime.config = { maxTimeoutMs: 1800000 }`,无 `timeoutMs` 键 |
| 宿主确实在合并后重启 | 进程启动时间 vs 合并提交时间 | 宿主 01:29:32 启动,合并 01:01:59 |

**过程中的错误(留证,避免下次重犯)**:我头三次「默认值」测试都在外层工具参数里传了 `timeoutMs`(120000 / 400000 / 600000),测到的是我自己给的预算,于是错误地得出「默认值没生效」的结论,还据此去翻宿主源码找根因。真正省略 `timeoutMs` 之后,默认值 120 秒立刻复现。教训:`run_code` 的 `timeoutMs` 参数本身就是程序预算,测默认值时必须真的不传。

**仍未验证**:30 分钟窗口下 ralph 的内存与取消语义;未跑真实的 10 分钟以上 ralph 批次(只用一个空转程序验证了预算机制,没有验证 ralph 在长预算下的行为)。

## 真机 ralph 验证(2026-11-27,重载后)

上表只验证了预算机制本身,这一节是**真实的 ralph 长批次**:

| 尝试 | 配置 | 结果 |
| --- | --- | --- |
| 冒烟 | `maxRounds: 1`,每轮约 100 秒后台任务 | **通过**:125.4 秒,`roundsStarted: 1`,status `complete` |
| 第 1 次正式 | `maxRounds: 7`,每轮 100 秒 + 轮询 `job_output` | **第 5 轮失败**(子 agent 未产出结构化报告)。前 4 轮已完成,总时长已越过 600 秒 |
| 第 2 次正式 | `maxRounds: 5`,每轮 130 秒 + 单次 `job_output(wait: true)` | **通过**:`elapsedMs: 777987`(约 13 分钟),`roundsStarted: 5`,status `complete` |

**结论**:单次 ralph 调用实测跑满 778 秒并正常返回,越过旧的 600 秒天花板 178 秒。issue #236 的核心症状(长目标被截断后从 round 1 重启)在预算层面已解决。

**验证过程中观察到的两件事(都是既有行为,不是本次改动引入)**:

1. **ralph 子 agent 必须被明确要求调 `structured_output`**,否则整轮判「未产出结构化报告」——issue #236 附记里写的门槛属实。第一次正式测试就是第 5 轮踩到这一点;objective 里写明「CALL structured_output, never write JSON text」后即稳定。
2. **`job_output(wait: true)` 的单次等待上限是 `foregroundSeconds`(30 秒)**,不是整段后台任务的时长。第 2 次正式测试的 worker 自述「blocking read capped at ~30s, so further blocking reads followed」——这是 deep-ptc 的可插话设计,不是缺陷。

**仍未验证**:30 分钟上限本身(只验到 778 秒);ralph 在接近 30 分钟时的内存与取消语义。
