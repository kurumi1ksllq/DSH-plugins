# #161 dev-flow 的 bundle patch 从未挂载任何行

- 分级:`standard`
- 关联:#161;前序 #154(常驻契约)——本 issue 是它"不生效"的真正原因
- 本阶段会动:`packages/dev-flow/{cordis.patch.yml,package.json,CHANGELOG.md,test/patch-form.test.mjs,test/patch-mounts.test.mjs}`、根 `CHANGELOG.md`、本 spec 与 `docs/specs/.flow/161.json`

## 1. 实测(可复核)

| 事实 | 证据 |
| --- | --- |
| patch 被当成"修改已存在行" | `dsh --profile web --dump-config` → `dsh: [dev-flow] patch: entry "dev-flow" not found` / `"git-status" not found` |
| 因此两行插件从未挂载 | 同一 dump 输出里搜不到 `id: dev-flow` |
| 正确形态在其余 7 个 bundle 里 | `ls packages/*/cordis.patch.yml` = 8 个(含本包);其余 7 个都用 `- insert:` 包住新增行(`dsh-credential-vault`/`dsh-inventory`/`dsh-skill-surface`/`dsh-task-dispatcher`/`dsh-websearch-failover`/`dsh-deep-ptc-mode`/`ecc-agent-presets`) |
| 裸 `- id:` 行只在"改已存在的行"时合法 | `dsh-deep-ptc-mode` 的 `- id: tool-bash` 等目标确实存在,属合法修改 |
| 语义在宿主源码里 | `cordis-plugin-include` 的 `applyEntryPatches`(源码内部名 `applyPatches`,src/patch.ts):无 `insert` 且 `id` 找不到 → `warn('patch: entry %C not found')` 并 `continue` |

## 2. 影响

- #154 的常驻契约不生效(用户重启后也看不到);
- 侧栏 `git-status` 任务板面板同样从未挂载(dump 里连 `git-status` 行都没有);
- 失败静默:只有 `--dump-config` 才会显形。

**不作为本 issue 结论的**:"技能目录里搜不到 dev-flow"是另一条独立死因(#154 §1 记录为原因未定;当时 `~/.dsh/skills/dev-flow` 还是一条指向已改名目录的死链,现已删除)。0.6.0 起 `index.js` 已无 `ctx.skills.register` 路径,所以"skill 注册从未挂载"既无代码可测也无证据,不写进结论。

## 3. Tickets

| # | 标题 | 验收 |
| --- | --- | --- |
| T1 | 红:`test/patch-form.test.mjs` 断言 patch 里每个顶层条目都是 `- insert:`,且插入 id 恰为 `['dev-flow','git-status']`、无 `config`、无 `skillName/skillPath` | 先跑见红(现状是裸行) |
| T2 | 红:`test/patch-mounts.test.mjs` 用宿主真实 `applyPatches` + `yaml` 把本包 patch 应用到空树,断言得到两行且无警告;负例断言裸行只会 `not found` | 先跑见红;宿主不可用则 skip |
| T3 | 绿:`cordis.patch.yml` 改为 `- insert:` 形态 | T1/T2 全绿;`dump-config` 不再报 not found(合并后 checkout 更新时可见) |
| T4 | 元数据:0.6.0 → 0.6.1;两处 CHANGELOG;本 spec 与 `docs/specs/.flow/161.json` | `pnpm verify` 绿 |

## 4. 边界

- 不改包名与行 id(`dev-flow` / `git-status` 保持,DSH 靠它们识别)。
- 不动 `lib/lint.mjs` / `lib/contract.mjs` / `FLOW.md`(内容正确,问题只在挂载)。
- 不动 profile 的用户层 patch;其两条 `id is required for non-insert patches` 是既有问题,另记。

## 5. 风险

| 风险 | 缓解 |
| --- | --- |
| 测试 import 宿主内部符号(`applyEntryPatches` 别名)与安装树绝对路径,属"禁测私有函数"的例外 | 只在宿主存在时运行;断言 include 主版本 1.x,升级会显式红;宿主树存在却解析失败时 `assert.fail` 而非 skip |
| 无宿主树的机器(CI)上这条守卫会 skip | 形状守卫 `patch-form.test.mjs` 不依赖宿主,任何环境都跑;skip 时打 `t.diagnostic` 说明原因,并在此记录:CI 只能守住形状,守不住语义 |
| `insert` 不替换、不去重:若 profile 用户层已手写同 id 行会双挂载 | 新增用例断言宿主行为,并断言当前 profile patch 不含这两个 id;若将来要改,需先删用户层那一行 |
| `insert` 无 id 时行进顶层;有 id 时进 group | 本包两行都不带父 id,进顶层;T2 用真实宿主函数验证 |
| 合并后仍需 checkout 归位到 main 才有 0.6.1 | 交付说明写明;不自行重启 |

## 6. 验收

- `packages/dev-flow` 全绿;`pnpm verify` 绿。
- 反向验证:patch 改回裸行 → 3 条红(本机有宿主树;无宿主树的环境为 2 条,语义那条会 skip)。
- **合并后待验**(当前不成立,勿当已完成):在 checkout 归位到 main 的前提下,`dsh --profile web --dump-config` 出现 `id: dev-flow` 且无 not found。
- **合并后待验**:`dev-flow@0.6.1` tag(check-bundle-versions 现在仍提示 untagged)。

## 7. 双轴 review 裁决(2026-11-10,PR #163)

两轴共报 15 条,合并去重后 12 条;采纳 11,部分采纳 1,无「改行为」的异议。

| # | 发现 | 裁决 | 处理 |
| --- | --- | --- | --- |
| 1 | 归因过度:把「270 个技能里搜不到 dev-flow」当成 patch bug 的后果,与 #154 的「原因未定」冲突;0.6.0 起已无 skill 注册路径 | 采纳 | spec §2 与两处 CHANGELOG 只声明契约与面板未挂载;技能目录那条注明是独立死因(当时的死链),不在本 issue 解释范围 |
| 2 | 端到端守卫在无宿主树的机器上静默 skip | 采纳 | `DSH_RUNTIME` 显式设置或宿主树存在时,解析失败一律 `assert.fail`;两者都没有时才 skip 并打 `t.diagnostic` |
| 3 | `insert` 不替换不去重,profile 若已手写同 id 会双挂载 | 采纳 | 新增「已有同 id 时得到两行」用例,并断言当前 profile patch 不含这两个 id;写进 §5 风险 |
| 4 | 只断言 id 不断言 `name`;name 写错仍全绿 | 采纳 | `patch-form` 断言 name 清单、按 `exports` 反查,并 `import` 两条 name 断言有 `apply` |
| 5 | 守卫 import 宿主内部符号与绝对路径(触「禁测私有函数」) | 部分采纳 | 保留(否则没有证据),但断言 include 主版本 1.x(升级显式红),并写进 §5 风险 |
| 6 | 兄弟包是 7 个不是 6 个,漏了 `dsh-skill-surface` | 采纳 | spec 与 CHANGELOG 改为 7 个并补名 |
| 7 | `.flow` 状态落后(stage=dev / review=not-started) | 采纳 | 随节点推进;裁决期间保持 `stage: review` |
| 8 | patch 注释里「本 bundle 存在就是为了消除该失败模式」属事实漂移 | 采纳 | 注释只留长期成立的约束,事故经过留在 CHANGELOG |
| 9 | 形状规则只守一个包,跨 bundle 通病无守卫 | 采纳 | `scripts/verify-packages.mjs` 增跨 bundle 检查:裸行且无任何覆盖键即报错(带 `allow-bare-row` 豁免);实测 8 包全过、改回裸行即红 |
| 10 | 形状断言耦合 4 空格缩进,重排会误红、深层 insert 会漏 | 采纳 | 改为结构解析(顶层条目 + insert 块内任意缩进) |
| 11 | 负例硬编码对象,没证明旧 YAML 会解析成它 | 采纳 | 负例改为把旧文件文本交给同一解析器 |
| 12 | 文档写 `applyPatches`,宿主对外只导出 `applyEntryPatches` | 采纳 | 改为对外名 + 括注源码内部名 |
| 13 | spec 写 `.flow/161.json`,实际在 `docs/specs/.flow/` | 采纳 | 改全路径(两处) |
| 14 | 合并后两项未闭合(dump-config、tag) | 采纳 | §6 明确标「合并后待验」 |
