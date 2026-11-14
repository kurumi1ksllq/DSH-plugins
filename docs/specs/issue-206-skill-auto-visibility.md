# issue-206: 让 agent 看得见 skill 工具,并把「该不该加载」交给 agent 自己判断

## 分级

**standard**。改动跨两个包(`dsh-deep-ptc-mode`、`dsh-skill-surface`),触及
「agent 能否发现并使用 skill」这一可达性契约,不是文案微调。TDD 照做,双轴 review 照做。

## 背景:实测证据(2026-11-14,418 个会话)

用户诉求:「我需要完整的 skill 自动加载」。开工前做了只读实测,推翻了 issue-201 的
一个隐含假设——**「agent 不爱加载 skill」这个描述是错的**。

### 事实 1:skill 工具是活的,但发现链路全线失联

在本会话(deep-ptc 组合,顶层工具只有 `run_code`)实测:

| 探测 | 结果 |
|---|---|
| `await tools.skill({name:'security-review'})` | ✅ 成功,返回 12,610 字正文 |
| `await tools.skill({name:'test-coverage'})` | ✅ 成功,返回 2,886 字正文 |
| 顶层工具清单(`request/header.tools`) | 只有 `run_code` 一个 |
| `tool_search({query:'skill'})` | 只返回 `skill_get`(一个本会话并不存在的兜底工具) |
| `tool_search({query:'instructions'})` | 空 |
| `tool_describe({name:'skill'})` | ✅ 能拿到完整 schema |

结论:工具可调用、schema 可读取,但**检索索引里没有它**。系统提示要求 agent
「call the `skill` tool」,而 agent 在工具面上找不到这个名字。这不是「不爱用」,
是**够不着**。

### 事实 2:目录越长,加载率越低

| 目录规模 | 会话数 | 加载率 |
|---|---|---|
| ≤20 条 | 223 | 7% |
| >200 条 | 120 | 2% |

272 条目录一次推 84,447 字符(≈21K tokens),反而抑制了加载。

### 事实 3:跨语言检索不可用,算法筛选这条路走不通

技能描述是英文,用户提问是中文。实测 `deep_ptc_tools(action=skills)`:

| 中文 query | 命中 |
|---|---|
| 跑测试 / 单元测试 / 样式 / 鉴权 / 数据库迁移 / 部署 / 代码安全审查 | **全部 0** |
| React 组件 | 14 |

自研 BM25 复核:「跑一下测试看看」0 命中;「部署到生产环境」命中
`openclaw-persona-forge`(无关技能)。现有 `domains.mjs` 词表覆盖 19/272 = 7%。

**因此本 issue 不实现任何「自动挑选技能」的算法。** 用户已确认方向:
「让 AI 自己分析是否需要加载」。算法要做的是把**判断所需的信息**送到 agent 面前,
而不是替 agent 做判断。

## 目标

让 agent 在每一轮都能:①知道 `tools.skill` 存在且可调;②知道该自问「这个任务
是否属于某类专项工作」;③一次调用就能取到正文(含中文意图兜底)。

## 边界

**做**:
- `dsh-deep-ptc-mode`:在 deep-ptc 组合下,让 `skill` 工具在检索索引与 SDK 段中可达。
- `dsh-skill-surface`:中文意图到技能名的兜底映射(仅用于兜底,不替代 agent 判断)。

**不做**:
- 不做「按算法自动注入技能正文」——实测证明跨语言匹配不可靠,且用户明确否决。
- 不改 `hasOfficialLoader` 的语义(有官方加载器时 skill-surface 仍保持沉默)。
- 不动目录推送机制本身(84KB 全量推送是宿主行为,不在本 issue 范围)。
- 不重启 DSH 宿主进程(需用户手动重启生效)。

## 验收标准

1. deep-ptc 组合下,`tool_search` 以 `skill` 为 query 能返回官方 `skill` 工具(不再只有幽灵 `skill_get`)。
2. `skill` 出现在 SDK/工具目录段中,agent 无需猜测即可知道其存在。
3. 注入的提示文本包含「先自问任务是否属于专项工作」的判断指令,且**不含任何技能正文**(成本约束:每轮几十字量级,不是几千字)。
4. `skill-surface` 的兜底映射:给定中文意图词,能返回候选技能名;候选必须存在于当前 catalog,不存在则丢弃。
5. 兜底映射**不覆盖**已有 `domains.mjs` 的行为(既有 92 条测试全绿)。
6. 无官方 `skill` 工具时,skill-surface 的 `skill_get` 行为不变。

## 反向验证(每条必须实测变红)

| 改回什么 | 应红哪条 |
|---|---|
| 从索引里移除 `skill` 的可见性登记 | 验收 1 |
| 提示文本去掉「先自问」判断句 | 验收 3 |
| 提示文本改为注入技能正文 | 验收 3(成本断言) |
| 兜底映射返回 catalog 中不存在的名字 | 验收 4 |
| 兜底映射覆盖 domains 的既有域 | 验收 5 |

## 版本

- `dsh-deep-ptc-mode`:1.13.3 → 1.14.0(公开可达性行为变化)
- `dsh-skill-surface`:0.3.1 → 0.4.0(新增兜底映射)

## 环境缺口(不影响开发,影响交付)

`gh` 未认证(`gh auth status` → not logged in)。因此 **issue 创建、PR、CI 三步无法执行**。
开发、TDD、本地四件套、双轴 review 照做;合并前需用户执行:

```bash
gh auth login
```
