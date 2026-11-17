# issue-218: skill-nudge 被误判为 persona 泄漏而忽略 + 委派「不要调用 skill」连坐

- **分级**: standard(两包、8 个文件、含行为文案接口变更,超 trivial 门槛)
- **issue**: https://github.com/kurumi1ksllq/DSH-plugins/issues/218
- **分支**: issue-218-skill-nudge-authority

## 目标
让 skill-nudge 不再被模型误判来源,并把「加载技能」与「探索宿主」在委派纪律里解耦,使「nudge→加载」的行为闭环可发生。证据:session-3e82a079 全转录 3 次 nudge / 0 次 skill 调用,nudge 被标注为 "leaked instruction" 丢弃,16 次委派提示词写死「不要调用 skill」。

## 变更清单
| 文件 | 变更 |
| --- | --- |
| packages/dsh-skill-surface/lib/domains.mjs | nudgeLine 加 NUDGE_PROVENANCE 前缀 + NUDGE_DELEGATION_HINT 后缀(两个导出常量) |
| packages/dsh-skill-surface/index.js | NUDGE_MAX_CHARS 120→160,注释同步 |
| packages/dsh-skill-surface/test/domain-trigger.test.mjs | 新增前缀/提示/上限测试;E1/E10 断言按新渲染更新 |
| packages/dsh-task-dispatcher/lib/delegation-text.mjs | zh/en lanes 各加一条「加载技能≠探索宿主」 |
| packages/dsh-task-dispatcher/test/owned-clauses.test.mjs | OWNED_CLAUSES(zh)与 en 清单各加条目 |
| packages/dsh-skill-surface/package.json | 0.4.2 → 0.4.3 |
| packages/dsh-task-dispatcher/package.json | 0.9.0 → 0.9.1 |
| CHANGELOG.md | 两包条目 |

## 设计决策(spec 级,自决留证)
1. **前缀 `[宿主提醒·skill-surface] `**:自报来源插件,机器风格;模型无需记忆任何约定即可归因(根因是「只能猜来源」)。回声守卫 looksLikeNudge 仍匹配 NUDGE_PREFIX+NUDGE_SUFFIX,前缀不参与守卫。
2. **上限 160 的依据**:UI 域 worst-case(3 个长名,行内不点名重复)= 142 字;旧上限 120 会截断 NUDGE_SUFFIX → 回声守卫失效(F2 类场景反而被破坏)。160 留余量,仍是一行短句。
3. **委派提示措辞「skills: 同名点名注入」**:不重复技能名(重复超长),引用行内已有名字;两种 loader(skill / skill_get)下都成立。
4. **dispatcher 条款**:正着说「加载允许且鼓励」,反着禁「连坐禁令」;点名 skill-nudge,把两侧信号接起来。
5. **明确不做**(留证):自动加载正文(与「噪声教会模型忽略提醒」哲学冲突,issue-201 已做单命中直返)、提高 nudge 频率、宿主强制闸门。
6. README 已核实不记载 nudge 行格式,不改。

## 裁剪
- 双轴 review:**不裁**——条款是给模型的行为指令,文案措辞质量值得第二视角。
- TDD 红绿循环按 FLOW 在主上下文执行(不派子代理写码)。

## 验收
1. 新 nudge 渲染行以 `[宿主提醒·skill-surface]` 开头、含「skills: 同名点名注入」、UI worst-case ≤160 且不被截断
2. 既有回声守卫契约(F2/F2b/F2c)不回归
3. zh 文案含新条款;en 同构;从 delegation-text.mjs 删条款 → owned-clauses 红
4. pnpm test / pnpm verify 全绿;两包升版正确

## 变更点
(实现中追加)
