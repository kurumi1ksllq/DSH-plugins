# issue-158 · dsh-skill-surface

> 停点1 已确认(用户明示「写完直接执行」,跳过停点2 二次确认);分级 **standard**。
> 本文件是状态源。实现阶段不得改写目标/边界/验收条款。

## 开工三问(按 AGENTS.md 必答)

1. **能拆成 ≥2 个互不依赖、可独立验收的部分吗?** 能:①仓库包计数契约(8 处,纯文案/清单)与 ②插件包本体(新目录)文件不重叠,已扇出给独立子 agent 并行执行。
2. **结论值得被独立视角挑战吗?** 已经做过:三路对抗审查(runtime API / 产品价值 / 仓库规约),BLOCKER 全部吸收(见 `证据)。
3. **有能同时跑的耗时操作吗?** 有:lockfile 生成与文档契约扫描可并行;测试与 verify 串行收尾。

## 目标

1. **补器官**:让没有 preset 级 skill provider 的 agent(线上 6 个 persona-only preset,含委派路由表点名的全部 5 个)第一次获得 skill 目录与 `skill` 加载器。
2. **派活点名**:主 agent 委派时在任务首行写 `skills: a,b`,子 agent 自动获得对应 `<skill_content>`。
3. **零漂移**:provider 与 loader 全部复用官方实现;帧格式复用官方 `renderSkillContent`。

## 证据(复核方式写在括号里)

- 宿主两行被禁用:`dsh-web-app/cordis.patch.yml:521-524`。
- 线上只有 3 个 preset 带 skill 行:`dsh --profile web --dump-config`(standard/ptc/cordis);其余 6 个 persona-only。
- `planner` 子 agent session 无 `skill-catalog`、工具表无 `skill`(zstd -dc 解压 session)。
- 目录体积:catalogDescriptionMaxLength 120/200/500 → 40,976 / 59,745 / 83,257 字符(269 条 + 3,781 固定开销)。
- 历史:270 条目录时代的 65 个 session / 2,520 步只有 5 次 `skill` 调用;`deep_ptc_tools(action=skills)` 全量 0 次。
- 词法检索不可用:BM25 over name+description 对 `cordis composition plugin development` 返回 vue/swiftui/react-patterns(错)。故本 issue 不做检索层。

## 边界(明确不做)

- 不改任何上游 `SKILL.md`(270 个),不改 `whenToUse`。
- 不 fork `dsh-tool-skill` / `dsh-skill-filesystem`;不实现自己的 `SkillProvider`。
- 不抢 `skill` 工具名;不新增 skill 目录消息格式。
- 不做 BM25/语义检索、不做每轮打扰式提示、不做 `list {domain}` 分组(270 条无 domain 字段)。
- 不动 #153 正在改写的委派纪律话术与 order 21000。

## 设计

### D1 补两行(零代码)

`cordis.patch.yml` 插入:

    - id: skill-filesystem-global      # 新 row id，不被 web-app 的 disabled 命中
      name: '@deepseek-ai/dsh-skill-filesystem'
    - id: tool-skill-global
      name: '@deepseek-ai/dsh-tool-skill'
      config:
        catalogDescriptionMaxLength: 200

层语义:本 bundle 在宿主平面插入 → `registerProvider` 落 **global 层**;读取时 global 层与视野链合并,**近层同名胜出**。故 standard/ptc/cordis 行为不变,仅 persona-only 的 preset 得到兜底。官方 `tool-skill` 的目录发布器有实例身份护栏(`ctx.tools.get('skill',agent) === 自己`),host 实例对已有 preset 的 agent 不会重复推送目录。

已用 `dsh --profile web --dump-config --patch` 验证两行能组合进树且不带 `disabled`。

### D2 派活握手(本包唯一新机制)

`agent/pre-step` 中扫描本轮新到的 **user** 消息,取第一处 `skills: a,b` 行(kebab-case、去重、上限 6 个),对每个名字调用 `ctx.skills.get(name, {scope: agent, cwd, signal})`,要求 `isModelInvocable` 为真,然后用官方 `renderSkillContent` 渲染,以 `source.kind = 'skill-invocation'`(官方已注册的 source)追加为本轮消息。

### D3 协议段(恒定文本,利于 KV cache)

`systemPrompt.section`,name `dsh:skill-surface-handoff`,order **20100**(执行纪律 20000 之后;section 与 context 是两个注册表,不声称与 21000 相邻)。内容只讲"何时点名、点名格式、没有目录时怎么办",不绑定任何具体工具名(目标 agent 可能没有 todo/read)。

### D4 已注入去重

按 agent 记录已注入名字;首次为某 agent 服务时从 `agent.session` 事件重放 `skill-invocation` 恢复,避免 resume/fork 后重复注入。

## 验收(可判定)

| # | 验收 | 判定方式 |
|---|---|---|
| A1 | `skills: a,b` 产生 2 条 `skill-invocation` 消息,内容含 `<skill_content>` | `test/apply.test.mjs`(假 ctx) |
| A2 | 无 `skills:` 行 → 零注入 | 同上 |
| A3 | 重复名字 / 非 kebab-case / 超过 6 个 → 被清洗 | `test/handoff.test.mjs` |
| A4 | 未加载到或不 model-invocable 的名字 → 静默跳过,不抛 | 同上 |
| A5 | resume 后不重复注入 | 同上(重放 session 事件) |
| A6 | bundle 可 link:`dsh.bundle.patch` / `engines.dsh` / `scripts.test` / `exports ./icon ./locale/*` | `test/bundle.test.mjs` |
| A7 | zh/en 同构 | `test/protocol.test.mjs` |
| A8 | 仓库包计数契约全绿 | `node --test test/*.test.mjs` + `pnpm verify` |
| A9 | `standard` 会话不出现第二条 skill-catalog | 重载后人工核验(写进 PR 描述,不在 CI) |

**CI 不含真实 270 条语料的命中率断言**(干净 runner 没有 `~/.agents/skills`);真实语料只做离线脚本取证。

## Tickets

| # | 内容 | 依赖 |
|---|---|---|
| 1 | 仓库包计数契约(README/AGENTS/root package.json/CHANGELOG/update-scheme/verify-packages/check-profile) | — |
| 2 | 包骨架:package.json、index.js、cordis.patch.yml、icon.svg、locale、README | — |
| 3 | D2 握手 + D3 协议段 + D4 去重 | 2 |
| 4 | 测试 A1–A7 | 3 |
| 5 | lockfile(`pnpm install --lockfile-only`)+ 全量 `pnpm test` / `pnpm verify` | 1,4 |

## 连带变更清单

`README.md`、`AGENTS.md`(含目录速览表)、根 `package.json` description、`CHANGELOG.md`(Unreleased 加 `### dsh-skill-surface 0.1.0`)、`docs/update-scheme.md`、`scripts/verify-packages.mjs` EXPECTED、`scripts/check-profile.mjs` SHIPPED、`pnpm-lock.yaml`。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| global 与 preset 层出现同名 provider `filesystem` | 类型契约写明"同名仅同层抛错",跨层允许;重载后核验 A9,若异常则把 host 行改成只扫 `~/.agents/skills` 的 `customSkillDirs` 形态 |
| host `tool-skill` 给已有预设 agent 重复推目录 | 官方实例护栏;A9 核验 |
| 子 agent 被注入过多正文 | 上限 6 个名字;单条正文可能被 `tool-result-pruner` 腰斩(已有缺陷,另行开 issue) |
| 与 #153 的 order 冲突 | 本包用 section 20100 独立 name,不碰 21000 |

**回滚**:删除本 bundle 的三条 insert 行即恢复现状(不涉及数据迁移)。

## 版本与发布

新包 `0.1.0`;合并后在 main 打 `dsh-skill-surface@0.1.0` tag。
