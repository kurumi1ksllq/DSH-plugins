# issue-226:preset 名册收缩——只留四个内置 + 深度PTC

**grade**: standard
**日期**: 2026-11-19

## 目标

用户要求 Web UI 的 agent preset 选择器只显示四个内置 preset(standard/ptc/minimal/cordis,即标准/PTC/极简/创造模式)与 dsh-deep-ptc-mode 注册的深度PTC模式;清掉其余 138 个 preset。

## 现状(实测)

- 组合树 `dsh --profile web --dump-config` 共 142 个 `@deepseek-ai/dsh-agent-preset` 行:
  - 4 个内置来自 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`(不动);
  - 深度PTC由 `dsh-deep-ptc-mode` 运行时注册(不动);
  - 5 个白名单(preset-architect/planner/code-reviewer/security-reviewer/build-error-resolver)在 `~/.dsh/profiles/web/cordis.patch.yml` 的一个 `- insert:` 块(约 134–1180 行,issue-151 迁移的遗留);
  - 133 个 ECC preset 来自 `ecc-agent-presets` bundle。
- 名册显示与 registry 一一对应:删行/关 bundle 即从 UI 收起。
- 委派(`role_search`/`delegate_role`)读 `agentPresets.list()`;这 138 个角色随 preset 消失。用户已确认接受。
- `SYNONYMS.计划` 映射含 `planner`(仅存在于白名单),删除后 `计划` 仍可经 `gan-planner`(ECC bundle 内)?**不,ECC bundle 也关**——故 `计划`→planner/gan-planner 均不可达。`planning` 词缀也无行。`sprint-prioritizer` 也在 ECC bundle。→ 同义词表 `计划` 会成为死键。

## 变更

1. **仓库(`packages/dsh-task-dispatcher`)**:`lib/roles.mjs` 的 `SYNONYMS.计划` 移除 `planner`/`sprint-prioritizer`/`planning` 等仅由被清 preset 满足的词条,或改指向仍可达的词(`gan-planner` 亦被清,同样失效)。实际口径:删除 `计划` 键(synonyms-live 测试按仓库内 ECC patch 文件断言,不受部署影响——但 roster 在部署上不再含这些行,注入文本不能再宣传死键)。注意 `test/chinese-search.test.mjs`/`test/synonyms-live.test.mjs` 的断言随词条调整。
2. **仓库(`packages/ecc-agent-presets`)**:`test/bundle.test.mjs` 的部署哨兵(断言 5 行留在主 profile)与 WHITELIST 语义反转:新部署不再在主 profile 保留这 5 行;README 更新白名单段落。bundle 版本号 +1(patch 文件不变,纯测试/文档改动也须升版,见版本纪律)。
3. **仓库(`packages/dsh-task-dispatcher`)**:`BUILTIN_PRESETS` 不变(仍排除五个内置组合);README/注入文本如提及白名单 5 件套需校对(`lib/delegation-text.mjs` 未引用这 5 个 id,无需改)。
4. **部署(本机 profile,仓库外)**:
   - 删除 `~/.dsh/profiles/web/cordis.patch.yml` 中 5 行白名单块及其注释,改写注释说明去向;
   - `plugin_manager set_bundle ecc-agent-presets enabled:false`(经 Web UI 工具或会话内调用;CLI `dsh plugin manager` 不是子命令)。禁重启宿主。

## 验收

- 组合树 preset 行 = 4(standard/ptc/minimal/cordis);运行时名册含 deep-ptc。
- `pnpm test` / `pnpm verify` 全绿。
- 注入文本中的中文关键词无死键。

## 变更点

1. dispatcher(lib/roles.mjs SYNONYMS、ROLE_EXAMPLES)不改:它们是 bundle 数据的索引,ecc-agent-presets 随时可重新启用;测试读仓库内 ECC patch 文件,不受部署状态影响。运行时清空 138 角色是部署状态,注入文本的例子在 bundle 重新启用后即刻恢复有效。此为「部署与仓库解耦」的既有设计(issue-151),不为本次部署状态改仓库数据。
2. 仓库改动收敛为 ecc-agent-presets 包:哨兵测试预期反转 + README + 版本 +1(patch 文件本身不变,纯测试/文档 → 按版本纪律仍升版)。

(实现期追加)

## 部署证据(2026-11-19)

- `~/.dsh/profiles/web/cordis.patch.yml`:删除白名单 5 行块与两个悬空空 `- insert:` 残段(原 132–1180 行,共删 1049 行;备份 `cordis.patch.yml.bak-issue226`)。
- `~/.dsh/profiles/web/package.json`:bundles 18→17(ecc-agent-presets 移出;依赖保留,备份 `package.json.bak-issue226`)。
- 复验:`dsh --profile web --dump-config` 的 `@deepseek-ai/dsh-agent-preset` 行 = 4(standard/ptc/minimal/cordis);deep-ptc 由插件运行时注册,不在 dump 中。
- 哨兵测试翻转后:先红(部署前)后绿(部署后),pnpm test ecc 包 4/4 通过。
