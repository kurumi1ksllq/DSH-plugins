# CHANGELOG

One repository, nine independently versioned bundles. Every entry names the
bundle it belongs to; the tag on each release is `<package-name>@<version>`
(for example `dsh-inventory@0.2.0`).

Version discipline (enforced by `node scripts/check-bundle-versions.mjs`, wired
into `pnpm verify`): **changing a bundle's code requires bumping its version**.
A bundle whose directory has changes after its version tag fails the gate.

---

### @local/dsh-prompt-inject 0.2.1 — 测试状态路径隔离 (T0.3/#100)

- 三个契约测试(#exports the host services/#defaults apply/#config overrides)此前直接读宿主真实 `
~/.dsh/prompt-inject/state.json`,宿主存过自定义文本就红。现在包 `withTempProfile` 隔离。
零产品改动;隔离后 23/23 全绿,且与宿主状态无关。


### dsh-credential-vault 0.5.3 — 宿主引用声明化 (T0.1/#98)

- `peerDependencies` 补 `@deepseek-ai/dsh-tools`(lib/define-tool.js 的 lazy require 此前未声明,违反 0 侵入 B 项)。行为零变化。

### dsh-inventory 0.9.1 — 宿主引用声明化 + 删 app.asar 兜底 (T0.1/#98)

- `peerDependencies` 补 `@deepseek-ai/dsh-mcp-client`;删除 gate.js 的 `process.resourcesPath/app.asar` 私有路径硬拼兜底(改走 `config.mcpClientEntry` 与宿主 resolver)。
- 仓库级新增 `test/host-deps.test.mjs`:运行时代码里任何 `@deepseek-ai/*` 字面量引用必须已在 package.json 声明。

### dsh-deep-ptc-mode 1.7.4 — 宿主引用声明化 (T0.1/#98)

- `optional peerDependencies` 补齐 13 个宿主包(session/skill/tool-bash/tool-pwsh/bash-local/bash-sandbox/pwsh-local/pwsh-sandbox/tool-jobs/tool-ask-user/persona/tool-executor-ptc/tool-skill)。全部沿用宿主解析 + fail-open,行为零变化。

### dsh-stall-governor 0.1.1 — 宿主引用声明化 (T0.1/#98)

- `optional peerDependencies` 补 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-agent-loop`(此前仅依赖元包声明)。


## Unreleased

### dsh-stall-governor 0.1.0 — 失速治理单包双引擎(#96)

- 合并上游 dsh-cot-anchor v0.4.2 与 dsh-step-governor v0.2.2 为单一 bundle:共享装配、设置、client、事件设施。
- 保留:软切五判定器 + overLongCoT 兜底(probeKernelHook 三态门控)、INVALID_ARGS/ToolArgsError 恢复指引注入、命令执行纪律段(order 20000)、extractConclusions 提取器;G1-A 三子判据 + G1-B 指纹 + G1-C 硬顶、G2-A/G2-B + 目标键归一化 + 终态豁免、软停优先策略、`agent/soft-cut-suppressed` 高置信升级闭环。
- 砍掉:LLM 提炼 / CoT 采集(harvest)/ 学习模式(~800 行 + 1 路由;注入主路径移除后非现役能力,#96 §6-3)。
- 新 id:包名/行 id/`plugin:dsh-stall-governor`/路由 `/plugins/stall-governor/settings`/存储 `storages/stall-governor.json`/settings.section order 997;`ctx.provide("stallGovernor")` 合并两上游服务。
- G1 默认 shadow:agent/pre-step 与 goal 自动续跑驱动的并存顺序未经验证(#96 §6-2);deviation 自上游代码默认 g1g2,可经设置开启。
- governor 的 PENDING_DEPENDENCIES 摘除(soft-cut-suppressed 载荷契约由本包自持);watchdog 心跳机器移除(无真实 watcher 生态,预留 stallGovernor 两服务为接口)。
- 有界内存修复:governor 侧 fingerprintShingles(shingle 指纹桶)上游跨 turn 从未清理,合并后在 turn 边界与 fingerprintSteps 同口径清零(§3-9;churn/overLong 计数的 turn 清零上游 cot-anchor v0.4.2 已有,原样继承)。

### dsh-inventory 0.7.1 — 更新路由的测试不再改真实仓库

- **测试写生产状态的修复。** 插件页更新路由的 route 测试会真的跑 `git fetch`、写真实的
  `$DSH_HOME/plugin-update/last.json`,在 checkout 干净且落后时甚至真的 `git merge --ff-only`。
  一次测试运行就这样覆盖掉了用户真实的更新结果 —— 界面上那条「上次结果」其实来自测试,而不是
  用户的点击。
- apply 的全流程抽成 `performUpdate({repo, stateDir, respond, reconcile})`:仓库与状态目录
  都是参数,测试在临时仓库上跑;route handler 只负责命名真实仓库、真实状态目录和真实响应。
- 新增覆盖点 `DSH_INVENTORY_UPDATE_REPO`:为不常见布局(复制进来的 bundle、嵌套 clone)指定
  仓库,也让路由路径可被安全地端到端测试。仍会校验 `<root>/packages/dsh-inventory/package.json`
  的 name,不会对陌生仓库动手。
- `needsInstall` 改看**依赖字段**而不是"任何 package.json 变了":版本号 bump 不再触发一次
  `pnpm install`(它曾在没有依赖的 checkout 上失败并触发回滚)。

### dsh-inventory 0.7.0 — 插件页上的「更新」按钮

- **DSH 的插件页现在能直接更新本仓库的插件。** 每个 bundle 的详情页头部多一个
  「更新到 x.y.z」按钮,标题旁多一个「可更新 a → b」标签 —— 两个都是插件页自己的 slot
  (`plugins.detail.actions` / `plugins.detail.badge`),宿主包一行没改。不是本仓库的包
  → 两个 slot 都渲染 `null`,别的插件页零变化。
- **免重启生效**:更新后调 `ctx.get('hmr').runExclusive(() => hmr.reconcileProfile())`
  —— 这是 `dsh-hmr` 的 public API,也是 plugin-manager 自己用的那条路
  (`dsh-plugin-manager/lib/index.js:2366`)。没有 hmr 的 profile(headless/SDK)会如实报
  `restart-required/no-hmr`,不会自动重启。
- **点一个 = 整个 checkout 前进**(7 个 bundle 同处一个仓库),结果里列出所有变了的插件,
  不让用户以为只动了一个。
- **拒绝先于动手**:工作树脏 / HEAD 不在分支上 / 无法 ff-only / 已经是最新 —— 四种情况都在
  动任何文件之前拒绝,因为重组合不是事务,失败不恢复。
- **先说后重组合**:更新的可能就是本插件,它会被重组合停掉,所以响应必须先在 `res.end()`
  里发出去。
- 新增路由 `/inventory/plugin-update`(GET 状态)与 `/inventory/plugin-update/apply`(POST)。

### Workspace / tooling — lockfile 与 CI 守卫

- **`pnpm-lock.yaml` 的 importers 与 `packages/` 重新对齐**:补上 `dsh-credential-vault`、
  `dsh-git-status`,去掉已删除的 `dsh-ctx-guard`。
- **CI 新增一步** `git diff --exit-code -- pnpm-lock.yaml`(在 `pnpm install` 之后):
  `pnpm install --frozen-lockfile` 在 importers 失配时会 **exit 0 却改写** lockfile,
  不比较就等于没装这道闸。契约按 step 顺序断言它(注释掉、挪到 install 之前、或加
  `|| true` 都会红)。

### dsh-git-status 0.2.2 — remotes survive a mirror

- **面板的仓库链接不再被 `insteadOf` 破坏。** `remotesOf` 原来读 `git remote -v`,那条
  命令输出的是 `url.<base>.insteadOf` **改写后**的地址:配了镜像的机器上,面板收到
  `https://mirror/…/https://github.com/me/repo.git`,解析不出 `owner/repo`,GitHub 链接
  因此失效(本机 `~/.gitconfig` 就踩到了,连测试都跟着假红)。现在改读
  `git config --local --get-regexp '^remote\..*\.url$'`,拿仓库里真正写的值。
- 测试:`url.<x>.insteadOf` 存在时仍然返回原始 URL,且 `slugFromRemoteUrl` 能得到
  `me/repo`;把实现退回 `git remote -v` 即红。

### dev-flow-skill 0.2.1 — the dual-axis review prompt now actually ships

- **停点3 的双轴 review 有了可复制的模板。** 原文写「用下面的**固定 prompt 模板**」,
  但下面只有几条要求 bullet、没有可复制正文,于是每次 review 都靠执行者临场重建,两条轴
  随会话漂移。现在模板正文以代码块落在 `SKILL.md` 里(轴1 对 spec、轴2 对规范),含
  「原文照抄、不得即兴改写」「只报告不修改任何文件」「至少 3 个问题,确实找不到就写
  未发现问题」。
- 契约 `test/review-template.test.mjs`:两条轴**各自**切区间校验(不能靠另一条轴的文字
  蒙过),并要求模板声明「不得即兴改写」;删掉任一条轴的要求即红。

### dsh-credential-vault 0.2.1 / dsh-inventory 0.5.0 — vault joins the Tools page

- **"Leave empty to keep the stored secret" now actually works.** The editor always
  sent an empty secret when only metadata changed, and the host rejected it with
  400. `/set` now keeps the sealed value for an existing entry, and still refuses
  to create one without a secret.
- **Cancelling a delete or rotation is a no-op again.** The confirmation ran inside
  the busy wrapper, so cancelling still reloaded the panel and cleared the error
  message the user was reading.
- **Error responses never forward `error.message`.** A future throw that
  interpolated secret material would have gone straight onto the wire.
- The three bundle client halves are now dictionary-only: the migrated sidebar
  panels (Icon/Page/styles, ~860 lines total) are deleted rather than left behind
  as a second, unowned copy of the same UI.

- The credential manager moved into `dsh-inventory`'s 工具管理 panel, right next
  to the `credential` tool it backs: a 「凭据保险库」 segmented tab plus a
  collapsible overview section (masked list, detail card, add/edit form with
  "leave empty to keep the stored secret", delete, master-key rotation, reveal
  audit log). Same routes, same guarantees — no route returns plaintext, and the
  panel only ever renders the masked `preview`.
- `dsh-credential-vault`'s client half now registers **only its locale
  dictionary** (`inject: ['locale']`); the host half (vault store, `credential`
  tool, audit log, API) is untouched. With web-search providers and the prompt
  editor, all three former sidebar panels now live on one page.

### dsh-inventory 0.4.0 / dsh-websearch-failover 0.3.0 / @local/dsh-prompt-inject 0.2.0 — UI consolidation

- **The web-search provider manager moved into the Tools page.** Sidebar entries
  `websearch-failover` and `prompt-inject` are gone; both sections now render
  inside `dsh-inventory`'s 工具管理 panel, each with its own segmented tab
  (「Web 搜索提供方」/「提示词注入」) and, on the overview, a collapsible section at
  the top. "Tools" is the page that answers what the agent can reach, so the
  order and balance of the providers that answer `web_search` — and the text
  injected into every system prompt — are edited next to the tool list they
  control instead of in two more sidebar rows.
- The provider section was rewritten in the panel's own visual language
  (grouped inset rows, iOS switches replaced by the shared chips/row controls,
  hairline detail card). Behaviour is unchanged: priority order by drag or
  arrows with optimistic update + rollback, balance bars per billing unit,
  cooldown countdown, per-provider enable/disable, `/refresh` only on an
  explicit click (balances are billed per call), and the prompt editor keeps its
  local empty-text guard.
- The two bundle client halves now register **only their locale dictionaries**
  (`inject: ['locale']`, no `sidebar.panellist` / `main` registration), so a
  profile can no longer end up with three sidebar rows for one settings area.
  Their host halves are untouched.
- Tests: `dsh-inventory` gained two browser-half tests that drive the provider
  section (balance units, detail reset rule, arrow reorder POST, refresh-all) and
  the prompt section (load, save, empty-body rejection) against the real routes;
  the two bundles' client tests were rewritten for the new
  dictionary-only contract.

### Workspace / tooling

- **Build-freshness gate (D2).** New `scripts/check-artifacts.mjs` verifies the
  `plugin/lib/` of every copy of a bundle that a DSH profile actually loads — not
  just the copy in the current checkout. It resolves `link:` targets out of
  `$DSH_HOME/profiles/*/node_modules`, so a bundle rotting in a *different*
  checkout can no longer pass while the running copy is stale.
- **Tests no longer repair the artifact they test.** `test-host-plugin.mjs` and
  `test-integration.mjs` used to copy `lib/*.mjs` into `plugin/lib/` before
  booting the bundle, which silently healed a stale build and made it
  undetectable. They now assemble a probe bundle in a temp directory
  (`test/probe-bundle.mjs`) and import that; the checkout is never written to.
- **Profile wiring check (P1-5).** New `scripts/check-profile.mjs` — read-only.
  Resolves every linked bundle, records the checkout and commit behind it, and
  reports bundles served from another checkout as warnings (today: 4 of 6 —
  see D1). Dangling links and missing entry points are hard failures.
- **Packaging discipline (P1-7/P1-8/P1-9).** New
  `scripts/check-bundle-versions.mjs` requires `engines.dsh` and a `test` script
  on every bundle, and rejects code changes that did not bump the version.
  Added `engines.dsh: ^0.2.0` to all 8 bundles; `dsh-git-bash-tool` gained its
  first tests (6) and a `test` script, so `pnpm -r --if-present` can no longer
  skip it in silence.
- `pnpm verify` now runs four gates (packages, artifacts, profile, versions);
  `pnpm gate` = `verify` + `test`.
- **Transactional updater (L2).** New `scripts/update.mjs` (+ `scripts/update/`)
  implements the plan → fetch/stage → verify → swap → observe → rollback
  pipeline from `docs/update-scheme.md` §4.2. Deliberately **not** wired into
  `pnpm gate`: it mutates a live profile, so it is an operator tool, not a check.
  Highlights:
  - planning is per **link target**, not per repository — a profile can mix two
    checkouts of one monorepo (the live one does), so "the repo" is not a
    well-defined update unit;
  - verification runs entirely against the **staged** tree (bundle contract,
    generated-artifact freshness, entry importability, dependency additions,
    `dsh --dump-config` with empty stderr); nothing touches live code;
  - the swap is a single `renameat2(RENAME_EXCHANGE)` syscall, so no reader ever
    sees a missing package and the previous generation lands at the staging
    path as a free rollback copy;
  - `swap`/`rollback` are dry runs without `--confirm`, and a `restart required:`
    verdict is reported to the operator — the tool never restarts DSH;
  - `rollback` only exchanges a tree the journal proves holds the previous
    generation, and refuses once that exchange has already been undone.

### dsh-inventory — 0.2.1 (unreleased)

- **Fleet manifest (v2).** Several machines can publish into one document;
  each publisher owns its own section (`{ fleetVersion: 2, machines: { id: … } }`)
  and readers flatten the sections back into the v1 view, so the diff/apply
  pipeline is unchanged. A legacy v1 file reads as a one-machine fleet.
- **Stable machine identity.** `machineId` is minted once on first read and
  persisted in the sync state, so a machine keeps its section across restarts.
- **Concurrent publish converges instead of clobbering.** Git writes that lose a
  race return `conflict`; HTTP writes send `If-Match` and report 412/409 as a
  conflict, so the caller re-reads the winner's document, re-merges its own
  section and retries.
- **"Not published yet" is no longer an error.** When every transport answers
  404 the manifest is reported as `notFound`, and the panel shows an empty
  fleet instead of a read failure — the normal first-run state. A transport
  crash is still an error: only an explicit 404 from every transport may claim
  the file is missing.
- **The status path is read-only again.** `syncStatus` no longer mints a
  `machineId` (i.e. writes the state file) just to render the panel.

---

## History

Releases before this file existed were not tagged; this section records what
each bundle's current version contains so the running instance is at least
described.

### dsh-inventory 0.2.0

- Gitee and self-hosted HTTP sync transports; `repoUrl` bootstrap.

### dsh-inventory 0.1.0

- Capability inventory, capability manifest, diff/apply, panel.

### dsh-websearch-failover (bundle 0.2.0 / repo root 0.3.0)

- Multi-provider web search with failover, balance-aware routing, and a live
  HTTP integration test. The bundle directory (`plugin/`) and the repo root
  (`websearch-dsh-plugin`) currently carry two different version numbers; the
  bundle version is the one the host loads. Reconciling them is tracked under
  P1-7.

### dsh-ctx-guard 0.1.1

- Context-usage guard rails; follow-up fixes over 0.1.0.

### dsh-credential-vault 0.1.0

- Encrypted credential vault with a single-row bundle patch and no config.

### dsh-git-bash-tool 0.1.0

- Windows-only: routes the bash tool through Git Bash so commands stop landing
  in PowerShell. Untested until the packaging gate added its first tests.

### dsh-git-status 0.1.0

- Repository status panel (issues #18–#22, plus two rounds of review fixes).

### @local/dsh-prompt-inject 0.1.0

- Injects a system prompt section; declares `systemPrompt` in `inject`.

### dev-flow-skill 0.1.0

- Development flow skill bundle.

---

<!-- 以下为 T0.2 依 git log 补写的历史发版条目(补记,原发版时漏记)。按 tag 时间升序。 -->

### @local/dsh-prompt-inject 0.1.0 — 补记(2026-11-02)

- · feat(gate): verify the code that is actually loaded, not the checkout · docs: workspace README, per-package test script, profile probe · feat: five DSH bundles in one workspace

### dev-flow-skill 0.2.0 — 补记(2026-11-03)

- · feat(git-status): 面板改造为 dev-flow 任务板 (#27)

### dsh-git-status 0.2.0 — 补记(2026-11-03)

- · feat(git-status): 面板改造为 dev-flow 任务板 (#27)

### dsh-git-status 0.2.1 — 补记(2026-11-03)

- · test(git-status): 把测私有函数的用例改成黑盒行为测试 (#33)

### @local/dsh-prompt-inject 0.2.0 — 补记(2026-11-03)

- · chore(tools-page): 文档死引用、补回三条编辑器测试、删死字典键、inventory 0.5.0 · refactor(tools-page): 删除迁移后残留的死 UI,并把测试断言搬去新家 · wip(tools-page): 导入已有 UI 整合改动(功能主体完成,收尾待修)

### dev-flow-skill 0.2.2 — 补记(2026-11-04)

- · fix(dev-flow-skill): 让 bundle 真能注册 skill,照 README 装不再崩 (#47) (#59)

### dev-flow-skill 0.2.3 — 补记(2026-11-04)

- · fix(credential-vault): 收口 #49 审查遗留 8 项(#50 #52-#58) (#63)

### dsh-credential-vault 0.3.0 — 补记(2026-11-04)

- · feat(credential-vault): 规范化存储 + 模糊命中 + 零明文使用路径 (#41)

### dsh-credential-vault 0.4.0 — 补记(2026-11-04)

- · fix(credential-vault): 原型污染 + 元数据无校验（现存线上缺陷） (#49)

### dsh-credential-vault 0.4.1 — 补记(2026-11-04)

- · fix(credential-vault): 收口 #49 审查遗留 8 项(#50 #52-#58) (#63)

### dsh-inventory 0.6.0 — 补记(2026-11-04)

- · feat(credential-vault): 规范化存储 + 模糊命中 + 零明文使用路径 (#41)

### dsh-inventory 0.8.0 — 补记(2026-11-04)

- · feat(credential-vault): 导出/导入(口令加密信封 + 按 id 去重 + 面板与 CLI) (#64)

### dsh-credential-vault 0.5.1 — 补记(2026-11-06)

- · test(credential-vault): define-tool 测试隔离改用 DSH_HOME(#68) (#83)

### dsh-credential-vault 0.5.2 — 补记(2026-11-06)

- · test(credential-vault): 文件 mode 断言加平台闸，Windows 上不再必挂 (#85)

### dsh-inventory 0.8.4 — 补记(2026-11-06)

- · test(inventory): 补强工作区测试四处缺口(#71 #75) (#79) · fix(inventory): 合法空声明在面板显示为正常空态(#74) (#78) · fix(inventory): 默认工作区写路径与视图对称(#72) (#77)

### dsh-inventory 0.8.5 — 补记(2026-11-06)

- · fix(inventory): MCP 全局开关写入定义该 id 的 patch 层 (#86)

### dsh-inventory 0.8.6 — 补记(2026-11-06)

- · fix(inventory): manager 分支前判层,home patch id 绕过 manager(#87) (#88)

### dsh-inventory 0.8.7 — 补记(2026-11-06)

- · fix(inventory): definedIds 识别 insert 嵌套定义，死覆盖条目不再毒化判层 (#90)

### dsh-deep-ptc-mode 1.7.3 — 补记(2026-11-07)

- · 集成上游 dsh-deep-ptc-mode@1.7.3 为第八个 bundle (#95)

### dsh-inventory 0.9.0 — 补记(2026-11-07)

- · dsh-inventory: 工具管理面板改左侧栏导航(master-detail)布局 (#92)
