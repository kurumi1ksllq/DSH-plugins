# DSH-plugins 插件可靠更新方案

> **现状校准（2026-11-04,main @ 54b61c0）**：本方案调查于 2026-11-02,当时的多条结论**已经修复**。
> 下文 §0-§2 的「现状」按当天写,不再代表今天;§3(运行时机制)、§4(L2 事务器)、§5-§7(执行与回退)仍然有效。
>
> | 结论 | 今天的状态 | 复核命令 |
> | --- | --- | --- |
> | P0-1 profile 被两个 checkout 劈成两半 | ✅ 已统一:5 条 `link:` 全指 `/root/DSH-plugins` | `node scripts/check-profile.mjs` → `profile ok: 5 linked bundle(s)` |
> | P0-2 被加载代码依赖 gitignore 生成物 | ⚠️ 本机已构建(`plugin/lib` up to date);**fresh clone 必须先 `pnpm build:websearch`**,clone 里没有生成物 | `pnpm check:websearch` |
> | P0-3 运行 commit 不在任何 tag/分支上 | ✅ 已收口进 `main`,tag 齐全 | `git tag` |
> | P1-5 / P1-8 / P1-9 / P1-10 | ✅ 已修(见 §2 表后的复核段) | `pnpm verify` + `ls .github/workflows/ci.yml` |
> | P1-6 `pnpm-lock.yaml` importers 漂移 | ✅ 已修(2026-11-04;CI 同时加了「install 后 lockfile 不许变」的守卫) | 见 §2 表后复核段 |
> | D1 统一权威 checkout | ✅ 已执行完成 | `docs/update-checkout.md` |
> | 本仓库 bundle 数 | 由 8 变 **7**(`dsh-ctx-guard` 已退役) | `ls packages` |
>
> 注意:文档正文里出现的 8 个包与 A/B 双 checkout 都是**当时的记录**,不是今天的操作依据。

- 状态:**L1 已落地;L2 已落地(实验性,未接线);L0/D1 已于 2026-11-04 执行完成**(见文首校准块)。
- 范围:`/root/DSH-plugins` 的 8 个 bundle(调查当时为 8 个,含已退役的 `dsh-ctx-guard`) + profile 里 4 个 registry 插件,即「本机已装的每一个插件」。
- 调查日期:2026-11-02。运行时 DSH `0.2.1-rc.5`(Node v24.15.0),profile `web`(PID 817860)。
- 硬约束:未经用户明确批准**不得重启 DSH**。本方案据此设计为「免重启优先,需要重启时停下来问」。

> **L2 实现位置**:`scripts/update.mjs` + `scripts/update/`(见 §4.2)。用法:
> ```bash
> node scripts/update.mjs plan    [--profile-dir DIR] [--target REF] [--json]
> node scripts/update.mjs fetch   [--profile-dir DIR] [--package NAME]
> node scripts/update.mjs stage   [--profile-dir DIR] [--package NAME] [--gates ...]
> node scripts/update.mjs swap    [--profile-dir DIR] [--package NAME] --confirm
> node scripts/update.mjs rollback[--profile-dir DIR] [--package NAME] --confirm
> node scripts/update.mjs observe [--profile-dir DIR]
> ```
> `swap`/`rollback` 默认 dry-run;`--state-dir` 指定 journal/锁位置(默认 `$DSH_HOME/update`)。

---

## 0. 摘要

**一句话**:这个项目缺的不是「怎么拉新代码」,而是**一个能把「哪份代码正在被加载」变成确定事实、并以事务方式替换它的机制**。在当前接线方式下,「更新插件」这件事在物理上就不可能可靠 —— 先修接线,再谈工具。

三条结论:

1. **更新不等于重装。** 已装的 6 个本地插件(当时;现 5 个)是 `link:` 依赖 —— DSH 直接 import 那个目录里的文件。更新它们 = **原地换文件 + 触发一次 profile 重新组合**,DSH 的 HMR 会比对 `ino:size:mtimeMs` 把变了的模块换成新代码,**不需要重启**(证据链见 §3.2)。
2. **但现状让这件事不可靠,且有三个 P0 级缺陷**:代码库被劈成两个 checkout 各装一半(§2.1)、被加载的代码依赖一个 gitignore 的生成物(§2.2)、正在跑的 commit 不在任何 tag/分支上(§2.3)。
3. **不要自己造轮子。** DSH 自带 `@deepseek-ai/dsh-plugin-manager` + `dsh-hmr`,已经提供了写锁、manifest/lockfile 快照回滚、`restart-required` 上报、版本豁免。registry 插件走它的车道;本地 link 插件它管不了(会 `already-installed` 拒绝),那部分才需要补一个**独立的小事务器**。

---

## 1. 现状:插件是怎么被装进去的

profile `/root/.dsh/profiles/web/package.json` 里有两条独立的车道:

| 车道 | 数量 | 更新语义 | 谁负责 |
| --- | --- | --- | --- |
| `link:<绝对路径>`(本地源码) | **5**(调查当时 6) | 原地换文件 + 重组合 | 本项目(无现成工具) |
| registry 版本号(npm) | **4** | 改依赖版本 + pnpm(remove→install) | DSH 自带 plugin-manager |

调查当时的 6 个 link 包(按**实际被加载的路径**)。今天已是 5 个、且全部来自 A,见文首校准块:

| 包 | 实际加载自 | checkout |
| --- | --- | --- |
| `dsh-credential-vault` | `/root/DSH-plugins/packages/...` | **A** |
| `dsh-git-status` | `/root/DSH-plugins/packages/...` | **A** |
| `@local/dsh-prompt-inject` | `/root/dsh-workspace/DSH-plugins/packages/...` | **B** |
| ~~`dsh-ctx-guard`~~(已退役,仓库中已删除) | `/root/dsh-workspace/DSH-plugins/packages/...` | **B** |
| `dsh-inventory` | `/root/dsh-workspace/DSH-plugins/packages/...` | **B** |
| `dsh-websearch-failover` | `/root/dsh-workspace/DSH-plugins/packages/.../plugin` | **B** |

4 个 registry 包:`dsh-context@0.79.0`、`dsh-tool-search@0.1.9`、`dsh-plugin-save-token@2.4.1`、`@wxg-prc-cpg/browser-skill-dsh-plugin@0.4.0`。

未安装(不算更新,算安装决策):`dsh-git-bash-tool`(Windows 专属,在本机属于 `blocked`)。`dev-flow-skill` 目前**只走了文件系统路径**:`~/.dsh/skills/dev-flow` 软链已建,`skill-filesystem` 自动发现(免重启),会话目录已有 `dev-flow`;profile 的 `link:` 与 `bundles` 行**尚未加**,所以 `check-profile` 仍是 5 个 bundle。补 profile 需要一次重组合,见 #47。

> 复核:`for l in /root/.dsh/profiles/web/node_modules/{*,@local/*}; do [ -L "$l" ] && echo "$l -> $(readlink -f "$l")"; done`

---

## 2. 可靠性缺口(按严重度,均有复现证据)

### P0-1 两个 checkout 把 8 个包劈成两半,更新任一侧只覆盖一半(当时的现状;现已统一,见文首校准块)

| | A `/root/DSH-plugins` | B `/root/dsh-workspace/DSH-plugins` |
| --- | --- | --- |
| 分支 | `issue-sync-open-a`(WIP) | `main` |
| 克隆形态 | 完整 clone | **shallow**(`.git/shallow` 存在) |
| remote | `github.com/kurumi1ksllq/DSH-plugins.git`,**URL 内联明文 PAT** | `gh-proxy.com/...`,无 PAT |
| fetch refspec | `+refs/heads/*` | **只有 `main`** |
| 最后一次同步 | `git fetch origin main` | `git fetch /root/DSH-plugins issue-sync-open-a`(手工跨目录 fetch) |
| tag | 0 | 0 |

两者**不是 worktree、不共享 object store**(各自 `.git` 目录、无 alternates、pack inode 不同)。

后果:
- 在 A 里改 `dsh-inventory` 并跑 `pnpm test` —— **线上一个字节都不会变**,而且预检全绿,因为你验证的和线上跑的不是同一份代码。
- 只想更新「本仓库」这个直觉动作,产出的是**混代 profile**(4 个包新、2 个包旧)。
- `dsh-inventory` 的 `defaultRepoRoot()` 指向不存在的 `~/.dsh/plugin-repo`,一旦启用会 clone 出**第三份** checkout。

### P0-2 被加载的代码依赖一个 gitignore 的生成物

`dsh-websearch-failover` 的 bundle 实体是 `plugin/`,而 `plugin/lib/*.mjs`(5 个模块)由 `../lib` 复制生成,被 `packages/dsh-websearch-failover/.gitignore:4` 忽略(`plugin/lib/`)。

- `git clean -xfd` 或 fresh clone → 被 link 的 bundle 立即 `ERR_MODULE_NOT_FOUND`,而**没有一条关卡会拦**。
- 源码改了没重新 build → **静默地继续跑旧引擎**(已在 `/tmp` 副本复现)。
- 更糟:`pnpm test` 中的某个测试会**顺手把 `lib/` 复制进 `plugin/lib/`「自我修复」**被测产物(mtime 实测从 06:07 变成 18:47)→ 陈旧永远测不出来。

### P0-3 正在运行的 commit 不落在任何 tag/分支上

```
A HEAD            faacf7a  (分支 issue-sync-open-a)
origin/main       752921e
faacf7a 是 origin/main 的祖先?  NO
origin/main 上的 dsh-inventory 版本   0.1.0   ← 线上跑的是 0.2.0
```

即:**线上代码既没有 tag,也没合并进 main**。任何人「从仓库重新装一份」都装不出当前线上这套。

### P1(会持续制造不确定性)

| 编号 | 缺陷 | 一句话修法 |
| --- | --- | --- |
| P1-4 | `pnpm check:websearch` 默认查 A 的工作树,而线上 link 的是 B → **在 A 里永远绿** | 用 profile 里 bundle 的 `realpath` 当 `--root` |
| P1-5 | profile 接线零校验(曾经的 `scripts/probe-profile.mjs` 已被删除) | 恢复只读 `check-profile.mjs` 并接进 `pnpm verify` |
| P1-6 | `pnpm-lock.yaml` 的 importers 缺 `dsh-credential-vault`/`dsh-git-status`;`--frozen-lockfile` 实测仍会改写 lockfile(**2026-11-04 已修,见复核段**) | 补一次 install 提交 lockfile + CI 断言 install 不改 lockfile |
| P1-7 | 版本无纪律:全历史仅 1 次 bump;`plugin/` 0.2.0 与仓库根 `websearch-dsh-plugin` 0.3.0 是同一个东西的两个版本号 | 定「改代码必须 bump」+ 自动检查 |
| P1-8 | `dsh-git-bash-tool` 无 test、无 scripts 块,`pnpm -r --if-present` 静默跳过 | 补最小 test + verify 断言每包必须有 `scripts.test` |
| P1-9 | 当时 8 个包都没有 `engines.dsh`/DSH peer → 版本兼容检查**从不触发**,没有保护 | 补 `engines.dsh`;当前运行时是 `0.2.1-rc.5` |
| P1-10 | 无 CI(`.github` 不存在);README 说「六个插件」(当时)实际 8 个、安装片段只列 5 个依赖 | 数字从 `packages/` 生成 + 加最小 CI |
| P1-11 | registry 车道已有一处真实落后:`@wxg-prc-cpg/browser-skill-dsh-plugin` 装 0.4.0,最新 0.4.1 | 见 §4.3 |
| P1-12 | 更新路径未脚本化,全靠手工 `git fetch` | 见 §4.2 |

**2026-11-04 复核(逐条核对仓库实况)**:

- ✅ **P1-5** `scripts/check-profile.mjs` 已恢复,并接进 `pnpm verify`(`profile ok: 5 linked bundle(s)`);2026-11-04 起它还会扫 `node_modules` 里**未被 manifest 声明**的符号链接:目标不存在一律 `fail`(exit 1),目标还在但没人声明给 `warn`——`dsh-ctx-guard` 这类「包删了、pnpm 还留着链接」的残留就是被这一条抓住的,见 **#43**。
- ✅ **P1-8** 每个包都有 `scripts.test`(7/7),`pnpm -r --if-present` 不再静默跳过。
- ✅ **P1-9** 每个包都有 `engines.dsh: ^0.2.0`(7/7)。
- ✅ **P1-10** `ls .github/workflows/ci.yml` 存在(CI 只看文件在不在,`pnpm verify` 不覆盖这条);README 的插件数与安装片段由 `test/docs-contract.test.mjs` 钉住,再漂就红。
- ✅ **P1-6 已修**(2026-11-04):importers 补齐 `dsh-credential-vault` / `dsh-git-status`、去掉已删除的 `packages/dsh-ctx-guard`;CI 加了一道 `git diff --exit-code -- pnpm-lock.yaml`,因为 `pnpm install --frozen-lockfile` 会 **exit 0 却改写** lockfile,单靠它守不住。
- ⬜ **P1-4** 未复核:`pnpm check:websearch` 是否以 profile 里 bundle 的 `realpath` 为根,本次未验证。


---

## 3. 关键机制:在 DSH 里「更新」到底等价于什么

> 本节是方案的物理基础。结论均有 `文件:行号` 或隔离环境实验证据,完整记录见 `.tmp/research/runtime.md`。

### 3.1 谁在决定「新代码生效」

`link:` 包改代码后,**没有任何文件事件**会触发加载。新代码生效的**唯一**开关是 profile 的**重新组合(recomposition)**,而重组合里 HMR 会 stat 比对已加载模块的 `ino:size:mtimeMs`,把变了的文件换掉(`dsh-hmr/lib/index.js:408-500`、`profileRoots:1449`、`profileModules:1180`)。

触发重组合的事件只有这几类(`dsh-hmr/lib/index.js:846-878`):

| # | 事件 | 触发? | 适用性 |
| --- | --- | --- | --- |
| 1 | 写 `profiles/<p>/cordis.patch.yml`(内容有变) | **是** | ✅ 最可控,agent 可用 |
| 2 | 写 `$DSH_HOME/cordis.patch.yml` | **是** | ⚠️ 影响所有 profile,不用 |
| 3 | `dsh.profile.bundles` 列表变化 | **是** | ⚠️ 只在真增删 bundle 时 |
| 4 | `package.json` 其它字段变化(如依赖版本串) | **否** | 陷阱 |
| 5 | 改被 link 包的 `.js` / `package.json` | **否** | 陷阱:只是「等下次重组合被顺带换掉」 |
| 6 | plugin_manager 的任一变更(启用/禁用/安装/删除) | **是** | ✅ 不用等文件事件 |
| 7 | `dsh plugin --profile <p> ...`(CLI,另一个进程) | **否** | 陷阱 |

**本机 HMR 是否在跑**:`dsh web` 是 launcher 提供的 profile(`profileContext` 存在)→ base 里 `hmr` 行 `disabled: !!js '!ctx.get(''profileContext'')'` 求值为**启用**;`config.root: []` 只关掉「源码目录监听」,**不影响** profile 监听与重组合时的 stat 比对。所以「已链接包被替换」的通道是通的,**只是触发要人工写一次 patch**(或走 plugin_manager)。

### 3.2 能做到免重启 —— 但有代价,必须写进手册

实测证据链(全部在隔离 `DSH_HOME=/tmp/dsh-exp` 下做,已还原):

- **L1** `dsh --profile web --dump-config`:校验 profile/bundle 解析、patch 读取与 YAML、`engines.dsh` 兼容(含豁免)、patch 合并。**不 import 任何插件模块**。耗时 0.25s。
- **L2** 进程内 import 全部 209 个组合行(装 launcher 同一份 runtime resolution):实测 `imported ok: 183, failures: 0`;把某包入口改成 import 一个不存在的文件后 → `failures: 1` 且 exit 1,**而同一时刻 L1 完全看不见**(exit 0、stderr 空)。耗时 4s。
- **L3** `dsh headless` **不能**当预检:它加载的是 base+headless,**不含本仓库的任何 bundle**;换成 `dsh --profile web --port 0` 就是起第二个 Web 宿主,抢 profile 的 pnpm 文件锁与会话。
- **L4** 一次真实重组合 = 与线上完全相同的替换链路,失败判定看服务日志 `restart required:` 与插件页 fiber `active|failed`。

**代价(最重要的一条)**:HMR 的替换是**先卸旧、再装新**,而

> 「导入或启动失败的替换版本保持未激活……**旧版本不会被恢复**。」(`dsh-hmr/README.zh.md`)
> 「替换版本导入或启动失败时报告 `failed`……**旧版本不再运行**。」(`dsh-plugin-manager/README.zh.md`)

也就是说:**免重启的代价是没有自动回滚**。这直接推出方案的核心设计:**一切能在 swap 之前做的验证都必须前置**;swap 之后再失败,只能靠「把文件改回去 + 再触发一次重组合」恢复(不能靠重启 —— 重启会加载同一份坏文件)。

### 3.3 `restart-required` / `restartReason`:什么时候免重启救不了

| `restartReason` | 触发条件 | 我们会不会遇到 |
| --- | --- | --- |
| `package-moved` | 包解析到的**目录变了**(换 checkout、换 link 目标、改安装映射) | **会** —— 统一两个 checkout 必然触发 |
| `host-module` | 变更模块在宿主静态图里(进程 entry 可达) | 可能(profile 每个符号链接都扩大比对范围) |
| `no-hmr` | HMR 未挂载/被 patch 禁用 | 当前不会 |
| `unmanaged-plugin` | 变更模块的插件不由受管 Loader entry 启动(preset 行) | 改 preset 插件才会 |
| `module-comparison` | 比对不可用(打包 worker) | 原生 Node 不会 |

**必须走「用户批准的重启门」的情形**(免重启做不到):

1. `package-moved` —— 含**统一两个 checkout** 这件事本身;
2. 改了 link 包**自己的 `dependencies`**(依赖驱动的重载被显式切断);
3. 改端口/TLS/`--host`/`--public-url`(换监听参数);
4. 升级 DSH 运行时本身。

> 注意:`restart-required` **不等于「插件坏了」**。它表示「磁盘已改,运行实例还是旧的」,运行实例仍健康,下一次重组合会再试。

---

## 4. 方案

### 4.0 总览

```
L0 前置整改(一次性,需要一次批准的重启窗口)
     统一权威 checkout ──┬─→ 让「哪份代码在跑」成为确定事实
     生成物政策          │
     tag / CHANGELOG     │
     profile 接线校验    ┘
                ↓
L1 仓库侧发布纪律    改代码必须 bump + tag + 关卡全绿
                ↓
L2 更新事务器(本项目补,scripts/update.mjs)
     plan → stage → verify → swap → apply → observe → (rollback)
     「免重启优先;需要重启就停下来问」
                ↓
L3 运行侧:registry 插件走 DSH 自带 plugin-manager(不自己造)
```

原则三条:
1. **能验证的都在 swap 之前验证**(因为 HMR 失败不回滚)。
2. **原地换文件,不换目录**(同 realpath 才走 `module-comparison`;换目录 = `package-moved` = 必须重启)。
3. **绝不自动重启**;`restart-required` 一律上报给用户决定。

### 4.1 L1 仓库侧:让更新可被描述

- **一次性补齐**:当时 8 个包各打 tag(`<pkg>@<version>`,如 `dsh-inventory@0.2.0`);新增 `CHANGELOG.md`;把 WIP 分支收口(线上 `faacf7a` 合进 `main`)。
- **版本契约**:「改代码必须 bump」,并加自动检查。
- **关卡一条命令** `pnpm gate` = `verify` + `test` + `check:websearch` + `check-profile` + 版本 bump 检查。全部要**查「实际被加载的那份代码」**,不是查当前工作目录。
- **最小 CI**(GitHub Actions):`pnpm gate` + `pnpm install --frozen-lockfile`。
- **安全**:把 A 的 `remote.origin.url` 里的明文 PAT 移到 `git credential` helper。

### 4.2 L2 更新事务器:一个独立的小 CLI

**载体选择**:新增 `scripts/update.mjs`(纯新增,不接线)。

**不扩 `dsh-inventory`**:它的世界观是「跨机清单同步/集合差」,`outdated` 已定义为「本机版本 ≠ 清单版本」;而且**它自己就是待更新包之一,且当前加载的那份来自另一个 checkout** —— 更新器与被更新对象同故障域,递归不可解。

**也不用 `dsh plugin` 更新 link 包**:HMR 生效时 `installBundle()` 对已安装包直接 `already-installed` 拒绝;它只会在 profile 目录跑 pnpm(重写 `package.json`/`pnpm-lock.yaml`),且**不会让运行中进程重组合**。

阶段设计(每阶段失败即中止,不留半个状态):

| 阶段 | 做什么 | 失败时 |
| --- | --- | --- |
| **0 前置锁** | 取自己的编排锁;检查 `<profile>/.plugin-manager/run.json` 有无在飞 pnpm → 有则**拒绝开始** | 退出,不改任何东西 |
| **1 plan(只读)** | 对每个 bundle:`readlink -f` 出**实际加载路径** → 定位 checkout → 比对当前 commit / 目标 tag → 产出动作表;标出 `blocked`(平台/依赖)与「依赖增差」 | 只读,无副作用 |
| **2 fetch+stage** | 在权威 checkout 里 fetch;`git worktree add` 出目标 commit 到 `<checkout>/.tmp/update/staging`(同文件系统);**在 stage 里**跑 `build` | 丢弃 stage,工作树不变 |

| **3 verify(硬门)** | ① `verify-packages.mjs` ② 包内 test ③ `build:check`(生成物新鲜度) ④ **L2 import-probe**(入口可 import,失败 0) ⑤ `dsh --profile web --dump-config`,**要求 stderr 为空**(把 bundle 被 skip 从「退出码 0 的静默」变成硬失败) ⑥ **依赖增差检测**:新代新增了依赖 → **不走 L2,转 §4.3 车道**(否则会「关卡全绿但换上去 import 失败,而旧版已停」) | 丢弃 stage,工作树不变 |
| **4 swap(原子)** | `renameat2(RENAME_EXCHANGE)` 一次 syscall 交换 stage 与目标目录(**本机已实测可用**):旧代码自动落在 stage 路径 = **免费的回滚副本**,零窗口期 | 反向 exchange 即回滚 |
| **5 apply(免重启)** | 触发一次重组合:优先 plugin_manager 关→开该行(不等文件事件);否则写一条幂等 patch。**不改端口、不改 bundles 列表** | — |
| **6 observe** | 读三个信号:服务日志有无 `restart required:` / 插件页 fiber `active|failed` / `pluginInventory` 快照。出现 `failed` → **不重启**,走 `rollback` | rollback |
| **7 rollback / report** | 反向 `RENAME_EXCHANGE` 换回旧代码 + 恢复 profile 五个文件的逐字节快照(`package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、**`pnpm-workspace.yaml`**、`compatibility.json`;后两者容易被漏 —— 管理器的失败恢复刻意不恢复 `pnpm-workspace.yaml`);写审计 journal | — |

**为什么是「原地换文件」而不是「换 symlink」**:HMR 用 `ino:size:mtimeMs` 判定变化,同目录原地替换走 `module-comparison` → 免重启;把 `link:` 指到新目录 = `package-moved` → **必须重启**。这是本方案与「版本目录 + 原子改 symlink」这类常规做法**结论相反**的地方,是本项目最反直觉的一条约束。

**已知边界**(诚实列出):
- 多文件替换不是单事务;`RENAME_EXCHANGE` 是目录级一次完成,但当时那 6 个已装 bundle 之间仍是一个一个来 → 建议**按 checkout 整批一次性交换**。
- 若插件改了 Host 图(增删 row),客户端侧还要等 `client-hmr` 轮询产物(默认 500ms)并重置组件状态(页面 React 状态会丢)。
- journal/编排锁的落点建议 `$DSH_HOME`(与 DSH 自身状态同处),但本次调查受「不写 `/root/.dsh`」约束,原型放在 `.tmp/`。

### 4.3 L3 运行侧:registry 插件交回 DSH 自带管理器

这 4 个包**不需要**上面的工具。用官方车道,享受它的写锁(120s)、manifest+lockfile 快照回滚、`restart-required` 上报与版本豁免:

- **日常**:Web 侧栏「插件」页的**更新**按钮(内部是 remove→install,会明确报 `restart-required`);
- **脚本/CLI**:`dsh plugin --profile web add <pkg>@<exact-version>`;
- **落后实例**:`@wxg-prc-cpg/browser-skill-dsh-plugin` 0.4.0 → 0.4.1(本次实测发现);
- **建议**:把 registry 依赖固定为精确版本(与 `saveExact` 一致),避免「同一 commit 装出不同结果」。
- 若某包声明了不兼容的 DSH 版本:`dsh plugin --profile web version-exemptions` 查看,`allow-version ... --accept-risk` 授权 —— **必须先向用户说明风险并拿到明确许可**,不要手写 `compatibility.json` 绕过确认。

### 4.4 L0 前置整改:为什么必须先做,以及它的代价

**必须先把当时那 6 个 `link:` 统一到一个权威 checkout**,否则 L2 存在的意义只是「把一半包更新得更整齐」。

**但统一 checkout = 换 link 目标 = `restart-required(package-moved)` = 需要一次重启窗口。** 所以它不能夹在日常更新里顺手做,必须:

1. 作为一次**显式的、需要用户批准的运维动作**排期;
2. 在此之前,继续用 A/B 的现状跑 L2 也能工作(工具按 bundle 分别定位 checkout),所以**在统一之前,L2 的第一步永远是打印「本次会更新到哪个 checkout」让用户确认**。

同时完成的整改:生成物政策(见 §6 决策点)、tag/CHANGELOG、`check-profile.mjs`、PAT 外移。

### 4.5 单插件更新的操作手册(现状下即可用)

```bash
# 0. 先确认「这次改的到底是哪份代码」—— 本方案的第一原则
readlink -f /root/.dsh/profiles/web/node_modules/<pkg>

# 1. 在正确的 checkout 上改代码 / 构建(有构建的包)
node scripts/build-plugin.mjs --check     # 期望 exit 0

# 2. L1 组合预检(0.25s):要求 stderr 为空,否则视为失败
DSH_HOME=/tmp/dsh-exp dsh --profile web --dump-config 2>&1 >/dev/null

# 3. L2 入口预检(4s):要求 failures: 0
DSH_HOME=/tmp/dsh-exp node .tmp/research/exp/import-probe.mjs web

# 4. L4 触发一次重组合(免重启生效),然后看服务日志 / 插件页 fiber
#    出现 restart required: → 走 §3.3 的判定,必要时请用户批准重启
#    出现 failed        → 把文件改回去,再触发一次重组合;不要重启
```

---

## 5. 验收标准

方案落地后应满足(每条可机器验证):

1. **确定性**:任一时刻,每个已装 bundle 的「实际加载 commit」可被一条只读命令列出;`pnpm gate` 校验「被加载的那份代码」通过全部关卡。
2. **无混代**:不存在「同一次更新只覆盖一半 bundle」的可能。
3. **生成物**:fresh clone 后不跑任何手工步骤,`<profile>` 也能加载 `dsh-websearch-failover`;**源码改了没重新 build 必须让关卡失败**。
4. **事务性**:更新任一 bundle 失败后,profile 五文件与 bundle 目录逐字节回到更新前。
5. **免重启优先**:常规更新(不改依赖、不换目录)后,插件在**不重启**的情况下生效;不能免重启时,输出带 `restartReason` 的显式报告,由用户决定。
6. **可追溯**:每次更新留一份 journal(前/后 commit、关卡输出、应用结果、是否需重启)。
7. **不复现** P0-1~P0-3 与 P1-4~P1-12。

---

## 6. 需要你拍板的决策点

| # | 决策 | 选项 | 建议 |
| --- | --- | --- | --- |
| D1 | 统一权威 checkout | (a) 统一到 `/root/DSH-plugins`,B 退役;(b) 保持双份 | **(a)**,但排一次**需要批准的短重启窗口**;在此之前 L2 只做「报告会动哪个 checkout」 |
| D2 | websearch 生成物政策 | (a) 入库 `plugin/lib`;(b) 保持 gitignore + 硬性 `build:check` 门;(c) 给 `plugin` 加 `prepare` 构建 | **(a)** 最省心(消除「fresh clone 坏」与「静默旧代码」两类故障);若在意 diff 噪音则 (b) |
| D3 | 更新器落点 | (a) 新增 `scripts/update.mjs`;(b) 扩 `dsh-inventory`;(c) 只写手册不改代码 | **(a) + §4.3 复用官方管理器**;(b) 已论证不可行 |
| D4 | 现在做到哪一步 | (a) 先落 D2 的关卡与工具,再排 D1;(b) 先只修 P0,工具延后 | **(a)**;P0-2 的关卡是零风险的第一刀 |
| D5 | registry 插件是否允许自动更新 | (a) 只报告不自动装;(b) 自动升 patch | **(a)**,与本项目「更新必须有显式决策」的基调一致 |

---

## 附:证据索引

| 主题 | 出处 |
| --- | --- |
| DSH 包管理服务全规格(写锁/快照回滚/restart-required/版本豁免) | `@deepseek-ai/dsh-plugin-manager/README.zh.md` |
| HMR 替换语义与已知限制(含「已链接包目标」与「旧版本不恢复」) | `@deepseek-ai/dsh-hmr/README.zh.md` |
| 重组合触发条件 | `dsh-hmr/lib/index.js:846-878` |
| 文件身份比对 `ino:size:mtimeMs` | `dsh-hmr/lib/index.js:408-500` |
| `restartReason` 枚举 | `dsh-plugin-manager/lib/typert.host.js:48` |
| `--dump-config` 校验边界 | `dsh/lib/dump-config-CWs_HdOc.js:20-64` |
| 三条线的完整调查记录(逐条 file:line / 命令输出) | `.tmp/research/{runtime,repo,tooling}.md`(scratch,gitignored) |
| 可复用预检脚本原型 | `.tmp/research/exp/`(L1/L2 探针)、`.tmp/research/proto/`(事务器原型,11/11 自检通过) |

> 运行时包路径前缀:`/opt/dsh-runtime/dshcli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`
