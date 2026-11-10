# #161 dev-flow 的 bundle patch 从未挂载任何行

- 分级:`standard`
- 关联:#161;前序 #154(常驻契约)——本 issue 是它"不生效"的真正原因
- 本阶段会动:`packages/dev-flow/{cordis.patch.yml,package.json,CHANGELOG.md,test/patch-form.test.mjs,test/patch-mounts.test.mjs}`、根 `CHANGELOG.md`、本 spec 与 `.flow/161.json`

## 1. 实测(可复核)

| 事实 | 证据 |
| --- | --- |
| patch 被当成"修改已存在行" | `dsh --profile web --dump-config` → `dsh: [dev-flow] patch: entry "dev-flow" not found` / `"git-status" not found` |
| 因此两行插件从未挂载 | 同一 dump 输出里搜不到 `id: dev-flow` |
| 正确形态在 6 个兄弟包里 | `dsh-credential-vault`/`dsh-inventory`/`dsh-task-dispatcher`/`dsh-websearch-failover`/`dsh-deep-ptc-mode`/`ecc-agent-presets` 均用 `- insert:` 包住新增行 |
| 裸 `- id:` 行只在"改已存在的行"时合法 | `dsh-deep-ptc-mode` 的 `- id: tool-bash` 等目标确实存在,属合法修改 |
| 语义在宿主源码里 | `cordis-plugin-include/src/patch.ts:applyPatches`:无 `insert` 且 `id` 找不到 → `warn('patch: entry %C not found')` 并 `continue` |

## 2. 影响

- #154 的常驻契约不生效(用户重启后也看不到);
- 更早的 skill 注册与侧栏 `git-status` 任务板面板同样从未挂载——这解释了"270 个技能里搜不到 dev-flow";
- 失败静默:只有 `--dump-config` 才会显形。

## 3. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 红:`test/patch-form.test.mjs` 断言 patch 里每个顶层条目都是 `- insert:`,且插入 id 恰为 `['dev-flow','git-status']`、无 `config`、无 `skillName/skillPath` | 先跑见红(现状是裸行) |
| T2 | 红:`test/patch-mounts.test.mjs` 用宿主真实 `applyPatches` + `yaml` 把本包 patch 应用到空树,断言得到两行且无警告;负例断言裸行只会 `not found` | 先跑见红;宿主不可用则 skip |
| T3 | 绿:`cordis.patch.yml` 改为 `- insert:` 形态 | T1/T2 全绿;`dump-config` 不再报 not found(合并后 checkout 更新时可见) |
| T4 | 元数据:0.6.0 → 0.6.1;两处 CHANGELOG;本 spec 与 `.flow/161.json` | `pnpm verify` 绿 |

## 4. 边界

- 不改包名与行 id(`dev-flow` / `git-status` 保持,DSH 靠它们识别)。
- 不动 `lib/lint.mjs` / `lib/contract.mjs` / `FLOW.md`(内容正确,问题只在挂载)。
- 不动 profile 的用户层 patch;其两条 `id is required for non-insert patches` 是既有问题,另记。

## 5. 风险

| 风险 | 缓解 |
| --- | --- |
| `insert` 无 id 时行进顶层;有 id 时进 group | 本包两行都不带父 id,进顶层;T2 用真实宿主函数验证 |
| 合并后仍需 checkout 归位到 main 才有 0.6.1 | 交付说明写明;不自行重启 |

## 6. 验收

- `packages/dev-flow` 全绿;`pnpm verify` 绿。
- 反向验证:patch 改回裸行 → 3 条红。
- 合并后在 checkout 更新的前提下,`dsh --profile web --dump-config` 出现 `id: dev-flow` 且无 not found。
