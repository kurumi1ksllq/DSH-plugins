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

## 变更(按 review 裁决修订)

裁决:dispatcher(`dsh-task-dispatcher`)不改——SYNONYMS/ROLE_EXAMPLES 是 ECC bundle 数据的索引,bundle 随时可重新启用;测试读仓库内 ECC patch 文件,不受部署状态影响。部署态的「死键」是部署状态而非仓库缺陷,接受;§验收的「无死键」验收项据此改写为「仓库数据与其索引源(bundle patch 文件)一致」。

1. **仓库(`packages/ecc-agent-presets`)**:`test/bundle.test.mjs` 部署哨兵反转(主 profile 不得再挂白名单 5 行)+ 正向锚(patch 可解析且仍挂 registry);test 名与失败消息改为新语义;package.json description 与 README 白名单段落改退役表述;版本 +1。
2. **部署(本机 profile,仓库外)**:删除主 profile 补丁白名单块;禁用 ecc-agent-presets bundle(经 profile manifest bundles,依赖保留)。

## 验收

- 组合树 preset 行 = 4(standard/ptc/minimal/cordis);运行时名册含 deep-ptc。
- `pnpm test` / `pnpm verify` 全绿。
- 仓库测试数据与索引源一致;部署态死键为已接受状态(见 §变更 裁决)。

## 变更点

1. dispatcher(lib/roles.mjs SYNONYMS、ROLE_EXAMPLES)不改:它们是 bundle 数据的索引,ecc-agent-presets 随时可重新启用;测试读仓库内 ECC patch 文件,不受部署状态影响。运行时清空 138 角色是部署状态,注入文本的例子在 bundle 重新启用后即刻恢复有效。此为「部署与仓库解耦」的既有设计(issue-151),不为本次部署状态改仓库数据。
2. 仓库改动收敛为 ecc-agent-presets 包:哨兵测试预期反转 + README + 版本 +1(patch 文件本身不变,纯测试/文档 → 按版本纪律仍升版)。

(实现期追加)

## 部署证据(2026-11-19)

- `~/.dsh/profiles/web/cordis.patch.yml`:删除白名单 5 行块与两个悬空空 `- insert:` 残段(原 132–1180 行,共删 1049 行;备份 `cordis.patch.yml.bak-issue226`)。
- `~/.dsh/profiles/web/package.json`:bundles 18→17(ecc-agent-presets 移出;依赖保留,备份 `package.json.bak-issue226`)。
- 复验:`dsh --profile web --dump-config` 的 `@deepseek-ai/dsh-agent-preset` 行 = 4(standard/ptc/minimal/cordis);deep-ptc 由插件运行时注册,不在 dump 中。
- 哨兵测试翻转后:先红(部署前)后绿(部署后),pnpm test ecc 包 4/4 通过。
